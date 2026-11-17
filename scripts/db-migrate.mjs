#!/usr/bin/env node
/**
 * Creates (or brings up to date) the Postgres schema on Neon.
 *
 *   npm run db:migrate          # apply
 *   npm run db:migrate -- --dry # print the SQL, touch nothing
 *
 * Safe to re-run: every statement is `IF NOT EXISTS`. It never drops or
 * rewrites data.
 *
 * The indexes are generated from `firestore.indexes.json`, so every query that
 * had a composite index in Firestore has the matching btree here — written on
 * the same `data #> '{field}'` expressions `src/lib/db/store.ts` queries with,
 * which is what lets Postgres use them.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import pg from "pg";

const DRY = process.argv.includes("--dry");

function fieldExpr(field) {
  const segments = field.split(".").map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return `(data #> '{${segments.join(",").replace(/'/g, "''")}}')`;
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

const base = [
  `CREATE TABLE IF NOT EXISTS docs (
     path        text COLLATE "C" PRIMARY KEY,
     parent      text COLLATE "C" NOT NULL,
     coll        text COLLATE "C" NOT NULL,
     id          text COLLATE "C" NOT NULL,
     data        jsonb NOT NULL DEFAULT '{}'::jsonb,
     create_time timestamptz NOT NULL DEFAULT now(),
     update_time timestamptz NOT NULL DEFAULT now()
   )`,
  // A collection is (coll, parent); a collection group is coll alone.
  `CREATE INDEX IF NOT EXISTS docs_coll_parent_id ON docs (coll, parent, id)`,
  // Every equality filter is also a containment test, which this answers for any field.
  `CREATE INDEX IF NOT EXISTS docs_data_gin ON docs USING gin (data jsonb_path_ops)`,
  `CREATE INDEX IF NOT EXISTS docs_update_time ON docs (coll, update_time)`,
  `CREATE TABLE IF NOT EXISTS schema_migrations (
     name       text PRIMARY KEY,
     applied_at timestamptz NOT NULL DEFAULT now()
   )`,
];

function indexStatements() {
  const spec = JSON.parse(readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
  const out = [];
  const seen = new Set();
  const add = (coll, group, fields) => {
    const cols = fields.map(({ fieldPath, order }) => `${fieldExpr(fieldPath)}${order === "DESCENDING" ? " DESC" : ""}`);
    const key = `${coll}|${group}|${cols.join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);
    const name = `ix_${coll.replace(/[^A-Za-z0-9]/g, "").slice(0, 24).toLowerCase()}_${createHash("sha1").update(key).digest("hex").slice(0, 10)}`;
    const leading = group ? "" : "parent, ";
    out.push(`CREATE INDEX IF NOT EXISTS ${name} ON docs (${leading}${cols.join(", ")}) WHERE coll = ${lit(coll)}`);
  };
  for (const index of spec.indexes ?? []) {
    const fields = index.fields.filter((f) => f.order); // array-config fields are served by the GIN index
    if (fields.length === 0) continue;
    add(index.collectionGroup, index.queryScope === "COLLECTION_GROUP", fields);
  }
  for (const override of spec.fieldOverrides ?? []) {
    for (const ix of override.indexes ?? []) {
      if (!ix.order) continue;
      add(override.collectionGroup, ix.queryScope === "COLLECTION_GROUP", [{ fieldPath: override.fieldPath, order: ix.order }]);
    }
  }
  // Orderings the app uses with no equality in front, which Firestore served from single-field indexes.
  const singles = [
    ["leads", "createdAt", "DESCENDING"],
    ["leads", "updatedAt", "ASCENDING"],
    ["notifications", "createdAt", "DESCENDING"],
    ["closedDeals", "enteredAt", "DESCENDING"],
    ["expenses", "dayKey", "DESCENDING"],
    ["expenses", "date", "DESCENDING"],
    ["transactions", "date", "DESCENDING"],
    ["personalExpenses", "dayKey", "DESCENDING"],
    ["attendance", "dayKey", "ASCENDING"],
    ["followUps", "occurredAt", "DESCENDING"],
    ["events", "createdAt", "DESCENDING"],
    ["wa_messages", "timestamp", "DESCENDING"],
    ["wa_conversations", "lastMessageAt", "DESCENDING"],
  ];
  for (const [coll, fieldPath, order] of singles) add(coll, false, [{ fieldPath, order }]);
  add("followUps", true, [{ fieldPath: "dayKey", order: "ASCENDING" }]);
  return out;
}

const statements = [...base, ...indexStatements()];

if (DRY) {
  console.log(statements.map((s) => `${s};`).join("\n\n"));
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run with: node --env-file=.env.local scripts/db-migrate.mjs");
  process.exit(1);
}

const url = process.env.DATABASE_URL.replace(/([?&])channel_binding=[^&]*(&?)/, (_m, lead, tail) => (tail ? lead : "")).replace(/[?&]$/, "").replace(/sslmode=require\b/, "sslmode=verify-full");
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: true } });
await client.connect();
const started = Date.now();
try {
  for (const statement of statements) {
    await client.query(statement);
  }
  await client.query(`INSERT INTO schema_migrations (name) VALUES ('001_docs') ON CONFLICT DO NOTHING`);
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'docs'`
  );
  console.log(`Schema up to date: table docs with ${rows[0].n} indexes (${Date.now() - started} ms).`);
} finally {
  await client.end();
}
