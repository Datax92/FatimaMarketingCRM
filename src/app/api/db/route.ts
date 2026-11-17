import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { AuthError, verifyAuth } from "@/lib/firebase/serverAuth";
import { getAdminDb } from "@/lib/firebase/server";
import { canClientUpdate, canRead, collectionKey, hasRule, type Caller, type DocLoader } from "@/lib/db/access";
import { countQuery, readDocs, runQuery } from "@/lib/db/store";
import { pool } from "@/lib/db/pg";
import type { FilterSpec, OrderSpec, QuerySpec, WhereOp, WireDoc } from "@/lib/db/codec";
import { decodeValue } from "@/lib/db/codec";

/**
 * **The browser's only way to the database.**
 *
 * `lib/db/client` (which the screens import in place of `firebase/firestore`)
 * sends its queries here, several per request, each with the hash of the
 * answer it already holds. The token is verified once, every document is
 * checked against `lib/db/access` before it leaves, and an answer that has not
 * changed comes back as `unchanged` with no documents — so a screen polling a
 * list of 500 leads costs a few hundred bytes until one of them moves.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_OPS = 25;
const MAX_LIMIT = 20_000;
const FIELD = /^[A-Za-z0-9_$\- .]{1,200}$/;
const OPS: WhereOp[] = ["==", "!=", "<", "<=", ">", ">=", "in", "not-in", "array-contains", "array-contains-any"];

type Op =
  | { kind: "query"; spec: QuerySpec; since?: string }
  | { kind: "count"; spec: QuerySpec }
  | { kind: "get"; path: string; since?: string }
  | { kind: "update"; path: string; data: Record<string, unknown> };

class BadRequest extends Error {}

function cleanPath(path: unknown, kind: "doc" | "parent"): string {
  if (typeof path !== "string") throw new BadRequest("path must be a string");
  const parts = path.split("/").filter(Boolean);
  if (parts.some((part) => !FIELD.test(part) || part.includes("."))) throw new BadRequest("bad path");
  if (kind === "doc" && (parts.length === 0 || parts.length % 2 !== 0)) throw new BadRequest("not a document path");
  if (kind === "parent" && parts.length % 2 !== 0) throw new BadRequest("not a parent path");
  return parts.join("/");
}

function cleanSpec(raw: unknown): QuerySpec {
  const spec = raw as Partial<QuerySpec>;
  if (!spec || typeof spec !== "object") throw new BadRequest("spec required");
  if (typeof spec.collection !== "string" || !FIELD.test(spec.collection) || spec.collection.includes(".")) {
    throw new BadRequest("bad collection");
  }
  const filters: FilterSpec[] = (spec.filters ?? []).map((filter) => {
    if (!filter || typeof filter.field !== "string" || !FIELD.test(filter.field)) throw new BadRequest("bad field");
    if (!OPS.includes(filter.op)) throw new BadRequest("bad operator");
    if (["in", "not-in", "array-contains-any"].includes(filter.op) && (!Array.isArray(filter.value) || filter.value.length > 500)) {
      throw new BadRequest("bad list");
    }
    return { field: filter.field, op: filter.op, value: filter.value };
  });
  const orders: OrderSpec[] = (spec.orders ?? []).map((order) => {
    if (!order || typeof order.field !== "string" || !FIELD.test(order.field)) throw new BadRequest("bad order");
    return { field: order.field, dir: order.dir === "desc" ? "desc" : "asc" };
  });
  const limit = spec.limit === undefined ? undefined : Math.min(MAX_LIMIT, Math.max(0, Math.floor(Number(spec.limit) || 0)));
  return {
    parent: spec.group ? "" : cleanPath(spec.parent ?? "", "parent"),
    collection: spec.collection,
    group: !!spec.group,
    filters,
    orders,
    limit,
    limitToLast: !!spec.limitToLast,
    startAfter: Array.isArray(spec.startAfter) ? spec.startAfter : undefined,
    startAt: Array.isArray(spec.startAt) ? spec.startAt : undefined,
  };
}

function hashDocs(docs: WireDoc[]): string {
  const hash = createHash("sha1");
  for (const doc of docs) hash.update(`${doc.path}\u0000${doc.updateTime ?? 0}\u0001`);
  return hash.digest("base64url");
}

function loaderFor(): DocLoader {
  const memo = new Map<string, Promise<Record<string, unknown> | null>>();
  return (path) => {
    let pending = memo.get(path);
    if (!pending) {
      pending = readDocs(pool, [path]).then((found) => found.get(path)?.data ?? null);
      memo.set(path, pending);
    }
    return pending;
  };
}

async function readable(caller: Caller, docs: WireDoc[], load: DocLoader): Promise<WireDoc[]> {
  const verdicts = await Promise.all(docs.map((doc) => canRead(caller, doc.path, doc.data, load)));
  return docs.filter((_, index) => verdicts[index]);
}

async function handle(op: Op, caller: Caller, load: DocLoader): Promise<unknown> {
  switch (op.kind) {
    case "query": {
      const spec = cleanSpec(op.spec);
      if (!hasRule(collectionKey(spec.parent, spec.collection, !!spec.group))) return { ok: false, code: "permission-denied" };
      const docs = await readable(caller, await runQuery(pool, spec), load);
      const hash = hashDocs(docs);
      if (op.since && op.since === hash) return { ok: true, unchanged: true, hash };
      return { ok: true, docs, hash };
    }
    case "count": {
      const spec = cleanSpec(op.spec);
      const key = collectionKey(spec.parent, spec.collection, !!spec.group);
      if (!hasRule(key)) return { ok: false, code: "permission-denied" };
      // The admin reads everything, so a count is just a count. Anyone else
      // is told how many of the matching documents they may read.
      if (caller.role === "admin") return { ok: true, count: await countQuery(pool, spec) };
      const docs = await readable(caller, await runQuery(pool, spec), load);
      return { ok: true, count: docs.length };
    }
    case "get": {
      const path = cleanPath(op.path, "doc");
      const found = (await readDocs(pool, [path])).get(path) ?? null;
      if (!(await canRead(caller, path, found?.data ?? null, load))) return { ok: false, code: "permission-denied" };
      const hash = found ? hashDocs([found]) : "none";
      if (op.since && op.since === hash) return { ok: true, unchanged: true, hash };
      return { ok: true, doc: found, hash };
    }
    case "update": {
      const path = cleanPath(op.path, "doc");
      const data = op.data && typeof op.data === "object" ? op.data : {};
      if (!canClientUpdate(caller, path, Object.keys(data))) return { ok: false, code: "permission-denied" };
      const decoded = decodeValue(data) as Record<string, unknown>;
      await getAdminDb().doc(path).update(decoded);
      return { ok: true };
    }
    default:
      return { ok: false, code: "invalid-argument" };
  }
}

export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  let caller: Caller;
  try {
    const auth = await verifyAuth(token);
    caller = { uid: auth.uid, role: auth.role, managerKind: auth.managerKind ?? null };
  } catch (error) {
    const message = error instanceof AuthError ? error.message : "Not signed in.";
    return NextResponse.json({ error: message, code: "unauthenticated" }, { status: 401 });
  }

  let ops: Op[];
  try {
    const body = (await request.json()) as { ops?: Op[] };
    ops = Array.isArray(body.ops) ? body.ops.slice(0, MAX_OPS) : [];
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  const load = loaderFor();
  const results = await Promise.all(
    ops.map(async (op) => {
      try {
        return await handle(op, caller, load);
      } catch (error) {
        if (error instanceof BadRequest) return { ok: false, code: "invalid-argument", error: error.message };
        console.error("[api/db]", op.kind, error);
        return { ok: false, code: "internal", error: "The database could not answer this request." };
      }
    })
  );
  return NextResponse.json({ results }, { headers: { "cache-control": "no-store" } });
}
