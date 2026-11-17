"use client";
import { Fragment, memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  MdArrowBack, MdSearch, MdMoreVert, MdClose, MdKeyboardArrowUp, MdKeyboardArrowDown,
  MdDone, MdDoneAll, MdErrorOutline, MdPhoneIphone, MdHistory, MdImage, MdVideocam, MdMic,
  MdInsertDriveFile, MdLocationOn, MdStickyNote2, MdContactPhone, MdLock, MdReply,
  MdContentCopy, MdOpenInNew, MdInfoOutline, MdSchedule, MdVisibilityOff, MdDeleteOutline,
} from "react-icons/md";
import { Avatar, Dropdown, Highlight, IconButton, MenuItem } from "./ui";
import { Lightbox, MessageMedia } from "./Media";
import {
  TYPE_LABEL, byTime, displayName, formatClock, formatDayChip, formatPhone, shownText, toDate, typeLabel, waLink,
} from "./utils";

const MEDIA_ICON = {
  image: MdImage,
  video: MdVideocam,
  audio: MdMic,
  voice: MdMic,
  document: MdInsertDriveFile,
  sticker: MdStickyNote2,
  contacts: MdContactPhone,
  media_placeholder: MdImage,
};

function Ticks({ status }) {
  if (status === "read") return <MdDoneAll className="text-[16px] text-[#53bdeb]" title="Read" />;
  if (status === "delivered") return <MdDoneAll className="text-[16px] text-white/60" title="Delivered" />;
  if (status === "failed") return <MdErrorOutline className="text-[15px] text-rose-400" title="Failed" />;
  if (status === "sent") return <MdDone className="text-[16px] text-white/60" title="Sent" />;
  return <MdDoneAll className="text-[16px] text-white/50" title="Sent from the phone" />;
}

const URL_RE = /(https?:\/\/[^\s]+)/g;

function RichText({ text, query }) {
  if (query) return <Highlight text={text} query={query} />;
  return text.split(URL_RE).map((part, i) =>
    i % 2 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-[#53bdeb] hover:underline break-all">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

function MediaCard({ m }) {
  const Icon = MEDIA_ICON[m.type] || MdInsertDriveFile;
  const name = m.media?.filename || typeLabel(m.type);
  const ext = (m.media?.mimeType || "").split("/").pop()?.toUpperCase();
  // WhatsApp only shares history media from the 14 days before the number was linked
  const note = m.type === "media_placeholder" ? "Older than WhatsApp shares with the monitor" : "File not shared with the monitor";
  return (
    <div className="flex items-center gap-3 rounded-md bg-black/20 px-3 py-2.5 mb-1 min-w-[220px]">
      <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-2xl text-white/80 shrink-0">
        <Icon />
      </div>
      <div className="min-w-0">
        <p className="text-[14px] truncate">{name}</p>
        <p className="text-[11.5px] text-white/55 truncate">
          {ext ? `${ext} · ` : ""}{note}
        </p>
      </div>
    </div>
  );
}

// A message WhatsApp didn't pass on to the monitor (view-once, polls...). Who
// sent it, to whom and when is still kept.
function HiddenCard({ m }) {
  const what = m.viewOnce ? "View-once photo or video" : m.unsupportedType ? typeLabel(m.unsupportedType) : "Message";
  return (
    <div className="flex items-center gap-3 rounded-md bg-black/20 px-3 py-2.5 mb-1 min-w-[220px]">
      <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-2xl text-white/80 shrink-0">
        <MdVisibilityOff />
      </div>
      <div className="min-w-0">
        <p className="text-[14px] truncate">{what}</p>
        <p className="text-[11.5px] text-white/55">
          WhatsApp doesn&apos;t share {m.viewOnce ? "view-once content" : "this kind of message"} with connected apps
        </p>
      </div>
    </div>
  );
}

function LocationCard({ text }) {
  const coords = /^(-?\d+(\.\d+)?),\s*(-?\d+(\.\d+)?)$/.exec(text || "");
  const href = coords
    ? `https://www.google.com/maps?q=${coords[1]},${coords[3]}`
    : `https://www.google.com/maps/search/${encodeURIComponent(text || "")}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-md bg-black/20 px-3 py-2.5 mb-1 min-w-[220px] hover:bg-black/30 transition-colors"
    >
      <div className="w-10 h-10 rounded-lg bg-rose-500/20 flex items-center justify-center text-2xl text-rose-400 shrink-0">
        <MdLocationOn />
      </div>
      <div className="min-w-0">
        <p className="text-[14px] truncate">{coords ? "Shared location" : text || "Location"}</p>
        <p className="text-[11.5px] text-[#53bdeb]">Open in Google Maps</p>
      </div>
    </a>
  );
}

// Memoized: a new message or a search keystroke redraws only the bubbles it
// changes. Only messages that arrive while the chat is open animate in.
const Bubble = memo(function Bubble({ m, first, query, active, animate, onOpenImage }) {
  const out = m.direction === "out";
  const at = toDate(m.timestamp);
  const text = shownText(m);
  const anim = animate ? "wa-anim-up" : "";

  // An edit or delete we couldn't match to its message (from before this was handled)
  if (m.type === "edit" || m.type === "revoke") {
    return (
      <div className={`flex ${out ? "justify-end" : "justify-start"} px-[6%] my-0.5 ${anim}`}>
        <span className="text-[12.5px] text-[var(--wa-muted)] bg-[var(--wa-in)]/80 rounded-full px-3 py-1">
          {out ? "Employee" : "Customer"} {m.type === "edit" ? "edited" : "deleted"} a message
          {m.type === "edit" && m.text ? `: "${m.text}"` : ""} · {formatClock(at)}
        </span>
      </div>
    );
  }

  if (m.type === "reaction") {
    return (
      <div className={`flex ${out ? "justify-end" : "justify-start"} px-[6%] my-0.5 ${anim}`}>
        <span className="text-[12.5px] text-[var(--wa-muted)] bg-[var(--wa-in)]/80 rounded-full px-3 py-1">
          {out ? "Employee" : "Customer"} reacted {m.text || "👍"} · {formatClock(at)}
        </span>
      </div>
    );
  }

  const hidden = m.type === "unsupported";
  const media = MEDIA_ICON[m.type] || m.media;
  const caption = text && !(m.type === "document" && text === m.media?.filename) ? text : "";
  // Wording before the edit (kept by the webhook since edits stopped overwriting it)
  const original = m.editedText != null && m.text && m.text !== m.editedText ? m.text : "";
  const revokedAt = toDate(m.revokedAt);

  return (
    <div
      data-mid={m.id}
      className={`flex ${out ? "justify-end" : "justify-start"} px-[6%] ${first ? "mt-3" : "mt-0.5"} ${anim}`}
    >
      <div
        className={`relative max-w-[85%] md:max-w-[65%] rounded-lg px-2 pt-1.5 pb-1 text-[14.2px] leading-[19px] text-[var(--wa-text)] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] transition-shadow ${
          out ? "bg-[var(--wa-out)]" : "bg-[var(--wa-in)]"
        } ${first ? (out ? "rounded-tr-none wa-tail-out" : "rounded-tl-none wa-tail-in") : ""} ${
          active ? "ring-2 ring-[#ffd200]" : ""
        }`}
      >
        {(m.type === "interactive" || m.type === "button") && (
          <p className="text-[11.5px] text-white/55 flex items-center gap-1 mb-0.5">
            <MdReply /> {TYPE_LABEL[m.type]}
          </p>
        )}
        {m.type === "location" ? (
          <LocationCard text={m.text} />
        ) : hidden ? (
          <HiddenCard m={m} />
        ) : media ? (
          m.media?.id ? <MessageMedia m={m} out={out} onOpenImage={() => onOpenImage(m.id)} /> : <MediaCard m={m} />
        ) : null}
        {m.viewOnce && !hidden && (
          <p className="text-[11.5px] text-white/55 flex items-center gap-1 px-0.5 mb-0.5">
            <MdVisibilityOff /> Sent as view once · kept here
          </p>
        )}

        {m.type !== "location" && !hidden && (caption || (!media && !text)) ? (
          <span className="whitespace-pre-wrap break-words px-0.5">
            {caption ? <RichText text={caption} query={query} /> : (
              <em className="text-white/60">{typeLabel(m.type)}</em>
            )}
          </span>
        ) : null}

        {original && (
          <div className="mt-1 mb-0.5 border-l-2 border-white/25 pl-2 text-[12.5px] text-white/60">
            <span className="block text-[10.5px] uppercase tracking-wide text-white/40">Before the edit</span>
            <span className="whitespace-pre-wrap break-words">{original}</span>
          </div>
        )}

        {m.revoked && (
          <p className="text-[11.5px] text-rose-300/80 italic mt-0.5 px-0.5 flex items-center gap-1">
            <MdDeleteOutline className="shrink-0" />
            {out ? "Employee" : "Customer"} deleted this for everyone
            {revokedAt ? ` · ${formatDayChip(revokedAt)} ${formatClock(revokedAt)}` : ""} · kept here
          </p>
        )}

        {/* Spacer so the timestamp never overlaps the last line, like WhatsApp */}
        <span className={`inline-block ${m.edited ? "w-[120px]" : "w-[78px]"}`} />
        <span className="absolute right-2 bottom-1 flex items-center gap-1 text-[11px] text-white/60 select-none">
          {m.source === "history" && <MdHistory title="Imported history" />}
          {m.source === "business_app" && <MdPhoneIphone title="Sent from the employee's phone" />}
          {m.edited && <span title="Edited">Edited</span>}
          {formatClock(at)}
          {out && <Ticks status={m.status} />}
        </span>
      </div>
    </div>
  );
});

// onLoadOlder() loads the page before the oldest message shown; onReveal(sortKey)
// loads everything back to that message; onSearchPool() resolves to the newest
// messages for search as { messages, all } (`all`: that's the whole chat;
// only called while hasOlder).
export default function ChatView({
  conversation, messages, loading, handler, onBack, onToggleInfo, infoOpen, focus,
  hasOlder, loadingOlder, onLoadOlder, onReveal, onSearchPool,
}) {
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const atBottom = useRef(true);
  const lastCount = useRef(0);
  const firstId = useRef(null);
  // Space below the visible top, kept so older messages added above leave
  // the same messages in view
  const gap = useRef(0);
  // Messages newer than the chat's latest at opening animate in; the rest don't
  const animateAfter = useRef(null);
  const [newCount, setNewCount] = useState(0);
  const [showJump, setShowJump] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);

  // Photo viewer: every photo in the chat, in order, so arrows can step through them
  const [photoId, setPhotoId] = useState(null);
  const photos = useMemo(() => messages.filter((m) => m.type === "image" && m.media?.id), [messages]);
  const photoIndex = photos.findIndex((m) => m.id === photoId);

  const name = displayName(conversation);

  // Rendered with key={conversation.id}, so all of this resets per chat.
  // Stick to the bottom on open and on new messages, unless the admin scrolled
  // up; when older messages are added above, stay on the same messages
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || loading) return;
    const added = messages.length - lastCount.current;
    const prepended = lastCount.current > 0 && messages[0]?.id !== firstId.current;
    if (lastCount.current === 0) {
      el.scrollTop = el.scrollHeight;
      if (messages.length) animateAfter.current = toDate(messages[messages.length - 1].timestamp)?.getTime() ?? 0;
    } else if (prepended) {
      el.scrollTop = atBottom.current ? el.scrollHeight : el.scrollHeight - gap.current;
    } else if (added > 0) {
      if (atBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      else setNewCount((n) => n + added);
    }
    gap.current = el.scrollHeight - el.scrollTop;
    lastCount.current = messages.length;
    firstId.current = messages[0]?.id ?? null;
  }, [messages, loading]);

  // Photos and videos finish loading after the chat opens and push the
  // messages up; keep the latest in view while the admin is at the bottom
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
      gap.current = el.scrollHeight - el.scrollTop;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Older messages: near the top, or straight away when the first page
  // doesn't fill the screen
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || loading || !hasOlder || loadingOlder) return;
    if (el.scrollHeight <= el.clientHeight + 50) onLoadOlder();
  }, [messages, loading, hasOlder, loadingOlder, onLoadOlder]);

  const onScroll = () => {
    const el = scrollRef.current;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = distance < 120;
    gap.current = el.scrollHeight - el.scrollTop;
    setShowJump(distance > 300);
    if (atBottom.current) setNewCount(0);
    if (el.scrollTop < 400 && hasOlder && !loadingOlder) onLoadOlder();
  };

  const jumpToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    setNewCount(0);
  };

  // In-chat search. Typing stays responsive: matching runs on a deferred copy
  // of the query, and only the bubbles that match get it. In a long chat it
  // also reads further back than what's shown (onSearchPool), without drawing
  // those messages; stepping to a match loads the chat back to it.
  const deferredQuery = useDeferredValue(query);
  const q = deferredQuery.trim();
  const [pool, setPool] = useState(null);
  useEffect(() => {
    if (!q || !hasOlder || pool) return;
    let cancelled = false;
    onSearchPool().then(
      (list) => !cancelled && setPool(list),
      (err) => console.error("WhatsApp search", err)
    );
    return () => {
      cancelled = true;
    };
  }, [q, hasOlder, pool, onSearchPool]);
  const searchable = useMemo(() => {
    if (!pool) return messages;
    const all = new Map(pool.messages.map((m) => [m.id, m]));
    for (const m of messages) all.set(m.id, m);
    return [...all.values()].sort(byTime);
  }, [pool, messages]);
  // Matches the current wording and the original of an edited message
  const hitList = useMemo(
    () => (q ? searchable.filter((m) => `${shownText(m)} ${m.text || ""}`.toLowerCase().includes(q.toLowerCase())) : []),
    [searchable, q]
  );
  const hitSet = useMemo(() => new Set(hitList.map((m) => m.id)), [hitList]);
  const active = hitList.length ? hitList[Math.min(hit, hitList.length - 1)] : null;
  const activeHit = active?.id || null;

  useEffect(() => setHit(hitList.length ? hitList.length - 1 : 0), [q, hitList.length]);

  // Scroll to the current match once it's drawn; one older than what's shown
  // is loaded first
  const scrolledHit = useRef(null);
  useEffect(() => {
    if (!active || scrolledHit.current === active.id) return;
    const el = scrollRef.current?.querySelector(`[data-mid="${CSS.escape(active.id)}"]`);
    if (!el) {
      if (active.sortKey) onReveal(active.sortKey);
      return;
    }
    scrolledHit.current = active.id;
    atBottom.current = false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [active, messages, onReveal]);

  // Opened from the records view: scroll to that message and ring it briefly,
  // loading the chat back to it first if it's older than what's shown
  const [focusedId, setFocusedId] = useState(null);
  const focusDone = useRef(null);
  const focusRevealed = useRef(null);
  useEffect(() => {
    if (!focus?.messageId || loading || focusDone.current === focus) return;
    const el = scrollRef.current?.querySelector(`[data-mid="${CSS.escape(focus.messageId)}"]`);
    if (!el) {
      if (focus.sortKey && focusRevealed.current !== focus) {
        focusRevealed.current = focus;
        onReveal(focus.sortKey);
      } else if (!focus.sortKey && hasOlder && !loadingOlder) {
        onLoadOlder();
      }
      return;
    }
    focusDone.current = focus;
    atBottom.current = false;
    el.scrollIntoView({ block: "center" });
    setFocusedId(focus.messageId);
  }, [focus, loading, messages, hasOlder, loadingOlder, onLoadOlder, onReveal]);
  useEffect(() => {
    if (!focusedId) return;
    const t = setTimeout(() => setFocusedId(null), 2500);
    return () => clearTimeout(t);
  }, [focusedId]);

  const step = (dir) => {
    if (!hitList.length) return;
    setHit((h) => (h + dir + hitList.length) % hitList.length);
  };

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(formatPhone(conversation.customer));
      toast.success("Number copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  // Group into days, and mark the first bubble of each run from the same side
  const rows = useMemo(() => {
    const out = [];
    let lastDay = null;
    let lastDir = null;
    const after = animateAfter.current;
    for (const m of messages) {
      const d = toDate(m.timestamp);
      const day = d ? d.toDateString() : "unknown";
      if (day !== lastDay) {
        out.push({ kind: "day", key: `day-${day}`, label: d ? formatDayChip(d) : "Unknown date" });
        lastDay = day;
        lastDir = null;
      }
      const animate = after != null && (d?.getTime() ?? 0) > after;
      out.push({ kind: "msg", key: m.id, m, first: m.direction !== lastDir, animate });
      lastDir = m.type === "reaction" ? null : m.direction;
    }
    return out;
  }, [messages]);

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 wa-anim-chat">
      {/* Header */}
      <div className="h-[59px] px-4 bg-[var(--wa-header)] flex items-center gap-3 shrink-0 border-l border-[var(--wa-border)]">
        <button type="button" onClick={onBack} className="md:hidden text-[var(--wa-muted)] text-2xl -ml-1" aria-label="Back">
          <MdArrowBack />
        </button>
        <button type="button" onClick={onToggleInfo} className="flex items-center gap-3 min-w-0 flex-1 text-left">
          <Avatar name={name} seed={conversation.customer} size={40} />
          <div className="min-w-0">
            <p className="text-[16px] text-[var(--wa-text)] truncate">{name}</p>
            <p className="text-[13px] text-[var(--wa-muted)] truncate">
              {formatPhone(conversation.customer)} · handled by <span className="text-[var(--wa-text)]/80">{handler}</span>
            </p>
          </div>
        </button>
        <IconButton label="Search messages" active={searchOpen} onClick={() => setSearchOpen((s) => !s)}>
          <MdSearch />
        </IconButton>
        <Dropdown
          width={220}
          trigger={({ open, toggle }) => (
            <IconButton label="Menu" active={open} onClick={toggle}>
              <MdMoreVert />
            </IconButton>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon={MdInfoOutline} onClick={() => { onToggleInfo(); close(); }}>
                {infoOpen ? "Hide contact info" : "Contact info"}
              </MenuItem>
              <MenuItem icon={MdContentCopy} onClick={() => { copyNumber(); close(); }}>Copy number</MenuItem>
              <MenuItem icon={MdOpenInNew} onClick={() => { window.open(waLink(conversation.customer), "_blank", "noopener"); close(); }}>
                Open in WhatsApp
              </MenuItem>
              <MenuItem icon={MdClose} onClick={() => { onBack(); close(); }}>Close chat</MenuItem>
            </>
          )}
        </Dropdown>
      </div>

      {/* In-chat search bar */}
      {searchOpen && (
        <div className="wa-anim-up px-4 py-2 bg-[var(--wa-panel)] border-b border-[var(--wa-border)] flex items-center gap-2 shrink-0">
          <div className="flex-1 h-[35px] rounded-lg bg-[var(--wa-input)] flex items-center gap-2 px-3">
            <MdSearch className="text-[var(--wa-muted)] text-xl" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") step(e.shiftKey ? 1 : -1);
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSearchOpen(false);
                  setQuery("");
                }
              }}
              placeholder="Search in this chat"
              className="bg-transparent outline-none text-[15px] w-full placeholder:text-[var(--wa-muted)]"
            />
            {q && (
              <span
                className="text-[12.5px] text-[var(--wa-muted)] shrink-0"
                title={hasOlder && !pool?.all ? `Searched the latest ${searchable.length} messages` : undefined}
              >
                {hitList.length ? `${Math.min(hit, hitList.length - 1) + 1} of ${hitList.length}` : "No results"}
                {hasOlder && !pool?.all ? ` · latest ${searchable.length}` : ""}
              </span>
            )}
          </div>
          <IconButton label="Previous match" onClick={() => step(-1)}><MdKeyboardArrowUp /></IconButton>
          <IconButton label="Next match" onClick={() => step(1)}><MdKeyboardArrowDown /></IconButton>
          <IconButton label="Close search" onClick={() => { setSearchOpen(false); setQuery(""); }}><MdClose /></IconButton>
        </div>
      )}

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div ref={scrollRef} onScroll={onScroll} className="wa-wallpaper wa-scroll absolute inset-0 overflow-y-auto pb-4">
          <div ref={contentRef}>
            <div className="flex justify-center pt-3 px-6">
              <p className="max-w-md text-center text-[12.5px] leading-snug text-[#ffd279] bg-[#182229] rounded-lg px-3 py-1.5 flex items-start gap-1.5">
                <MdLock className="mt-0.5 shrink-0" />
                Read-only monitor. Messages are mirrored from {handler}&apos;s WhatsApp Business app.
              </p>
            </div>
            {!loading && hasOlder && (
              <div className="flex justify-center pt-3">
                <button
                  type="button"
                  onClick={() => onLoadOlder()}
                  disabled={loadingOlder}
                  className="text-[12.5px] text-[var(--wa-muted)] bg-[#182229] rounded-full px-3 py-1 hover:text-[var(--wa-text)] disabled:opacity-70"
                >
                  {loadingOlder ? "Loading older messages…" : "Load older messages"}
                </button>
              </div>
            )}

            {loading && (
              <div className="px-[6%] pt-6 space-y-3">
                {[60, 40, 70, 35, 55].map((w, i) => (
                  <div key={i} className={`flex ${i % 2 ? "justify-end" : ""}`}>
                    <div className="wa-skeleton h-9 rounded-lg" style={{ width: `${w}%` }} />
                  </div>
                ))}
              </div>
            )}
            {!loading && messages.length === 0 && (
              <p className="text-center text-[13px] text-[var(--wa-muted)] mt-10">No messages stored for this chat yet.</p>
            )}

            {!loading &&
              rows.map((r) =>
                r.kind === "day" ? (
                  <div key={r.key} className="sticky top-2 z-10 flex justify-center my-3">
                    <span className="text-[12.5px] uppercase text-[var(--wa-muted)] bg-[#182229] rounded-lg px-3 py-1.5 shadow-sm">
                      {r.label}
                    </span>
                  </div>
                ) : (
                  <Bubble
                    key={r.key}
                    m={r.m}
                    first={r.first}
                    query={hitSet.has(r.m.id) ? q : ""}
                    active={r.m.id === activeHit || r.m.id === focusedId}
                    animate={r.animate}
                    onOpenImage={setPhotoId}
                  />
                )
              )}
          </div>
        </div>

        {(showJump || newCount > 0) && (
          <button
            type="button"
            onClick={jumpToBottom}
            className="wa-anim-pop absolute right-5 bottom-4 w-11 h-11 rounded-full bg-[var(--wa-header)] text-[var(--wa-muted)] text-2xl shadow-lg flex items-center justify-center hover:text-[var(--wa-text)] z-20"
            aria-label="Scroll to latest"
          >
            <MdKeyboardArrowDown />
            {newCount > 0 && (
              <span className="wa-anim-badge absolute -top-1.5 -left-1.5 min-w-[20px] h-5 px-1 rounded-full bg-[var(--wa-badge)] text-[#111b21] text-[11px] font-bold flex items-center justify-center">
                {newCount}
              </span>
            )}
          </button>
        )}
      </div>

      {photoIndex >= 0 && (
        <Lightbox
          items={photos}
          index={photoIndex}
          onIndex={(i) => setPhotoId(photos[i].id)}
          onClose={() => setPhotoId(null)}
          title={{ customer: name, employee: handler }}
        />
      )}

      {/* Read-only composer */}
      <div className="min-h-[62px] px-4 py-2.5 bg-[var(--wa-header)] flex items-center gap-3 shrink-0">
        <MdLock className="text-[var(--wa-muted)] text-xl shrink-0" />
        <div className="flex-1 h-[42px] rounded-lg bg-[#2a3942] px-4 flex items-center text-[14.5px] text-[var(--wa-muted)] truncate select-none">
          Replies are sent by {handler} from their phone
        </div>
        <span className="hidden sm:flex items-center gap-1 text-[12px] text-[var(--wa-muted)] shrink-0">
          <MdSchedule /> live
        </span>
      </div>
    </div>
  );
}
