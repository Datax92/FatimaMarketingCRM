/**
 * How a document's values are stored in Postgres, shared by the server store
 * and the browser client.
 *
 * Every document is one `jsonb` value. JSON has no timestamp type, so a
 * timestamp is stored as `{"__t": <milliseconds>}`. That shape was chosen for
 * how Postgres compares `jsonb`: two single-key objects with the same key
 * compare by their values, so `{"__t": 1}` < `{"__t": 2}` and a btree index on
 * a timestamp field sorts by time — `where('createdAt', '>=', date)` and
 * `orderBy('createdAt')` run in SQL, on an index, with no special casing.
 *
 * A document reference is `{"__ref": "leads/abc"}`. Nothing else is special.
 *
 * This module must stay free of Node and of `pg`: the browser imports it.
 */

export const TS_KEY = "__t";
export const REF_KEY = "__ref";

/** The one timestamp class, on the server and in the browser. */
export class Timestamp {
  readonly seconds: number;
  readonly nanoseconds: number;

  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  static now(): Timestamp {
    return Timestamp.fromMillis(Date.now());
  }

  static fromDate(date: Date): Timestamp {
    return Timestamp.fromMillis(date.getTime());
  }

  static fromMillis(ms: number): Timestamp {
    const seconds = Math.floor(ms / 1000);
    const nanoseconds = Math.round((ms - seconds * 1000) * 1e6);
    return new Timestamp(seconds, nanoseconds);
  }

  toMillis(): number {
    return this.seconds * 1000 + this.nanoseconds / 1e6;
  }

  toDate(): Date {
    return new Date(this.toMillis());
  }

  isEqual(other: Timestamp): boolean {
    return other instanceof Timestamp && other.seconds === this.seconds && other.nanoseconds === this.nanoseconds;
  }

  valueOf(): string {
    // Lets `<` / `>` compare two timestamps the way Firestore's own class does.
    return String(this.seconds + 1e12).padStart(16, "0") + String(this.nanoseconds).padStart(9, "0");
  }

  toJSON(): { seconds: number; nanoseconds: number } {
    return { seconds: this.seconds, nanoseconds: this.nanoseconds };
  }

  toString(): string {
    return `Timestamp(seconds=${this.seconds}, nanoseconds=${this.nanoseconds})`;
  }
}

/** Anything with a path that should be stored as a reference. */
export interface PathLike {
  readonly path: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function looksLikeTimestamp(value: unknown): value is { toMillis(): number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toMillis?: unknown }).toMillis === "function" &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  );
}

function looksLikeRef(value: unknown): value is PathLike & { __isDocRef: true } {
  return typeof value === "object" && value !== null && (value as { __isDocRef?: unknown }).__isDocRef === true;
}

/**
 * A value as it will be stored. `undefined` is dropped (the caller removes the
 * key), a non-finite number becomes null — `jsonb` cannot hold either.
 */
export function encodeValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Timestamp || looksLikeTimestamp(value)) return { [TS_KEY]: (value as Timestamp).toMillis() };
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : { [TS_KEY]: value.getTime() };
  if (looksLikeRef(value)) return { [REF_KEY]: value.path };
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : encodeValue(item)));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const encoded = encodeValue(item);
      if (encoded !== undefined) out[key] = encoded;
    }
    return out;
  }
  if (typeof value === "object") {
    // A class instance that is not one of ours — store its own fields, as
    // Firestore's REST transport would.
    return encodeValue({ ...(value as Record<string, unknown>) });
  }
  return value;
}

export type RefFactory = (path: string) => unknown;

/** A stored value back to what application code expects. */
export function decodeValue(value: unknown, makeRef?: RefFactory): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => decodeValue(item, makeRef));
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1) {
    if (keys[0] === TS_KEY && typeof record[TS_KEY] === "number") return Timestamp.fromMillis(record[TS_KEY] as number);
    if (keys[0] === REF_KEY && typeof record[REF_KEY] === "string") {
      return makeRef ? makeRef(record[REF_KEY] as string) : { path: record[REF_KEY], id: String(record[REF_KEY]).split("/").pop() };
    }
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = decodeValue(record[key], makeRef);
  return out;
}

/* -------------------------------------------------------------------------- */
/* The query descriptor — what a query *is*, as plain JSON                      */
/* -------------------------------------------------------------------------- */

export type WhereOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in" | "array-contains" | "array-contains-any";

/** `__name__` is the document id, as `documentId()` / `FieldPath.documentId()`. */
export const DOC_ID_FIELD = "__name__";

export interface FilterSpec {
  field: string;
  op: WhereOp;
  /** Encoded with `encodeValue`. */
  value: unknown;
}

export interface OrderSpec {
  field: string;
  dir: "asc" | "desc";
}

export interface QuerySpec {
  /** Path of the parent document, `""` for a top-level collection. Ignored for a group. */
  parent: string;
  /** The collection id. */
  collection: string;
  /** `collectionGroup(collection)` — every collection with this id, anywhere. */
  group?: boolean;
  filters: FilterSpec[];
  orders: OrderSpec[];
  limit?: number;
  limitToLast?: boolean;
  /** Encoded cursor values, one per order (the id last), from `startAfter`. */
  startAfter?: unknown[];
  startAt?: unknown[];
}

/** One stored document as it travels between the server and the browser. */
export interface WireDoc {
  path: string;
  /** Encoded data. */
  data: Record<string, unknown>;
  createTime?: number;
  updateTime?: number;
}

export function splitPath(path: string): string[] {
  return path.split("/").filter((part) => part.length > 0);
}

export function lastSegment(path: string): string {
  const parts = splitPath(path);
  return parts[parts.length - 1] ?? "";
}

/** `leads/abc/followUps/x` → `{ parent: "leads/abc", collection: "followUps", id: "x" }`. */
export function docPathParts(path: string): { parent: string; collection: string; id: string } {
  const parts = splitPath(path);
  if (parts.length < 2 || parts.length % 2 !== 0) throw new Error(`Not a document path: "${path}"`);
  return {
    parent: parts.slice(0, -2).join("/"),
    collection: parts[parts.length - 2],
    id: parts[parts.length - 1],
  };
}

/** A short random id in Firestore's own alphabet and length. */
export function autoId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  const cryptoObj = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(20));
    for (let i = 0; i < 20; i++) out += chars[bytes[i] % chars.length];
    return out;
  }
  for (let i = 0; i < 20; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
