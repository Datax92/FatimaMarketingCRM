import "server-only";
import type { PoolClient } from "pg";
import {
  DOC_ID_FIELD,
  Timestamp,
  autoId,
  decodeValue,
  docPathParts,
  encodeValue,
  splitPath,
  type FilterSpec,
  type OrderSpec,
  type QuerySpec,
  type WhereOp,
  type WireDoc,
} from "./codec.ts";
import { pool, withTransaction, type Exec } from "./pg.ts";
import {
  countQuery,
  deleteTree,
  listCollectionIds,
  listDocumentPaths,
  lockPaths,
  persist,
  readDocs,
  runQuery,
  type Persist,
} from "./store.ts";

/**
 * **The document store, on Neon Postgres.**
 *
 * This is the subset of the `firebase-admin/firestore` API the CRM's server
 * code actually calls — collections, documents, queries, batches,
 * transactions, `FieldValue` — implemented over one Postgres table. It exists
 * so that the business logic in `app/actions/*` (hundreds of rules, each
 * with its reasons written beside it) moves to Postgres without being
 * rewritten and re-broken. What changed underneath:
 *
 * - **No daily read/write/delete caps.** Postgres bills compute and storage,
 *   not documents.
 * - **Transactions are Postgres transactions.** A document read in one takes
 *   a transaction-scoped lock on its path, so two writers serialise exactly as
 *   Firestore's optimistic transactions did — and a deadlock is retried.
 * - **A batch is one SQL transaction** with a handful of round trips however
 *   many documents it touches.
 *
 * Every write to a top-level `leads/{id}` document still stamps `updatedAt`
 * (see `lib/leadStamp`), here rather than by patching the SDK.
 */

export { Timestamp };
export type DocumentData = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type UpdateData<T = DocumentData> = Partial<T> & DocumentData;
export type WithFieldValue<T> = T | DocumentData;
export type PartialWithFieldValue<T> = Partial<T> | DocumentData;
export interface SetOptions {
  merge?: boolean;
  mergeFields?: string[];
}
export type OrderByDirection = "asc" | "desc";
export type WhereFilterOp = WhereOp;

/* -------------------------------------------------------------------------- */
/* Errors, in Firestore's shape                                                */
/* -------------------------------------------------------------------------- */

export class FirestoreError extends Error {
  readonly code: number;
  readonly details: string;
  constructor(code: number, status: string, message: string) {
    super(`${code} ${status}: ${message}`);
    this.name = "FirestoreError";
    this.code = code;
    this.details = message;
  }
}

const notFound = (path: string) => new FirestoreError(5, "NOT_FOUND", `No document to update: ${path}`);
const alreadyExists = (path: string) => new FirestoreError(6, "ALREADY_EXISTS", `Document already exists: ${path}`);

/* -------------------------------------------------------------------------- */
/* FieldValue / FieldPath                                                      */
/* -------------------------------------------------------------------------- */

type FieldValueKind = "serverTimestamp" | "increment" | "arrayUnion" | "arrayRemove" | "delete";

export class FieldValue {
  readonly kind: FieldValueKind;
  readonly operand: unknown;

  private constructor(kind: FieldValueKind, operand?: unknown) {
    this.kind = kind;
    this.operand = operand;
  }

  static serverTimestamp(): FieldValue {
    return new FieldValue("serverTimestamp");
  }
  static increment(n: number): FieldValue {
    return new FieldValue("increment", n);
  }
  static arrayUnion(...elements: unknown[]): FieldValue {
    return new FieldValue("arrayUnion", elements);
  }
  static arrayRemove(...elements: unknown[]): FieldValue {
    return new FieldValue("arrayRemove", elements);
  }
  static delete(): FieldValue {
    return new FieldValue("delete");
  }

  isEqual(other: FieldValue): boolean {
    return other instanceof FieldValue && other.kind === this.kind && JSON.stringify(other.operand) === JSON.stringify(this.operand);
  }
}

export class FieldPath {
  readonly segments: string[];
  constructor(...segments: string[]) {
    this.segments = segments;
  }
  static documentId(): FieldPath {
    return new FieldPath(DOC_ID_FIELD);
  }
  toString(): string {
    return this.segments.join(".");
  }
  isEqual(other: FieldPath): boolean {
    return other instanceof FieldPath && other.toString() === this.toString();
  }
}

function fieldName(field: string | FieldPath): string {
  return typeof field === "string" ? field : field.toString();
}

/* -------------------------------------------------------------------------- */
/* Applying a write to a stored (encoded) document                             */
/* -------------------------------------------------------------------------- */

type Json = Record<string, unknown>;

function isPlain(value: unknown): value is Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function getAt(data: Json, segments: string[]): unknown {
  let cursor: unknown = data;
  for (const segment of segments) {
    if (!isPlain(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function setAt(data: Json, segments: string[], value: unknown): void {
  let cursor = data;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = cursor[segments[i]];
    if (!isPlain(next)) cursor[segments[i]] = {};
    cursor = cursor[segments[i]] as Json;
  }
  cursor[segments[segments.length - 1]] = value;
}

function deleteAt(data: Json, segments: string[]): void {
  let cursor: unknown = data;
  for (let i = 0; i < segments.length - 1; i++) {
    if (!isPlain(cursor)) return;
    cursor = cursor[segments[i]];
  }
  if (isPlain(cursor)) delete cursor[segments[segments.length - 1]];
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The stored value a sentinel produces, given what was there before. */
function resolveSentinel(sentinel: FieldValue, previous: unknown, nowMs: number): unknown {
  switch (sentinel.kind) {
    case "serverTimestamp":
      return encodeValue(Timestamp.fromMillis(nowMs));
    case "increment": {
      const base = typeof previous === "number" ? previous : 0;
      return base + Number(sentinel.operand);
    }
    case "arrayUnion": {
      const base = Array.isArray(previous) ? [...previous] : [];
      for (const element of sentinel.operand as unknown[]) {
        const encoded = encodeValue(element);
        if (!base.some((item) => sameJson(item, encoded))) base.push(encoded);
      }
      return base;
    }
    case "arrayRemove": {
      const base = Array.isArray(previous) ? previous : [];
      const removals = (sentinel.operand as unknown[]).map((element) => encodeValue(element));
      return base.filter((item) => !removals.some((removal) => sameJson(item, removal)));
    }
    default:
      return undefined;
  }
}

/** Writes one user value at `segments`, resolving sentinels against `target`. */
function writeValue(target: Json, segments: string[], value: unknown, nowMs: number): void {
  if (value instanceof FieldValue) {
    if (value.kind === "delete") {
      deleteAt(target, segments);
      return;
    }
    setAt(target, segments, resolveSentinel(value, getAt(target, segments), nowMs));
    return;
  }
  if (value === undefined) return;
  setAt(target, segments, encodeWithSentinels(value, nowMs));
}

/** Encodes a value that may contain sentinels nested inside maps (e.g. a `set` without merge). */
function encodeWithSentinels(value: unknown, nowMs: number): unknown {
  if (value instanceof FieldValue) {
    return value.kind === "delete" ? undefined : resolveSentinel(value, undefined, nowMs);
  }
  if (isPlain(value)) {
    const out: Json = {};
    for (const [key, item] of Object.entries(value)) {
      const encoded = encodeWithSentinels(item, nowMs);
      if (encoded !== undefined) out[key] = encoded;
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : encodeWithSentinels(item, nowMs)));
  return encodeValue(value);
}

/** Merges `source` into `target` leaf by leaf (maps recurse, everything else replaces). */
function mergeInto(target: Json, source: Json, prefix: string[], nowMs: number): void {
  for (const [key, value] of Object.entries(source)) {
    const segments = [...prefix, key];
    if (isPlain(value) && Object.keys(value).length > 0) {
      const existing = getAt(target, segments);
      if (!isPlain(existing)) setAt(target, segments, {});
      mergeInto(target, value, segments, nowMs);
    } else if (isPlain(value)) {
      if (!isPlain(getAt(target, segments))) setAt(target, segments, {});
    } else {
      writeValue(target, segments, value, nowMs);
    }
  }
}

type WriteOp =
  | { kind: "set"; path: string; data: Json; options?: SetOptions }
  | { kind: "update"; path: string; data: Json }
  | { kind: "create"; path: string; data: Json }
  | { kind: "delete"; path: string };

function isLeadDoc(path: string): boolean {
  const parts = splitPath(path);
  return parts.length === 2 && parts[0] === "leads";
}

function withLeadStamp(op: WriteOp): WriteOp {
  if (op.kind === "delete" || !isLeadDoc(op.path) || "updatedAt" in op.data) return op;
  if (op.kind === "set" && op.options?.mergeFields && !op.options.mergeFields.includes("updatedAt")) {
    return { ...op, data: { ...op.data, updatedAt: FieldValue.serverTimestamp() }, options: { mergeFields: [...op.options.mergeFields, "updatedAt"] } };
  }
  return { ...op, data: { ...op.data, updatedAt: FieldValue.serverTimestamp() } } as WriteOp;
}

function clone(value: Json | null): Json | null {
  return value === null ? null : (JSON.parse(JSON.stringify(value)) as Json);
}

/** One write applied to the document's current stored form. `null` = no document. */
function applyWrite(current: Json | null, raw: WriteOp, nowMs: number): Json | null {
  const op = withLeadStamp(raw);
  switch (op.kind) {
    case "delete":
      return null;
    case "create": {
      if (current !== null) throw alreadyExists(op.path);
      return (encodeWithSentinels(op.data, nowMs) as Json) ?? {};
    }
    case "set": {
      if (op.options?.mergeFields) {
        const next = clone(current) ?? {};
        for (const field of op.options.mergeFields) {
          const segments = field.split(".");
          const value = getAt(op.data as Json, segments);
          if (value === undefined) deleteAt(next, segments);
          else writeValue(next, segments, value, nowMs);
        }
        return next;
      }
      if (op.options?.merge) {
        const next = clone(current) ?? {};
        mergeInto(next, op.data, [], nowMs);
        return next;
      }
      return (encodeWithSentinels(op.data, nowMs) as Json) ?? {};
    }
    case "update": {
      if (current === null) throw notFound(op.path);
      const next = clone(current)!;
      for (const [field, value] of Object.entries(op.data)) {
        writeValue(next, field.split("."), value, nowMs);
      }
      return next;
    }
  }
}

/** Applies `ops` in order against what is stored, takes the locks, and persists the result. */
async function commitWrites(exec: Exec, ops: WriteOp[]): Promise<WriteResult[]> {
  if (ops.length === 0) return [];
  const paths = ops.map((op) => op.path);
  await lockPaths(exec, paths);
  const stored = await readDocs(exec, paths);

  const state = new Map<string, { data: Json | null; existed: boolean }>();
  for (const path of new Set(paths)) {
    const prior = stored.get(path) ?? null;
    state.set(path, { data: prior ? clone(prior.data) : null, existed: !!prior });
  }

  const now = new Date();
  const nowMs = now.getTime();
  for (const op of ops) {
    const entry = state.get(op.path)!;
    entry.data = applyWrite(entry.data, op, nowMs);
  }

  const writes: Persist[] = [];
  for (const [path, entry] of state) {
    if (entry.data === null && !entry.existed) continue;
    writes.push({ path, data: entry.data, existed: entry.existed });
  }
  await persist(exec, writes, now);
  const writeTime = Timestamp.fromMillis(nowMs);
  return ops.map(() => new WriteResult(writeTime));
}

/* -------------------------------------------------------------------------- */
/* Snapshots                                                                   */
/* -------------------------------------------------------------------------- */

export class WriteResult {
  readonly writeTime: Timestamp;
  constructor(writeTime: Timestamp) {
    this.writeTime = writeTime;
  }
}

export class DocumentSnapshot<T = DocumentData> {
  readonly ref: DocumentReference<T>;
  readonly id: string;
  readonly exists: boolean;
  readonly createTime?: Timestamp;
  readonly updateTime?: Timestamp;
  readonly readTime: Timestamp;
  private readonly stored: Json | null;
  private decoded?: T;

  constructor(ref: DocumentReference<T>, wire: WireDoc | null) {
    this.ref = ref;
    this.id = ref.id;
    this.exists = wire !== null;
    this.stored = wire?.data ?? null;
    this.createTime = wire?.createTime !== undefined ? Timestamp.fromMillis(wire.createTime) : undefined;
    this.updateTime = wire?.updateTime !== undefined ? Timestamp.fromMillis(wire.updateTime) : undefined;
    this.readTime = Timestamp.now();
  }

  data(): T | undefined {
    if (this.stored === null) return undefined;
    if (!this.decoded) this.decoded = decodeValue(this.stored, (path) => this.ref.firestore.doc(path)) as T;
    return this.decoded;
  }

  get(field: string | FieldPath): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    const data = this.data() as Json | undefined;
    if (!data) return undefined;
    return getAt(data, fieldName(field).split("."));
  }

  isEqual(other: DocumentSnapshot<T>): boolean {
    return other.ref.path === this.ref.path && sameJson(other.stored, this.stored);
  }
}

export class QueryDocumentSnapshot<T = DocumentData> extends DocumentSnapshot<T> {
  data(): T {
    return super.data() as T;
  }
}

export interface DocumentChange<T = DocumentData> {
  type: "added" | "modified" | "removed";
  doc: QueryDocumentSnapshot<T>;
  oldIndex: number;
  newIndex: number;
}

export class QuerySnapshot<T = DocumentData> {
  readonly query: Query<T>;
  readonly docs: QueryDocumentSnapshot<T>[];
  readonly readTime: Timestamp;

  constructor(query: Query<T>, docs: QueryDocumentSnapshot<T>[]) {
    this.query = query;
    this.docs = docs;
    this.readTime = Timestamp.now();
  }
  get size(): number {
    return this.docs.length;
  }
  get empty(): boolean {
    return this.docs.length === 0;
  }
  forEach(callback: (doc: QueryDocumentSnapshot<T>) => void): void {
    this.docs.forEach(callback);
  }
  docChanges(): DocumentChange<T>[] {
    return this.docs.map((doc, index) => ({ type: "added", doc, oldIndex: -1, newIndex: index }));
  }
}

/* -------------------------------------------------------------------------- */
/* Queries and references                                                      */
/* -------------------------------------------------------------------------- */

export class AggregateQuerySnapshot {
  private readonly value: { count: number };
  constructor(count: number) {
    this.value = { count };
  }
  data(): { count: number } {
    return this.value;
  }
}

export class AggregateQuery {
  readonly query: Query;
  constructor(query: Query) {
    this.query = query;
  }
  async get(): Promise<AggregateQuerySnapshot> {
    return new AggregateQuerySnapshot(await countQuery(this.query.firestore.exec, this.query.spec));
  }
}

function encodeCursorValue(value: unknown): unknown {
  return encodeValue(value);
}

export class Query<T = DocumentData> {
  readonly firestore: Firestore;
  readonly spec: QuerySpec;
  protected readonly offsetBy?: number;

  constructor(firestore: Firestore, spec: QuerySpec, offsetBy?: number) {
    this.firestore = firestore;
    this.spec = spec;
    this.offsetBy = offsetBy;
  }

  protected derive(patch: Partial<QuerySpec>, offsetBy = this.offsetBy): Query<T> {
    return new Query<T>(this.firestore, { ...this.spec, ...patch }, offsetBy);
  }

  where(field: string | FieldPath, op: WhereFilterOp, value: unknown): Query<T> {
    const name = fieldName(field);
    const encoded =
      op === "in" || op === "not-in" || op === "array-contains-any"
        ? (value as unknown[]).map((item) => (item instanceof DocumentReference ? item.path : encodeValue(item)))
        : value instanceof DocumentReference
          ? name === DOC_ID_FIELD
            ? value.path
            : encodeValue(value)
          : encodeValue(value);
    const filter: FilterSpec = { field: name, op, value: encoded };
    return this.derive({ filters: [...this.spec.filters, filter] });
  }

  orderBy(field: string | FieldPath, direction: OrderByDirection = "asc"): Query<T> {
    const order: OrderSpec = { field: fieldName(field), dir: direction };
    return this.derive({ orders: [...this.spec.orders, order] });
  }

  limit(n: number): Query<T> {
    return this.derive({ limit: n, limitToLast: false });
  }

  limitToLast(n: number): Query<T> {
    return this.derive({ limit: n, limitToLast: true });
  }

  offset(n: number): Query<T> {
    return this.derive({}, n);
  }

  select(..._fields: (string | FieldPath)[]): Query<T> {
    void _fields;
    return this;
  }

  private cursorValues(args: unknown[]): unknown[] {
    if (args.length === 1 && args[0] instanceof DocumentSnapshot) {
      const snap = args[0] as DocumentSnapshot;
      const values = this.spec.orders.map((order) =>
        order.field === DOC_ID_FIELD ? snap.ref.path : encodeCursorValue(snap.get(order.field))
      );
      if (!this.spec.orders.some((order) => order.field === DOC_ID_FIELD)) values.push(snap.ref.path);
      return values;
    }
    return args.map((value, index) =>
      this.spec.orders[index]?.field === DOC_ID_FIELD
        ? `${this.spec.group ? "" : this.pathPrefix()}${String(value)}`
        : encodeCursorValue(value)
    );
  }

  private pathPrefix(): string {
    return this.spec.parent ? `${this.spec.parent}/${this.spec.collection}/` : `${this.spec.collection}/`;
  }

  startAfter(...args: unknown[]): Query<T> {
    return this.derive({ startAfter: this.cursorValues(args), startAt: undefined });
  }

  startAt(...args: unknown[]): Query<T> {
    return this.derive({ startAt: this.cursorValues(args), startAfter: undefined });
  }

  count(): AggregateQuery {
    return new AggregateQuery(this as unknown as Query);
  }

  withConverter<U>(): Query<U> {
    return this as unknown as Query<U>;
  }

  async get(): Promise<QuerySnapshot<T>> {
    return fetchQuery(this, this.firestore.exec);
  }

  async stream(): Promise<QueryDocumentSnapshot<T>[]> {
    return (await this.get()).docs;
  }

  isEqual(other: Query<T>): boolean {
    return sameJson(other.spec, this.spec);
  }
}

async function fetchQuery<T>(query: Query<T>, exec: Exec, lock = false): Promise<QuerySnapshot<T>> {
  const offset = (query as unknown as { offsetBy?: number }).offsetBy;
  const wires = await runQuery(exec, query.spec, offset);
  if (lock && wires.length > 0) await lockPaths(exec, wires.map((wire) => wire.path));
  const docs = wires.map((wire) => new QueryDocumentSnapshot<T>(query.firestore.doc(wire.path) as DocumentReference<T>, wire));
  return new QuerySnapshot<T>(query, docs);
}

export class CollectionReference<T = DocumentData> extends Query<T> {
  readonly id: string;
  readonly path: string;

  constructor(firestore: Firestore, path: string) {
    const parts = splitPath(path);
    if (parts.length % 2 !== 1) throw new Error(`Not a collection path: "${path}"`);
    super(firestore, { parent: parts.slice(0, -1).join("/"), collection: parts[parts.length - 1], filters: [], orders: [] });
    this.id = parts[parts.length - 1];
    this.path = parts.join("/");
  }

  get parent(): DocumentReference | null {
    return this.spec.parent ? this.firestore.doc(this.spec.parent) : null;
  }

  doc(id?: string): DocumentReference<T> {
    return new DocumentReference<T>(this.firestore, `${this.path}/${id ?? autoId()}`);
  }

  async add(data: WithFieldValue<T>): Promise<DocumentReference<T>> {
    const ref = this.doc();
    await ref.create(data as DocumentData);
    return ref;
  }

  async listDocuments(): Promise<DocumentReference<T>[]> {
    const paths = await listDocumentPaths(this.firestore.exec, this.spec.parent, this.id);
    return paths.map((path) => new DocumentReference<T>(this.firestore, path));
  }
}

export class DocumentReference<T = DocumentData> {
  readonly __isDocRef = true as const;
  readonly firestore: Firestore;
  readonly path: string;
  readonly id: string;

  constructor(firestore: Firestore, path: string) {
    const parts = splitPath(path);
    if (parts.length === 0 || parts.length % 2 !== 0) throw new Error(`Not a document path: "${path}"`);
    this.firestore = firestore;
    this.path = parts.join("/");
    this.id = parts[parts.length - 1];
  }

  get parent(): CollectionReference<T> {
    const { parent, collection } = docPathParts(this.path);
    return new CollectionReference<T>(this.firestore, parent ? `${parent}/${collection}` : collection);
  }

  collection(id: string): CollectionReference {
    return new CollectionReference(this.firestore, `${this.path}/${id}`);
  }

  async listCollections(): Promise<CollectionReference[]> {
    const ids = await listCollectionIds(this.firestore.exec, this.path);
    return ids.map((id) => this.collection(id));
  }

  async get(): Promise<DocumentSnapshot<T>> {
    const found = await readDocs(this.firestore.exec, [this.path]);
    return new DocumentSnapshot<T>(this, found.get(this.path) ?? null);
  }

  async set(data: WithFieldValue<T> | PartialWithFieldValue<T>, options?: SetOptions): Promise<WriteResult> {
    return this.firestore.batch().set(this, data, options).commit().then((results) => results[0]);
  }

  async update(data: UpdateData<T> | string, ...more: unknown[]): Promise<WriteResult> {
    return this.firestore
      .batch()
      .update(this, data as UpdateData<T>, ...more)
      .commit()
      .then((results) => results[0]);
  }

  async create(data: WithFieldValue<T>): Promise<WriteResult> {
    return this.firestore.batch().create(this, data).commit().then((results) => results[0]);
  }

  async delete(): Promise<WriteResult> {
    return this.firestore.batch().delete(this).commit().then((results) => results[0]);
  }

  withConverter<U>(): DocumentReference<U> {
    return this as unknown as DocumentReference<U>;
  }

  isEqual(other: DocumentReference<T>): boolean {
    return other instanceof DocumentReference && other.path === this.path;
  }
}

/* -------------------------------------------------------------------------- */
/* Batches and transactions                                                    */
/* -------------------------------------------------------------------------- */

function updateFields(data: unknown, more: unknown[]): Json {
  if (typeof data === "string" || data instanceof FieldPath) {
    const out: Json = { [fieldName(data)]: more[0] };
    for (let i = 1; i + 1 < more.length; i += 2) out[fieldName(more[i] as string | FieldPath)] = more[i + 1];
    return out;
  }
  return data as Json;
}

export class WriteBatch {
  protected readonly firestore: Firestore;
  protected readonly ops: WriteOp[] = [];

  constructor(firestore: Firestore) {
    this.firestore = firestore;
  }

  set<T>(ref: DocumentReference<T>, data: WithFieldValue<T> | PartialWithFieldValue<T>, options?: SetOptions): this {
    this.ops.push({ kind: "set", path: ref.path, data: data as Json, options });
    return this;
  }

  update<T>(ref: DocumentReference<T>, data: UpdateData<T> | string | FieldPath, ...more: unknown[]): this {
    this.ops.push({ kind: "update", path: ref.path, data: updateFields(data, more) });
    return this;
  }

  create<T>(ref: DocumentReference<T>, data: WithFieldValue<T>): this {
    this.ops.push({ kind: "create", path: ref.path, data: data as Json });
    return this;
  }

  delete<T>(ref: DocumentReference<T>): this {
    this.ops.push({ kind: "delete", path: ref.path });
    return this;
  }

  get size(): number {
    return this.ops.length;
  }

  async commit(): Promise<WriteResult[]> {
    const ops = this.ops.splice(0);
    if (ops.length === 0) return [];
    return withTransaction((client) => commitWrites(client, ops));
  }
}

export class Transaction {
  private readonly firestore: Firestore;
  private readonly client: PoolClient;
  private readonly ops: WriteOp[] = [];

  constructor(firestore: Firestore, client: PoolClient) {
    this.firestore = firestore;
    this.client = client;
  }

  get(ref: DocumentReference<any>): Promise<DocumentSnapshot<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  get(query: Query<any>): Promise<QuerySnapshot<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  get(query: AggregateQuery): Promise<AggregateQuerySnapshot>;
  async get(target: DocumentReference | Query | AggregateQuery): Promise<unknown> {
    if (target instanceof DocumentReference) {
      const [snap] = await this.getAll(target);
      return snap;
    }
    if (target instanceof AggregateQuery) {
      return new AggregateQuerySnapshot(await countQuery(this.client, target.query.spec));
    }
    const snap = await fetchQuery(target, this.client, true);
    return snap;
  }

  async getAll<T>(...refs: (DocumentReference<T> | { fieldMask?: string[] })[]): Promise<DocumentSnapshot<T>[]> {
    const docRefs = refs.filter((ref): ref is DocumentReference<T> => ref instanceof DocumentReference);
    await lockPaths(this.client, docRefs.map((ref) => ref.path));
    const found = await readDocs(this.client, docRefs.map((ref) => ref.path));
    return docRefs.map((ref) => {
      return new DocumentSnapshot<T>(ref, found.get(ref.path) ?? null);
    });
  }

  set<T>(ref: DocumentReference<T>, data: WithFieldValue<T> | PartialWithFieldValue<T>, options?: SetOptions): this {
    this.ops.push({ kind: "set", path: ref.path, data: data as Json, options });
    return this;
  }

  update<T>(ref: DocumentReference<T>, data: UpdateData<T> | string | FieldPath, ...more: unknown[]): this {
    this.ops.push({ kind: "update", path: ref.path, data: updateFields(data, more) });
    return this;
  }

  create<T>(ref: DocumentReference<T>, data: WithFieldValue<T>): this {
    this.ops.push({ kind: "create", path: ref.path, data: data as Json });
    return this;
  }

  delete<T>(ref: DocumentReference<T>): this {
    this.ops.push({ kind: "delete", path: ref.path });
    return this;
  }

  /** @internal */
  async commit(): Promise<void> {
    // Everything this transaction read is already locked; the writes lock and
    // re-read their own targets inside the same SQL transaction.
    await commitWrites(this.client, this.ops);
  }
}

/** Collects writes and commits them in batches; the API most callers use is `set/update/delete` + `close`. */
export class BulkWriter {
  private readonly firestore: Firestore;
  private pending: WriteOp[] = [];
  private flushing: Promise<void> = Promise.resolve();
  private errorHandler?: (error: unknown) => boolean;

  constructor(firestore: Firestore) {
    this.firestore = firestore;
  }

  private enqueue(op: WriteOp): Promise<WriteResult> {
    this.pending.push(op);
    if (this.pending.length >= 400) void this.flush();
    return Promise.resolve(new WriteResult(Timestamp.now()));
  }

  set<T>(ref: DocumentReference<T>, data: WithFieldValue<T>, options?: SetOptions): Promise<WriteResult> {
    return this.enqueue({ kind: "set", path: ref.path, data: data as Json, options });
  }
  update<T>(ref: DocumentReference<T>, data: UpdateData<T>): Promise<WriteResult> {
    return this.enqueue({ kind: "update", path: ref.path, data: data as Json });
  }
  create<T>(ref: DocumentReference<T>, data: WithFieldValue<T>): Promise<WriteResult> {
    return this.enqueue({ kind: "create", path: ref.path, data: data as Json });
  }
  delete<T>(ref: DocumentReference<T>): Promise<WriteResult> {
    return this.enqueue({ kind: "delete", path: ref.path });
  }
  onWriteError(handler: (error: unknown) => boolean): void {
    this.errorHandler = handler;
  }
  onWriteResult(): void {
    /* not needed */
  }

  flush(): Promise<void> {
    const ops = this.pending.splice(0);
    if (ops.length === 0) return this.flushing;
    this.flushing = this.flushing.then(async () => {
      try {
        await withTransaction((client) => commitWrites(client, ops));
      } catch (error) {
        if (!this.errorHandler?.(error)) throw error;
      }
    });
    return this.flushing;
  }

  async close(): Promise<void> {
    await this.flush();
  }
}

/* -------------------------------------------------------------------------- */
/* The database                                                                */
/* -------------------------------------------------------------------------- */

export class Firestore {
  /** Where reads outside a transaction go. */
  readonly exec: Exec;

  constructor(exec: Exec = pool) {
    this.exec = exec;
  }

  collection(path: string): CollectionReference {
    return new CollectionReference(this, path);
  }

  doc(path: string): DocumentReference {
    return new DocumentReference(this, path);
  }

  collectionGroup(collectionId: string): Query {
    return new Query(this, { parent: "", collection: collectionId, group: true, filters: [], orders: [] });
  }

  batch(): WriteBatch {
    return new WriteBatch(this);
  }

  bulkWriter(): BulkWriter {
    return new BulkWriter(this);
  }

  async getAll<T = DocumentData>(...refs: (DocumentReference<T> | { fieldMask?: string[] })[]): Promise<DocumentSnapshot<T>[]> {
    const docRefs = refs.filter((ref): ref is DocumentReference<T> => ref instanceof DocumentReference);
    const found = await readDocs(this.exec, docRefs.map((ref) => ref.path));
    return docRefs.map((ref) => new DocumentSnapshot<T>(ref, found.get(ref.path) ?? null));
  }

  async runTransaction<R>(fn: (tx: Transaction) => Promise<R>, options?: { maxAttempts?: number; readOnly?: boolean }): Promise<R> {
    return withTransaction(async (client) => {
      const tx = new Transaction(this, client);
      const result = await fn(tx);
      await tx.commit();
      return result;
    }, options?.maxAttempts ?? 5);
  }

  async recursiveDelete(ref: DocumentReference | CollectionReference): Promise<void> {
    await deleteTree(this.exec, ref.path);
  }

  async listCollections(): Promise<CollectionReference[]> {
    const ids = await listCollectionIds(this.exec, "");
    return ids.map((id) => this.collection(id));
  }

  settings(): void {
    /* nothing to configure */
  }

  async terminate(): Promise<void> {
    /* the pool outlives a request */
  }
}

let instance: Firestore | null = null;

/** The one document store. Named after the function every caller already uses. */
export function getFirestore(..._ignored: unknown[]): Firestore {
  void _ignored;
  if (!instance) instance = new Firestore();
  return instance;
}

export const initializeFirestore = getFirestore;
