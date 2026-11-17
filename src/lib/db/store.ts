import "server-only";
import { DOC_ID_FIELD, REF_KEY, TS_KEY, docPathParts, type FilterSpec, type QuerySpec, type WireDoc } from "./codec.ts";
import type { Exec } from "./pg.ts";

/**
 * The SQL underneath the document store.
 *
 * One table, `docs`: a row per document, keyed by its full path
 * (`leads/abc/followUps/x`), with the parent path and the collection id beside
 * it so a collection is `parent = … AND coll = …` and a collection group is
 * `coll = …`. Fields live in `data jsonb` and are addressed as
 * `data #> '{field,nested}'` — the same expression the indexes in
 * `db/schema.sql` are built on, so Postgres can use them.
 */

/* -------------------------------------------------------------------------- */
/* Field expressions                                                           */
/* -------------------------------------------------------------------------- */

function sqlStringLiteral(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/** `a.b` → `(data #> '{"a","b"}')`. A literal, never a parameter, or no index can match it. */
export function fieldExpr(field: string): string {
  const segments = field.split(".").map((segment) => `"${segment.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return `(data #> ${sqlStringLiteral(`{${segments.join(",")}}`)})`;
}

class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
  json(value: unknown): string {
    return `${this.add(JSON.stringify(value ?? null))}::jsonb`;
  }
  jsonArray(values: unknown[]): string {
    return `${this.add(values.map((value) => JSON.stringify(value ?? null)))}::jsonb[]`;
  }
}

function idOf(value: unknown): string {
  if (typeof value === "string") return value.includes("/") ? value.split("/").pop()! : value;
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>)[REF_KEY] === "string") {
    return String((value as Record<string, unknown>)[REF_KEY]).split("/").pop()!;
  }
  return String(value);
}

function isTimestampValue(value: unknown): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value) && TS_KEY in (value as object);
}

function filterSql(filter: FilterSpec, params: Params): string {
  const { field, op, value } = filter;

  if (field === DOC_ID_FIELD) {
    switch (op) {
      case "==":
        return `id = ${params.add(idOf(value))}`;
      case "!=":
        return `id <> ${params.add(idOf(value))}`;
      case "in":
        return `id = ANY(${params.add((value as unknown[]).map(idOf))}::text[])`;
      case "not-in":
        return `NOT (id = ANY(${params.add((value as unknown[]).map(idOf))}::text[]))`;
      case "<":
      case "<=":
      case ">":
      case ">=":
        return `id COLLATE "C" ${op} ${params.add(idOf(value))}`;
      default:
        throw new Error(`Unsupported operator "${op}" on the document id`);
    }
  }

  const expr = fieldExpr(field);
  switch (op) {
    case "==": {
      // Containment first, which the GIN index answers; the exact comparison
      // then rules out an array that merely holds the value.
      const scalar = value === null || ["string", "number", "boolean"].includes(typeof value);
      const exact = `${expr} = ${params.json(value)}`;
      if (!scalar) return exact;
      const container = field.split(".").reduceRight<unknown>((inner, key) => ({ [key]: inner }), value);
      return `(data @> ${params.json(container)} AND ${exact})`;
    }
    case "!=":
      return `(${expr} IS NOT NULL AND ${expr} <> 'null'::jsonb AND ${expr} <> ${params.json(value)})`;
    case "<":
    case "<=":
    case ">":
    case ">=": {
      // Firestore only compares like with like; jsonb would happily say a
      // boolean is greater than every number. A timestamp is an object in both.
      const typeGuard = isTimestampValue(value)
        ? `jsonb_typeof(${expr}) = 'object' AND ${expr} ? '${TS_KEY}'`
        : `jsonb_typeof(${expr}) = jsonb_typeof(${params.json(value)})`;
      return `(${typeGuard} AND ${expr} ${op} ${params.json(value)})`;
    }
    case "in":
      return `${expr} = ANY(${params.jsonArray(value as unknown[])})`;
    case "not-in":
      return `(${expr} IS NOT NULL AND ${expr} <> 'null'::jsonb AND NOT (${expr} = ANY(${params.jsonArray(value as unknown[])})))`;
    case "array-contains":
      return `(jsonb_typeof(${expr}) = 'array' AND ${expr} @> jsonb_build_array(${params.json(value)}))`;
    case "array-contains-any":
      return `(jsonb_typeof(${expr}) = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(${expr}) AS el WHERE el = ANY(${params.jsonArray(value as unknown[])})))`;
    default:
      throw new Error(`Unsupported operator "${op as string}"`);
  }
}

/** Firestore orders by an inequality field first when the query names no order. */
function effectiveOrders(spec: QuerySpec): { field: string; dir: "asc" | "desc" }[] {
  if (spec.orders.length > 0) return spec.orders;
  const inequality = spec.filters.find(
    (filter) => filter.field !== DOC_ID_FIELD && ["<", "<=", ">", ">=", "!=", "not-in"].includes(filter.op)
  );
  return inequality ? [{ field: inequality.field, dir: "asc" }] : [];
}

function orderTerm(field: string): string {
  return field === DOC_ID_FIELD ? `path COLLATE "C"` : fieldExpr(field);
}

function cursorSql(spec: QuerySpec, orders: { field: string; dir: "asc" | "desc" }[], params: Params): string | null {
  const values = spec.startAfter ?? spec.startAt;
  if (!values || values.length === 0) return null;
  const inclusive = !spec.startAfter;
  const terms = [...orders, { field: "__path__", dir: (orders[orders.length - 1]?.dir ?? "asc") as "asc" | "desc" }];
  const used = terms.slice(0, values.length);
  const value = (index: number) =>
    used[index].field === "__path__" || used[index].field === DOC_ID_FIELD
      ? params.add(String(values[index]))
      : params.json(values[index]);
  const expr = (index: number) =>
    used[index].field === "__path__" ? `path COLLATE "C"` : used[index].field === DOC_ID_FIELD ? `path COLLATE "C"` : fieldExpr(used[index].field);

  const disjuncts: string[] = [];
  for (let i = 0; i < used.length; i++) {
    const parts: string[] = [];
    for (let j = 0; j < i; j++) parts.push(`${expr(j)} = ${value(j)}`);
    parts.push(`${expr(i)} ${used[i].dir === "asc" ? ">" : "<"} ${value(i)}`);
    disjuncts.push(`(${parts.join(" AND ")})`);
  }
  if (inclusive) disjuncts.push(`(${used.map((_, j) => `${expr(j)} = ${value(j)}`).join(" AND ")})`);
  return `(${disjuncts.join(" OR ")})`;
}

interface Built {
  where: string;
  orderBy: string;
  params: Params;
  limit?: number;
  reverse: boolean;
}

function build(spec: QuerySpec): Built {
  const params = new Params();
  // The collection is a literal so the planner can match each index's
  // `WHERE coll = '…'` predicate.
  const where: string[] = [`coll = ${sqlStringLiteral(spec.collection)}`];
  if (!spec.group) where.push(`parent = ${params.add(spec.parent)}`);
  for (const filter of spec.filters) where.push(filterSql(filter, params));

  const orders = effectiveOrders(spec);
  for (const order of orders) {
    if (order.field !== DOC_ID_FIELD) where.push(`${fieldExpr(order.field)} IS NOT NULL`);
  }
  const cursor = cursorSql(spec, orders, params);
  if (cursor) where.push(cursor);

  const reverse = !!spec.limitToLast;
  const flip = (dir: "asc" | "desc") => (reverse ? (dir === "asc" ? "DESC" : "ASC") : dir === "asc" ? "ASC" : "DESC");
  const lastDir = orders[orders.length - 1]?.dir ?? "asc";
  const terms = orders.map((order) => `${orderTerm(order.field)} ${flip(order.dir)}`);
  if (!orders.some((order) => order.field === DOC_ID_FIELD)) terms.push(`path COLLATE "C" ${flip(lastDir)}`);

  return { where: where.join(" AND "), orderBy: terms.join(", "), params, limit: spec.limit, reverse };
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

interface Row {
  path: string;
  data: Record<string, unknown>;
  create_time: Date;
  update_time: Date;
}

function toWire(row: Row): WireDoc {
  return {
    path: row.path,
    data: row.data,
    createTime: row.create_time?.getTime?.(),
    updateTime: row.update_time?.getTime?.(),
  };
}

export async function runQuery(exec: Exec, spec: QuerySpec, offset?: number): Promise<WireDoc[]> {
  const built = build(spec);
  let text = `SELECT path, data, create_time, update_time FROM docs WHERE ${built.where} ORDER BY ${built.orderBy}`;
  if (built.limit !== undefined) text += ` LIMIT ${Math.max(0, Math.floor(built.limit))}`;
  if (offset) text += ` OFFSET ${Math.max(0, Math.floor(offset))}`;
  const result = await exec.query<Row>(text, built.params.values);
  const docs = result.rows.map(toWire);
  return built.reverse ? docs.reverse() : docs;
}

export async function countQuery(exec: Exec, spec: QuerySpec): Promise<number> {
  const built = build(spec);
  const inner =
    built.limit !== undefined
      ? `SELECT 1 FROM docs WHERE ${built.where} ORDER BY ${built.orderBy} LIMIT ${Math.max(0, Math.floor(built.limit))}`
      : `SELECT 1 FROM docs WHERE ${built.where}`;
  const result = await exec.query<{ n: string }>(`SELECT count(*)::text AS n FROM (${inner}) AS q`, built.params.values);
  return Number(result.rows[0]?.n ?? 0);
}

/** Takes the transaction-scoped lock for each path, in a fixed order so two writers cannot deadlock on them. */
export async function lockPaths(exec: Exec, paths: string[]): Promise<void> {
  const unique = [...new Set(paths)].sort();
  if (unique.length === 0) return;
  await exec.query(
    `SELECT pg_advisory_xact_lock(hashtextextended(p, 0)) FROM unnest($1::text[]) WITH ORDINALITY AS t(p, n) ORDER BY n`,
    [unique]
  );
}

export async function readDocs(exec: Exec, paths: string[]): Promise<Map<string, WireDoc>> {
  const found = new Map<string, WireDoc>();
  if (paths.length === 0) return found;
  const result = await exec.query<Row>(
    `SELECT path, data, create_time, update_time FROM docs WHERE path = ANY($1::text[])`,
    [[...new Set(paths)]]
  );
  for (const row of result.rows) found.set(row.path, toWire(row));
  return found;
}

export async function listCollectionIds(exec: Exec, parent: string): Promise<string[]> {
  const result = await exec.query<{ coll: string }>(`SELECT DISTINCT coll FROM docs WHERE parent = $1 ORDER BY coll`, [parent]);
  return result.rows.map((row) => row.coll);
}

export async function listDocumentPaths(exec: Exec, parent: string, collection: string): Promise<string[]> {
  const result = await exec.query<{ path: string }>(
    `SELECT path FROM docs WHERE parent = $1 AND coll = $2 ORDER BY path COLLATE "C"`,
    [parent, collection]
  );
  return result.rows.map((row) => row.path);
}

/** Deletes a document or collection and everything nested under it. Returns how many rows went. */
export async function deleteTree(exec: Exec, path: string): Promise<number> {
  const escaped = path.replace(/[\\%_]/g, (c) => `\\${c}`);
  const result = await exec.query(`DELETE FROM docs WHERE path = $1 OR path LIKE $2`, [path, `${escaped}/%`]);
  return result.rowCount ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export interface Persist {
  path: string;
  /** `null` deletes the document. */
  data: Record<string, unknown> | null;
  /** Whether a row existed before this commit (keeps `create_time`). */
  existed: boolean;
}

export async function persist(exec: Exec, writes: Persist[], now: Date): Promise<void> {
  const deletes = writes.filter((write) => write.data === null).map((write) => write.path);
  const upserts = writes
    .filter((write) => write.data !== null)
    .map((write) => {
      const parts = docPathParts(write.path);
      return {
        path: write.path,
        parent: parts.parent,
        coll: parts.collection,
        id: parts.id,
        data: write.data,
        ts: now.toISOString(),
      };
    });

  if (deletes.length > 0) {
    await exec.query(`DELETE FROM docs WHERE path = ANY($1::text[])`, [deletes]);
  }
  if (upserts.length > 0) {
    await exec.query(
      `INSERT INTO docs (path, parent, coll, id, data, create_time, update_time)
       SELECT x.path, x.parent, x.coll, x.id, x.data, x.ts, x.ts
       FROM jsonb_to_recordset($1::jsonb) AS x(path text, parent text, coll text, id text, data jsonb, ts timestamptz)
       ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, update_time = EXCLUDED.update_time`,
      [JSON.stringify(upserts)]
    );
  }
}
