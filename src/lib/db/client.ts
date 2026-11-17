"use client";

/**
 * **The browser's database client** — the subset of `firebase/firestore` the
 * screens use, answered by `/api/db` against Neon Postgres.
 *
 * Every hook was written against Firestore's API (`query`, `where`,
 * `onSnapshot`, `getDocs` …) and keeps working unchanged; what is underneath
 * is different:
 *
 * - **A listener is a shared poller.** Two components asking the same query
 *   share one entry. It re-asks every `POLL_MS` (20 s by default) — every
 *   `FAST_POLL_MS` (5 s) for the incoming-lead offer — and only while the tab
 *   is visible. The request carries the hash of the answer already held, and
 *   an unchanged answer comes back empty, so polling costs almost nothing.
 * - **A save refreshes every list at once.** Any Server Action call (they all
 *   carry the `Next-Action` header) triggers an immediate refresh when it
 *   returns, so a remark, a status change or a payment shows up straight away
 *   rather than at the next tick.
 * - **Requests are batched.** Every query due in the same moment travels in
 *   one HTTP request.
 *
 * There is no on-device cache: `getDocsFromCache` answers from what this tab
 * already holds, and otherwise asks the server.
 */

import { auth } from "@/lib/firebase/client";
import {
  DOC_ID_FIELD,
  Timestamp,
  autoId,
  decodeValue,
  encodeValue,
  splitPath,
  type FilterSpec,
  type OrderSpec,
  type QuerySpec,
  type WhereOp,
  type WireDoc,
} from "./codec";

export { Timestamp };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DocumentData = Record<string, any>;
export type Unsubscribe = () => void;
export interface SnapshotListenOptions {
  includeMetadataChanges?: boolean;
  source?: "default" | "cache";
}
export type WhereFilterOp = WhereOp;
export type OrderByDirection = "asc" | "desc";
export interface SnapshotMetadata {
  readonly fromCache: boolean;
  readonly hasPendingWrites: boolean;
}

const POLL_MS = Number(process.env.NEXT_PUBLIC_DB_POLL_MS ?? 20_000);
const FAST_POLL_MS = Number(process.env.NEXT_PUBLIC_DB_FAST_POLL_MS ?? 5_000);
const METADATA: SnapshotMetadata = Object.freeze({ fromCache: false, hasPendingWrites: false });

export class FirestoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FirebaseError";
    this.code = code;
  }
}

/* -------------------------------------------------------------------------- */
/* References and queries                                                      */
/* -------------------------------------------------------------------------- */

export class Firestore {
  readonly type = "firestore" as const;
}

/** The one instance; `lib/firebase/client` exports it as `db`. */
export const clientDb = new Firestore();

export function getFirestore(): Firestore {
  return clientDb;
}

export class Query<T = DocumentData> {
  readonly type: "query" | "collection" = "query";
  readonly firestore: Firestore;
  /** @internal */
  readonly _spec: QuerySpec;
  /** Typing only. */
  declare readonly __t?: T;

  constructor(firestore: Firestore, spec: QuerySpec) {
    this.firestore = firestore;
    this._spec = spec;
  }

  withConverter<U>(): Query<U> {
    return this as unknown as Query<U>;
  }
}

export class CollectionReference<T = DocumentData> extends Query<T> {
  override readonly type = "collection" as const;
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
    return this._spec.parent ? new DocumentReference(this.firestore, this._spec.parent) : null;
  }

  override withConverter<U>(): CollectionReference<U> {
    return this as unknown as CollectionReference<U>;
  }
}

export class DocumentReference<T = DocumentData> {
  readonly type = "document" as const;
  readonly __isDocRef = true as const;
  readonly firestore: Firestore;
  readonly id: string;
  readonly path: string;
  declare readonly __t?: T;

  constructor(firestore: Firestore, path: string) {
    const parts = splitPath(path);
    if (parts.length === 0 || parts.length % 2 !== 0) throw new Error(`Not a document path: "${path}"`);
    this.firestore = firestore;
    this.path = parts.join("/");
    this.id = parts[parts.length - 1];
  }

  get parent(): CollectionReference<T> {
    return new CollectionReference<T>(this.firestore, splitPath(this.path).slice(0, -1).join("/"));
  }

  withConverter<U>(): DocumentReference<U> {
    return this as unknown as DocumentReference<U>;
  }
}

type Base = Firestore | CollectionReference | DocumentReference;

function basePath(base: Base): string {
  return base instanceof Firestore ? "" : base.path;
}

export function collection(base: Base, path: string, ...more: string[]): CollectionReference {
  const full = [basePath(base), path, ...more].filter(Boolean).join("/");
  return new CollectionReference(base instanceof Firestore ? base : base.firestore, full);
}

export function doc(base: Base, path?: string, ...more: string[]): DocumentReference {
  const firestore = base instanceof Firestore ? base : base.firestore;
  const segments = [path, ...more].filter((part): part is string => !!part);
  if (base instanceof CollectionReference && segments.length === 0) {
    return new DocumentReference(firestore, `${base.path}/${autoId()}`);
  }
  return new DocumentReference(firestore, [basePath(base), ...segments].filter(Boolean).join("/"));
}

export function collectionGroup(firestore: Firestore, collectionId: string): Query {
  return new Query(firestore, { parent: "", collection: collectionId, group: true, filters: [], orders: [] });
}

/* Constraints ------------------------------------------------------------- */

export class FieldPath {
  readonly segments: string[];
  constructor(...segments: string[]) {
    this.segments = segments;
  }
  toString(): string {
    return this.segments.join(".");
  }
}

export function documentId(): FieldPath {
  return new FieldPath(DOC_ID_FIELD);
}

type Constraint =
  | { type: "where"; field: string; op: WhereOp; value: unknown }
  | { type: "orderBy"; field: string; dir: OrderByDirection }
  | { type: "limit"; n: number; last: boolean }
  | { type: "cursor"; after: boolean; values: unknown[] };

export type QueryConstraint = Constraint;
export type QueryFieldFilterConstraint = Constraint;
export type QueryOrderByConstraint = Constraint;
export type QueryLimitConstraint = Constraint;

const fieldName = (field: string | FieldPath) => (typeof field === "string" ? field : field.toString());

export function where(field: string | FieldPath, op: WhereOp, value: unknown): Constraint {
  return { type: "where", field: fieldName(field), op, value };
}

export function orderBy(field: string | FieldPath, dir: OrderByDirection = "asc"): Constraint {
  return { type: "orderBy", field: fieldName(field), dir };
}

export function limit(n: number): Constraint {
  return { type: "limit", n, last: false };
}

export function limitToLast(n: number): Constraint {
  return { type: "limit", n, last: true };
}

export function startAfter(...values: unknown[]): Constraint {
  return { type: "cursor", after: true, values };
}

export function startAt(...values: unknown[]): Constraint {
  return { type: "cursor", after: false, values };
}

function encodeFilterValue(field: string, op: WhereOp, value: unknown): unknown {
  const one = (item: unknown) => {
    if (item instanceof DocumentReference) return field === DOC_ID_FIELD ? item.id : { __ref: item.path };
    return encodeValue(item);
  };
  return op === "in" || op === "not-in" || op === "array-contains-any" ? (value as unknown[]).map(one) : one(value);
}

function cursorValues(spec: QuerySpec, values: unknown[]): unknown[] {
  if (values.length === 1 && values[0] instanceof DocumentSnapshot) {
    const snap = values[0] as DocumentSnapshot;
    const out = spec.orders.map((order) => (order.field === DOC_ID_FIELD ? snap.ref.path : encodeValue(snap.get(order.field))));
    if (!spec.orders.some((order) => order.field === DOC_ID_FIELD)) out.push(snap.ref.path);
    return out;
  }
  const prefix = spec.group ? "" : spec.parent ? `${spec.parent}/${spec.collection}/` : `${spec.collection}/`;
  return values.map((value, index) => (spec.orders[index]?.field === DOC_ID_FIELD ? `${prefix}${String(value)}` : encodeValue(value)));
}

export function query<T>(base: Query<T>, ...constraints: (Constraint | null | undefined | false)[]): Query<T> {
  const spec: QuerySpec = {
    ...base._spec,
    filters: [...base._spec.filters],
    orders: [...base._spec.orders],
  };
  for (const constraint of constraints) {
    if (!constraint) continue;
    switch (constraint.type) {
      case "where": {
        const filter: FilterSpec = { field: constraint.field, op: constraint.op, value: encodeFilterValue(constraint.field, constraint.op, constraint.value) };
        spec.filters.push(filter);
        break;
      }
      case "orderBy": {
        const order: OrderSpec = { field: constraint.field, dir: constraint.dir };
        spec.orders.push(order);
        break;
      }
      case "limit":
        spec.limit = constraint.n;
        spec.limitToLast = constraint.last;
        break;
      case "cursor":
        if (constraint.after) spec.startAfter = cursorValues(spec, constraint.values);
        else spec.startAt = cursorValues(spec, constraint.values);
        break;
    }
  }
  return new Query<T>(base.firestore, spec);
}

/* -------------------------------------------------------------------------- */
/* Snapshots                                                                   */
/* -------------------------------------------------------------------------- */

function getAt(data: unknown, path: string): unknown {
  let cursor = data;
  for (const segment of path.split(".")) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

export class DocumentSnapshot<T = DocumentData> {
  readonly id: string;
  readonly ref: DocumentReference<T>;
  readonly metadata: SnapshotMetadata = METADATA;
  /** @internal */
  readonly _wire: WireDoc | null;
  private decoded?: T;

  constructor(ref: DocumentReference<T>, wire: WireDoc | null) {
    this.ref = ref;
    this.id = ref.id;
    this._wire = wire;
  }

  exists(): this is QueryDocumentSnapshot<T> {
    return this._wire !== null;
  }

  data(): T | undefined {
    if (!this._wire) return undefined;
    if (!this.decoded) {
      this.decoded = decodeValue(this._wire.data, (path) => new DocumentReference(this.ref.firestore, path)) as T;
    }
    return this.decoded;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(field: string | FieldPath): any {
    return getAt(this.data(), fieldName(field));
  }
}

export class QueryDocumentSnapshot<T = DocumentData> extends DocumentSnapshot<T> {
  override data(): T {
    return super.data() as T;
  }
}

export interface DocumentChange<T = DocumentData> {
  readonly type: "added" | "modified" | "removed";
  readonly doc: QueryDocumentSnapshot<T>;
  readonly oldIndex: number;
  readonly newIndex: number;
}

export class QuerySnapshot<T = DocumentData> {
  readonly query: Query<T>;
  readonly docs: QueryDocumentSnapshot<T>[];
  readonly metadata: SnapshotMetadata = METADATA;
  private readonly changes: DocumentChange<T>[];

  constructor(query: Query<T>, docs: QueryDocumentSnapshot<T>[], changes?: DocumentChange<T>[]) {
    this.query = query;
    this.docs = docs;
    this.changes = changes ?? docs.map((doc, index) => ({ type: "added", doc, oldIndex: -1, newIndex: index }));
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
    return this.changes;
  }
}

function querySnapshot<T>(q: Query<T>, wires: WireDoc[], previous?: WireDoc[]): QuerySnapshot<T> {
  const docs = wires.map((wire) => new QueryDocumentSnapshot<T>(new DocumentReference<T>(q.firestore, wire.path), wire));
  if (!previous) return new QuerySnapshot(q, docs);
  const before = new Map(previous.map((wire, index) => [wire.path, { wire, index }]));
  const changes: DocumentChange<T>[] = [];
  const now = new Set<string>();
  docs.forEach((snap, index) => {
    now.add(snap.ref.path);
    const old = before.get(snap.ref.path);
    if (!old) changes.push({ type: "added", doc: snap, oldIndex: -1, newIndex: index });
    else if (old.wire.updateTime !== snap._wire?.updateTime) changes.push({ type: "modified", doc: snap, oldIndex: old.index, newIndex: index });
  });
  for (const [path, old] of before) {
    if (!now.has(path)) {
      const gone = new QueryDocumentSnapshot<T>(new DocumentReference<T>(q.firestore, path), old.wire);
      changes.push({ type: "removed", doc: gone, oldIndex: old.index, newIndex: -1 });
    }
  }
  return new QuerySnapshot(q, docs, changes);
}

/* -------------------------------------------------------------------------- */
/* Transport: batched POSTs to /api/db                                         */
/* -------------------------------------------------------------------------- */

type Op =
  | { kind: "query"; spec: QuerySpec; since?: string }
  | { kind: "count"; spec: QuerySpec }
  | { kind: "get"; path: string; since?: string }
  | { kind: "update"; path: string; data: Record<string, unknown> };

interface Result {
  ok: boolean;
  unchanged?: boolean;
  hash?: string;
  docs?: WireDoc[];
  doc?: WireDoc | null;
  count?: number;
  code?: string;
  error?: string;
}

const pending: { op: Op; resolve: (result: Result) => void; reject: (error: Error) => void }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function idToken(): Promise<string> {
  const user = auth?.currentUser;
  if (!user) {
    // Auth restores the session asynchronously after a reload; give it a moment.
    await new Promise<void>((resolve) => {
      const stop = auth.onAuthStateChanged(() => {
        stop();
        resolve();
      });
      setTimeout(resolve, 4000);
    });
  }
  const current = auth?.currentUser;
  if (!current) throw new FirestoreError("unauthenticated", "Not signed in.");
  return current.getIdToken();
}

async function flush(): Promise<void> {
  flushTimer = null;
  const items = pending.splice(0, 25);
  if (pending.length > 0) flushTimer = setTimeout(flush, 0);
  if (items.length === 0) return;
  try {
    const token = await idToken();
    const response = await fetch("/api/db", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ ops: items.map((item) => item.op) }),
      cache: "no-store",
    });
    if (response.status === 401) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new FirestoreError("permission-denied", body.error ?? "Not signed in.");
    }
    if (!response.ok) throw new FirestoreError("unavailable", `The server answered ${response.status}.`);
    const body = (await response.json()) as { results: Result[] };
    items.forEach((item, index) => item.resolve(body.results[index] ?? { ok: false, code: "internal" }));
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    const typed = failure instanceof FirestoreError ? failure : new FirestoreError("unavailable", failure.message);
    items.forEach((item) => item.reject(typed));
  }
}

function send(op: Op): Promise<Result> {
  return new Promise((resolve, reject) => {
    pending.push({ op, resolve, reject });
    if (!flushTimer) flushTimer = setTimeout(flush, 8);
  });
}

function failure(result: Result): FirestoreError {
  const code = result.code ?? "internal";
  const message =
    code === "permission-denied" ? "Missing or insufficient permissions." : result.error ?? "The request could not be completed.";
  return new FirestoreError(code, message);
}

/* -------------------------------------------------------------------------- */
/* Shared pollers                                                              */
/* -------------------------------------------------------------------------- */

type Target = { kind: "query"; query: Query } | { kind: "doc"; ref: DocumentReference };

interface Listener {
  next: (snapshot: unknown) => void;
  error?: (error: Error) => void;
  /** What this listener last received, for `docChanges`. */
  seen?: WireDoc[];
  delivered: boolean;
}

interface Entry {
  key: string;
  target: Target;
  fast: boolean;
  listeners: Set<Listener>;
  hash?: string;
  wires?: WireDoc[];
  doc?: WireDoc | null;
  loaded: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  inflight: boolean;
  dead: boolean;
}

const entries = new Map<string, Entry>();

function keyOf(target: Target): string {
  return target.kind === "doc" ? `doc:${target.ref.path}` : `q:${JSON.stringify(target.query._spec)}`;
}

/** The new-lead offer is the one screen with a five-minute clock on it. */
function isFast(target: Target): boolean {
  if (target.kind !== "query") return false;
  const spec = target.query._spec;
  return spec.collection === "leads" && spec.filters.some((f) => f.field === "status" && f.op === "==" && f.value === "ASSIGNED");
}

function visible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function deliver(entry: Entry, listener: Listener): void {
  if (entry.target.kind === "doc") {
    listener.next(new DocumentSnapshot(entry.target.ref, entry.doc ?? null));
  } else {
    const snap = querySnapshot(entry.target.query, entry.wires ?? [], listener.delivered ? listener.seen : undefined);
    listener.seen = entry.wires;
    listener.next(snap);
  }
  listener.delivered = true;
}

function schedule(entry: Entry, delay?: number): void {
  if (entry.timer) clearTimeout(entry.timer);
  if (entry.dead) return;
  entry.timer = setTimeout(() => void poll(entry), delay ?? (entry.fast ? FAST_POLL_MS : POLL_MS));
}

async function poll(entry: Entry): Promise<void> {
  entry.timer = null;
  if (entry.dead) return;
  if (!visible() && entry.loaded) return; // resumed by the visibility handler
  if (entry.inflight) return;
  entry.inflight = true;
  try {
    const result =
      entry.target.kind === "doc"
        ? await send({ kind: "get", path: entry.target.ref.path, since: entry.hash })
        : await send({ kind: "query", spec: entry.target.query._spec, since: entry.hash });
    if (entry.dead) return;
    if (!result.ok) {
      const error = failure(result);
      for (const listener of entry.listeners) listener.error?.(error);
      entry.dead = true;
      entries.delete(entry.key);
      return;
    }
    if (!result.unchanged) {
      entry.hash = result.hash;
      if (entry.target.kind === "doc") entry.doc = result.doc ?? null;
      else entry.wires = result.docs ?? [];
      entry.loaded = true;
      for (const listener of entry.listeners) deliver(entry, listener);
    } else if (!entry.loaded) {
      entry.loaded = true;
    }
    for (const listener of entry.listeners) if (!listener.delivered && entry.loaded) deliver(entry, listener);
  } catch (error) {
    // Network trouble: keep what is on screen and try again at the next tick,
    // as Firestore's own listener did. A refused sign-in is final.
    if (error instanceof FirestoreError && (error.code === "permission-denied" || error.code === "unauthenticated")) {
      for (const listener of entry.listeners) listener.error?.(error);
      entry.dead = true;
      entries.delete(entry.key);
      return;
    }
  } finally {
    entry.inflight = false;
    if (!entry.dead && entry.listeners.size > 0) schedule(entry);
  }
}

function listen(target: Target, listener: Listener): Unsubscribe {
  const key = keyOf(target);
  let entry = entries.get(key);
  if (!entry || entry.dead) {
    entry = { key, target, fast: isFast(target), listeners: new Set(), loaded: false, timer: null, inflight: false, dead: false };
    entries.set(key, entry);
    entry.listeners.add(listener);
    void poll(entry);
  } else {
    entry.listeners.add(listener);
    if (entry.loaded) queueMicrotask(() => entry && entry.listeners.has(listener) && deliver(entry, listener));
  }
  const held = entry;
  return () => {
    held.listeners.delete(listener);
    if (held.listeners.size === 0) {
      held.dead = true;
      if (held.timer) clearTimeout(held.timer);
      if (entries.get(key) === held) entries.delete(key);
    }
  };
}

/** Re-asks every live query now — after a save, or when the tab comes back. */
export function refreshAll(): void {
  for (const entry of entries.values()) {
    if (!entry.dead && entry.loaded) schedule(entry, 0);
  }
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function refreshSoon(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshAll();
  }, 150);
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (visible()) refreshAll();
  });
  window.addEventListener("online", refreshAll);

  // Every Server Action is a fetch carrying `Next-Action`. When one returns,
  // whatever it wrote should be on screen now, not at the next tick.
  const flagged = window as unknown as { __dbFetchHooked?: boolean };
  if (!flagged.__dbFetchHooked) {
    flagged.__dbFetchHooked = true;
    const original = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await original(input, init);
      try {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (headers.has("next-action")) refreshSoon();
      } catch {
        /* never let the hook break a request */
      }
      return response;
    };
  }
}

/* -------------------------------------------------------------------------- */
/* The public reads                                                            */
/* -------------------------------------------------------------------------- */

type NextFn<S> = (snapshot: S) => void;
type ErrorFn = (error: Error) => void;
interface Observer<S> {
  next?: NextFn<S>;
  error?: ErrorFn;
  complete?: () => void;
}

export function onSnapshot<T = DocumentData>(ref: DocumentReference<T>, onNext: NextFn<DocumentSnapshot<T>>, onError?: ErrorFn): Unsubscribe;
export function onSnapshot<T = DocumentData>(ref: DocumentReference<T>, options: SnapshotListenOptions, onNext: NextFn<DocumentSnapshot<T>>, onError?: ErrorFn): Unsubscribe;
export function onSnapshot<T = DocumentData>(ref: DocumentReference<T>, observer: Observer<DocumentSnapshot<T>>): Unsubscribe;
export function onSnapshot<T = DocumentData>(q: Query<T>, onNext: NextFn<QuerySnapshot<T>>, onError?: ErrorFn): Unsubscribe;
export function onSnapshot<T = DocumentData>(q: Query<T>, options: SnapshotListenOptions, onNext: NextFn<QuerySnapshot<T>>, onError?: ErrorFn): Unsubscribe;
export function onSnapshot<T = DocumentData>(q: Query<T>, observer: Observer<QuerySnapshot<T>>): Unsubscribe;
export function onSnapshot(target: Query | DocumentReference, ...args: unknown[]): Unsubscribe {
  if (args[0] && typeof args[0] === "object" && typeof (args[0] as Observer<unknown>).next !== "function" && !("error" in (args[0] as object))) {
    args.shift(); // listen options: nothing to configure
  }
  let next: NextFn<unknown>;
  let error: ErrorFn | undefined;
  if (typeof args[0] === "function") {
    next = args[0] as NextFn<unknown>;
    error = args[1] as ErrorFn | undefined;
  } else {
    const observer = (args[0] ?? {}) as Observer<unknown>;
    next = observer.next ?? (() => {});
    error = observer.error;
  }
  const t: Target = target instanceof DocumentReference ? { kind: "doc", ref: target } : { kind: "query", query: target };
  return listen(t, { next, error, delivered: false });
}

export async function getDocs<T = DocumentData>(q: Query<T>): Promise<QuerySnapshot<T>> {
  const result = await send({ kind: "query", spec: q._spec });
  if (!result.ok) throw failure(result);
  return querySnapshot(q, result.docs ?? []);
}

export const getDocsFromServer = getDocs;

export async function getDoc<T = DocumentData>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
  const result = await send({ kind: "get", path: ref.path });
  if (!result.ok) throw failure(result);
  return new DocumentSnapshot(ref, result.doc ?? null);
}

export const getDocFromServer = getDoc;

/** Answers from what this tab already holds for the same query, otherwise from the server. */
export async function getDocsFromCache<T = DocumentData>(q: Query<T>): Promise<QuerySnapshot<T>> {
  const entry = entries.get(keyOf({ kind: "query", query: q as Query }));
  if (entry?.loaded && entry.wires) return querySnapshot(q, entry.wires);
  return getDocs(q);
}

export async function getDocFromCache<T = DocumentData>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
  const entry = entries.get(keyOf({ kind: "doc", ref: ref as DocumentReference }));
  if (entry?.loaded) return new DocumentSnapshot(ref, entry.doc ?? null);
  return getDoc(ref);
}

export async function getCountFromServer<T = DocumentData>(q: Query<T>): Promise<{ data(): { count: number } }> {
  const result = await send({ kind: "count", spec: q._spec });
  if (!result.ok) throw failure(result);
  const count = result.count ?? 0;
  return { data: () => ({ count }) };
}

/** The one browser write: an admin renaming a connected WhatsApp number's label. */
export async function updateDoc<T = DocumentData>(ref: DocumentReference<T>, data: Partial<T> | DocumentData): Promise<void> {
  const result = await send({ kind: "update", path: ref.path, data: encodeValue(data) as Record<string, unknown> });
  if (!result.ok) throw failure(result);
  refreshSoon();
}
