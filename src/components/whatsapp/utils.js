// Shared helpers for the WhatsApp monitor UI.

export const toDate = (ts) => (ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null);

export const formatPhone = (n) => (n ? `+${String(n).replace(/^\+/, "")}` : "Unknown");

export const waLink = (n) => `https://wa.me/${String(n || "").replace(/\D/g, "")}`;

const sameDay = (a, b) => a && b && a.toDateString() === b.toDateString();

export const isToday = (d) => sameDay(d, new Date());

function isYesterday(d) {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return sameDay(d, y);
}

const withinWeek = (d) => d && Date.now() - d.getTime() < 6 * 86400000;

// One formatter per format, made once: toLocaleTimeString/toLocaleDateString
// build a new Intl.DateTimeFormat on every call, which adds up across every
// chat row and message bubble.
const CLOCK = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
const WEEKDAY = new Intl.DateTimeFormat([], { weekday: "long" });
const SHORT_DATE = new Intl.DateTimeFormat([], { day: "2-digit", month: "2-digit", year: "numeric" });
const LONG_DATE = new Intl.DateTimeFormat([], { day: "numeric", month: "long", year: "numeric" });

export const formatClock = (d) => (d ? CLOCK.format(d) : "");

// Chat list: 10:42 / Yesterday / Monday / 12/03/2026, like WhatsApp.
export function formatListTime(d) {
  if (!d) return "";
  if (isToday(d)) return formatClock(d);
  if (isYesterday(d)) return "Yesterday";
  if (withinWeek(d)) return WEEKDAY.format(d);
  return SHORT_DATE.format(d);
}

// Date chips between messages: TODAY / YESTERDAY / Monday / 12 March 2026.
export function formatDayChip(d) {
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  if (withinWeek(d)) return WEEKDAY.format(d);
  return LONG_DATE.format(d);
}

export function timeAgo(d) {
  if (!d) return "";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "< 1 min";
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

const AVATAR_COLORS = [
  "#00a884", "#53bdeb", "#ff7eb6", "#ffbc38", "#a78bfa", "#fb7185",
  "#34d399", "#f97316", "#38bdf8", "#e879f9", "#facc15", "#2dd4bf",
];

export function avatarColor(seed) {
  let h = 0;
  for (const ch of String(seed || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(name) {
  const clean = String(name || "").replace(/[^\p{L}\p{N} ]/gu, "").trim();
  if (!clean) return "#";
  const parts = clean.split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// Customer spoke last and nobody has answered. Imported history never sets an
// unread count, so old chats from the history sync don't count as waiting.
export const isAwaiting = (c) => c?.lastDirection === "in" && Number(c.unread) > 0;

export const displayName = (c) => c?.customerName || formatPhone(c?.customer);

// Label + emoji for non-text message types, used in previews and bubbles.
export const TYPE_LABEL = {
  image: "Photo",
  video: "Video",
  audio: "Voice message",
  voice: "Voice message",
  document: "Document",
  sticker: "Sticker",
  location: "Location",
  contacts: "Contact card",
  reaction: "Reaction",
  interactive: "Reply",
  button: "Button reply",
  unsupported: "Unsupported message",
  media_placeholder: "Photo or file from chat history",
  edit: "Edited a message",
  revoke: "Deleted a message",
  view_once: "View-once message",
  poll: "Poll",
  poll_creation: "Poll",
  poll_update: "Poll vote",
  pin: "Pinned a message",
  group_invite: "Group invite",
  gif: "GIF",
  order: "Order",
  template: "Template message",
};

// What to call a message we have no text for: "Poll", or "Call log message"
// for a type WhatsApp added that we don't know yet
export const typeLabel = (type) => TYPE_LABEL[type] || (type ? `${type.charAt(0).toUpperCase()}${type.slice(1).replace(/_/g, " ")} message` : "Message");

// A message's text as it reads now: the latest edit, else what was sent. The
// webhook keeps the original in `text` (older edits overwrote it).
export const shownText = (m) => m?.editedText ?? m?.text ?? "";

// Firestore range covering one chat's message sortKeys, or one number's chat
// numberSortKeys (see api/_lib/keys.js).
export const sortKeyRange = (group) => [`${group}~`, `${group}~\uf8ff`];

// Oldest first; messages sent in the same second (WhatsApp times are whole
// seconds) keep a fixed order by sort key, or id
export function byTime(a, b) {
  const diff = (toDate(a.timestamp)?.getTime() || 0) - (toDate(b.timestamp)?.getTime() || 0);
  if (diff) return diff;
  const ka = a.sortKey || a.id;
  const kb = b.sortKey || b.id;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

// Snapshot docs as objects, reusing the previous object for every doc that
// didn't change, so memoized rows and bubbles skip redrawing.
export function freshDocs(snap, previous) {
  const changed = new Set(snap.docChanges().map((c) => c.doc.id));
  return snap.docs.map((d) => (!changed.has(d.id) && previous.get(d.id)) || { id: d.id, ...d.data() });
}

export const TOAST_MS = 7000;

export const PREFS_KEY = "wa-monitor-prefs";
export const PINS_KEY = "wa-monitor-pins";

export function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked (private window); settings just won't persist.
  }
}

// Short two-tone ping, generated so no audio file is needed.
let audioCtx;
export function playPing() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch {
    // Audio unavailable; notifications still show.
  }
}
