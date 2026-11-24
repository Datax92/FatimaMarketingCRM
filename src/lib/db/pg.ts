import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * One connection pool per server instance, against Neon's **pooled** endpoint
 * (`…-pooler…`), which multiplexes many short-lived serverless instances onto
 * a few real Postgres connections. Every transaction here is short and holds
 * only transaction-scoped locks, which is exactly what the pooler's
 * transaction mode supports.
 */

export interface Exec {
  query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

const globalForPg = globalThis as unknown as { __crmPgPool?: Pool };

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add the Neon connection string (pooled) to .env.local " +
        "or to the deployment's environment variables."
    );
  }
  // node-postgres reads `sslmode` from the URL; `channel_binding` it does not
  // understand and would pass to the server as a startup parameter.
  // `sslmode=require` is already treated as full verification by
  // node-postgres; saying so explicitly silences its deprecation warning.
  return url
    .replace(/([?&])channel_binding=[^&]*(&?)/, (_m, lead, tail) => (tail ? lead : ""))
    .replace(/[?&]$/, "")
    .replace(/sslmode=require\b/, "sslmode=verify-full");
}

export function getPool(): Pool {
  if (!globalForPg.__crmPgPool) {
    globalForPg.__crmPgPool = new Pool({
      connectionString: connectionString(),
      max: Number(process.env.PG_POOL_MAX ?? 5),
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 15_000,
      ssl: { rejectUnauthorized: true },
    });
    globalForPg.__crmPgPool.on("error", (error) => {
      // An idle client dropped by Neon (compute suspended). The pool replaces it.
      console.warn("[db] idle connection error:", error.message);
    });
  }
  return globalForPg.__crmPgPool;
}

/**
 * A connection that failed **while being opened** — before any statement was
 * sent — so trying again cannot run anything twice. Seen once against Neon on
 * 2026-11-24 ("Connection terminated due to connection timeout") on the first
 * request of a fresh pool; the identical request succeeded straight after.
 */
function isConnectFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code;
  return (
    /Connection terminated|connection timeout|timeout exceeded when trying to connect/i.test(message) ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "57P03" // cannot_connect_now: the compute is still starting
  );
}

async function connect(): Promise<PoolClient> {
  try {
    return await getPool().connect();
  } catch (error) {
    if (!isConnectFailure(error)) throw error;
    console.warn("[db] connect failed, retrying once:", error instanceof Error ? error.message : error);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return getPool().connect();
  }
}

export const pool: Exec = {
  async query(text, params) {
    const client = await connect();
    try {
      const result = await client.query(text, params as unknown[]);
      client.release();
      return result;
    } catch (error) {
      // A broken connection must not go back into the pool.
      client.release(error instanceof Error ? error : true);
      throw error;
    }
  },
};

const RETRYABLE = new Set(["40001", "40P01"]); // serialization failure, deadlock

/** Runs `fn` inside one Postgres transaction, retrying a deadlock or serialization failure. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>, maxAttempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = await connect();
    let broken: Error | undefined;
    try {
      // A lock that is not granted in 15 s is an error, never a hang: a write
      // made outside a transaction to a document the transaction holds would
      // otherwise wait on it for ever.
      await client.query("BEGIN; SET LOCAL lock_timeout = '15s'; SET LOCAL statement_timeout = '60s'");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      lastError = error;
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        // The connection is already gone: destroy it rather than pool it.
        broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      }
      const code = (error as { code?: string }).code;
      if (!code || !RETRYABLE.has(code) || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 40));
    } finally {
      client.release(broken);
    }
  }
  throw lastError;
}
