"use client";
import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { MdDeleteOutline, MdEdit, MdVisibilityOff, MdPersonOutline } from "react-icons/md";
import { db } from "@/lib/firebase/client";
import { Avatar } from "./ui";
import { formatListTime, formatPhone, shownText, toDate, typeLabel } from "./utils";

// Every message that was deleted, edited, sent as view once, or held back by
// WhatsApp, across all chats. Deleted and edited messages come newest first,
// a page at a time, ordered by revokedAt / editedAt: a query on one field uses
// Firestore's automatic index and only returns messages that have it, so no
// composite index is needed. View-once and withheld messages are rare and
// come from small equality queries.
const PAGE = 200;
const RARE_CAP = 300;
const KINDS = ["deleted", "edited", "viewOnce", "hidden"];
const pagedQuery = (field, n) => query(collection(db, "wa_messages"), orderBy(field, "desc"), limit(n));
const rareQuery = (field, value) => query(collection(db, "wa_messages"), where(field, "==", value), limit(RARE_CAP));

const FILTERS = [
  { id: "all", label: "All" },
  { id: "deleted", label: "Deleted" },
  { id: "edited", label: "Edited" },
  { id: "hidden", label: "View once & hidden" },
];

function Tag({ icon, className, children }) {
  const Icon = icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[11.5px] rounded px-1.5 py-px bg-[var(--wa-chip)] ${className}`}>
      <Icon className="shrink-0" />
      {children}
    </span>
  );
}

export default function RecordsPanel({
  conversations, employeeFilter, scopeName, onShowAll, handlerOf, selectedMessageId, onOpen, headerActions,
}) {
  const [byKind, setByKind] = useState({});
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [pageSize, setPageSize] = useState(PAGE);

  useEffect(() => {
    const listen = (kind, q) =>
      onSnapshot(
        q,
        (snap) => setByKind((s) => ({ ...s, [kind]: snap.docs.map((d) => ({ id: d.id, ...d.data() })) })),
        (err) => {
          console.error("wa records", kind, err);
          setError(err.code === "permission-denied" ? "You don't have permission to view WhatsApp data." : err.message);
        }
      );
    const stops = [listen("viewOnce", rareQuery("viewOnce", true)), listen("hidden", rareQuery("type", "unsupported"))];
    return () => stops.forEach((stop) => stop());
  }, []);

  useEffect(() => {
    const listen = (kind, q) =>
      onSnapshot(
        q,
        (snap) => setByKind((s) => ({ ...s, [kind]: snap.docs.map((d) => ({ id: d.id, ...d.data() })), [`${kind}Size`]: pageSize })),
        (err) => {
          console.error("wa records", kind, err);
          setError(err.code === "permission-denied" ? "You don't have permission to view WhatsApp data." : err.message);
        }
      );
    const stops = [listen("deleted", pagedQuery("revokedAt", pageSize)), listen("edited", pagedQuery("editedAt", pageSize))];
    return () => stops.forEach((stop) => stop());
  }, [pageSize]);

  const loading = KINDS.some((k) => !byKind[k]) && !error;
  const loadingMore = byKind.deletedSize < pageSize || byKind.editedSize < pageSize;
  const hasMore = (byKind.deleted?.length || 0) >= pageSize || (byKind.edited?.length || 0) >= pageSize;

  const records = useMemo(() => {
    const map = new Map();
    for (const kind of KINDS) {
      for (const m of byKind[kind] || []) {
        // A delete or edit of a message the monitor never stored has no chat
        if (!m.conversationId) continue;
        const r = map.get(m.id) || { m, kinds: new Set() };
        r.kinds.add(kind);
        map.set(m.id, r);
      }
    }
    return [...map.values()]
      .map((r) => ({ ...r, at: toDate(r.m.revokedAt) || toDate(r.m.editedAt) || toDate(r.m.timestamp) }))
      .sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0));
  }, [byKind]);

  const scoped = useMemo(
    () => (employeeFilter === "all" ? records : records.filter((r) => r.m.phoneNumberId === employeeFilter)),
    [records, employeeFilter]
  );

  const counts = useMemo(() => {
    const c = { all: scoped.length, deleted: 0, edited: 0, hidden: 0 };
    for (const r of scoped) {
      if (r.kinds.has("deleted")) c.deleted += 1;
      if (r.kinds.has("edited")) c.edited += 1;
      if (r.kinds.has("viewOnce") || r.kinds.has("hidden")) c.hidden += 1;
    }
    return c;
  }, [scoped]);

  const visible = scoped.filter(
    (r) => filter === "all" || r.kinds.has(filter) || (filter === "hidden" && r.kinds.has("viewOnce"))
  );

  const convoById = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--wa-panel)] wa-anim-panel">
      <div className="h-[59px] px-4 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold text-[var(--wa-text)] leading-tight">Deleted &amp; edited</h1>
          {employeeFilter === "all" ? (
            <p className="text-[12.5px] text-[var(--wa-muted)] truncate">Kept here even after they change on the phone</p>
          ) : (
            <p className="text-[12.5px] text-[var(--wa-muted)] truncate">
              {scopeName || "One employee"} only ·{" "}
              <button type="button" onClick={onShowAll} className="text-[var(--wa-accent)] hover:underline">
                show everyone
              </button>
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">{headerActions}</div>
      </div>

      <div className="px-3 pb-2 flex items-center gap-2 overflow-x-auto wa-scroll shrink-0">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`shrink-0 h-8 px-3 rounded-full text-[14px] transition-colors duration-150 flex items-center gap-1.5 ${
              filter === f.id ? "bg-[#0a332c] text-[#d9fdd3]" : "bg-[var(--wa-input)] text-[var(--wa-muted)] hover:bg-[var(--wa-active)]"
            }`}
          >
            {f.label}
            {counts[f.id] > 0 && f.id !== "all" && <span className="text-[12px] opacity-80">{counts[f.id]}</span>}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto wa-scroll">
        {error && <p className="m-4 p-3 rounded-lg text-[14px] text-rose-300 bg-rose-500/10">{error}</p>}
        {loading && <p className="text-center text-[13px] text-[var(--wa-muted)] py-10">Loading…</p>}
        {!loading && !error && visible.length === 0 && (
          <p className="wa-anim-fade text-center px-8 py-12 text-[var(--wa-muted)] text-[14px]">Nothing here yet.</p>
        )}
        {visible.map(({ m, kinds, at }) => {
          const convo = convoById.get(m.conversationId);
          const name = convo?.customerName || formatPhone(m.customer);
          const handler = handlerOf(m);
          const actor = m.direction === "out" ? handler : "Customer";
          const preview = shownText(m) || (m.type === "unsupported" ? typeLabel(m.unsupportedType || "unsupported") : typeLabel(m.type));
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onOpen(m.conversationId, m.id, m.sortKey)}
              className={`w-full flex items-start gap-3 pl-3 pr-4 text-left transition-colors ${
                selectedMessageId === m.id ? "bg-[var(--wa-active)]" : "hover:bg-[var(--wa-hover)]"
              }`}
            >
              <div className="pt-3">
                <Avatar name={name} seed={m.customer} size={44} />
              </div>
              <div className="min-w-0 flex-1 py-3 border-b border-[var(--wa-border)]">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[16px] text-[var(--wa-text)] truncate">{name}</p>
                  <span className="text-[12px] text-[var(--wa-muted)] shrink-0">{formatListTime(at)}</span>
                </div>
                <p className="text-[14px] text-[var(--wa-muted)] truncate mt-0.5">{preview}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  {kinds.has("deleted") && <Tag icon={MdDeleteOutline} className="text-rose-300">{actor} deleted</Tag>}
                  {kinds.has("edited") && <Tag icon={MdEdit} className="text-sky-300">{actor} edited</Tag>}
                  {kinds.has("viewOnce") && <Tag icon={MdVisibilityOff} className="text-amber-300">View once</Tag>}
                  {kinds.has("hidden") && !kinds.has("viewOnce") && (
                    <Tag icon={MdVisibilityOff} className="text-[var(--wa-muted)]">Not shared by WhatsApp</Tag>
                  )}
                  {employeeFilter === "all" && (
                    <Tag icon={MdPersonOutline} className="text-[var(--wa-muted)] max-w-[50%] truncate">{handler}</Tag>
                  )}
                </div>
              </div>
            </button>
          );
        })}
        {!loading && hasMore && (
          <div className="flex justify-center pt-4">
            <button
              type="button"
              onClick={() => setPageSize((n) => n + PAGE)}
              disabled={loadingMore}
              className="h-8 px-4 rounded-full text-[13.5px] bg-[var(--wa-input)] text-[var(--wa-text)] hover:bg-[var(--wa-active)] disabled:opacity-60 transition-colors"
            >
              {loadingMore ? "Loading…" : "Load older"}
            </button>
          </div>
        )}
        {!loading && visible.length > 0 && (
          <p className="text-center text-[12px] text-[var(--wa-muted)]/70 py-5">
            {visible.length} message{visible.length === 1 ? "" : "s"} · open one to see it in its chat
          </p>
        )}
      </div>
    </div>
  );
}
