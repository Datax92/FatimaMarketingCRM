"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getCountFromServer, getDocs, limit, onSnapshot, orderBy, query, where } from "@/lib/db/client";
import toast from "react-hot-toast";
import { FaWhatsapp } from "react-icons/fa";
import { MdChat, MdGroups, MdAddLink, MdLock, MdManageHistory } from "react-icons/md";
import { auth, db } from "@/lib/firebase/client";
import { useAuth } from "@/context/AuthContext";
import WhatsAppConnectNumber from "./WhatsAppConnectNumber";
import ChatList from "./ChatList";
import ChatView from "./ChatView";
import ContactInfo from "./ContactInfo";
import TeamPanel from "./TeamPanel";
import RecordsPanel from "./RecordsPanel";
import RenameEmployee from "./RenameEmployee";
import { IconButton } from "./ui";
import { MessageToasts, NotificationSettings } from "./Notifications";
import {
  PINS_KEY, PREFS_KEY, TOAST_MS, byTime, displayName, freshDocs, isAwaiting, formatPhone, isToday, playPing, readStore, sortKeyRange,
  toDate, writeStore,
} from "./utils";
import "./whatsapp.css";

// Admin-only, read-only monitor for WhatsApp numbers connected through Cloud API
// Coexistence, styled after WhatsApp Web. Data is written by /api/whatsapp/webhook
// into wa_conversations and wa_messages; both are live (onSnapshot) so new
// messages appear instantly and raise popups/sound/desktop alerts.
// Numbers are linked from this page (WhatsAppConnectNumber) and listed in wa_numbers.
//
// The chat list loads the latest CONVO_PAGE chats and more on request; picking
// an employee loads their latest chats the same way, and an open chat is
// always watched on its own, so no chat drops out of reach as newer ones arrive.
//
// An open chat watches only its newest MSG_PAGE messages. Older pages are
// fetched once each, with a cursor (free, unlike re-running a bigger query),
// while the admin scrolls up, and messages the newest page moves past stay on
// screen. Paging uses the sort keys the webhook writes (no composite index
// needed, see api/_lib/keys.js); a chat whose messages don't all have one yet
// (sortKeys unset, from before paging) loads the old way, all at once, until
// /api/whatsapp/archive has added them. Employees' chats likewise.

const CONVO_PAGE = 300;
const MSG_PAGE = 60;
// In-chat search reads this many of the newest messages, without drawing them
const SEARCH_DEPTH = 1000;
// The old, unordered way: Firestore returns an equality query in id order, so
// the cap is set well above any real chat's length
const MESSAGE_LIMIT = 5000;
// /api/whatsapp/archive (media saving, sort keys) is asked to run at most this
// often per browser, and again while it reports work left
const ARCHIVE_SWEEP_KEY = "wa-archive-sweep";
const ARCHIVE_SWEEP_MS = 60 * 60 * 1000;
const ARCHIVE_AGAIN_MS = 5.5 * 60 * 1000;
// Only alert for messages this recent, so history imports stay quiet.
const ALERT_WINDOW_MS = 3 * 60 * 1000;

const DEFAULT_PREFS = { popups: true, sound: true, desktop: false };

// Adds messages to the open chat's kept set. Results for a chat that's no
// longer open (a fetch finishing after a switch) are dropped.
function keepDocs(kept, id, docs, done) {
  if (kept.id !== id) return kept;
  const all = new Map(kept.docs);
  for (const m of docs) all.set(m.id, m);
  return { id, docs: all, done: done || kept.done };
}

export default function AdminWhatsAppMonitor() {
  // Full admins only; sub admins (managers) are kept out
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [conversations, setConversations] = useState([]);
  const [convoLoading, setConvoLoading] = useState(true);
  const [convoError, setConvoError] = useState("");
  const [waNumbers, setWaNumbers] = useState([]);

  const [convoLimit, setConvoLimit] = useState(CONVO_PAGE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [employeeConvos, setEmployeeConvos] = useState([]);
  const [employeeLimit, setEmployeeLimit] = useState(CONVO_PAGE);
  // Whether the picked employee's chats all have numberSortKey, so they can page
  const [employeeMode, setEmployeeMode] = useState({ id: null, keyed: false });
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [totalChats, setTotalChats] = useState(null);
  const [chatCounts, setChatCounts] = useState({});
  const [renaming, setRenaming] = useState(null);

  const [view, setView] = useState("chats"); // chats | team | records
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [pins, setPins] = useState(() => readStore(PINS_KEY, {}));
  const [prefs, setPrefs] = useState(() => readStore(PREFS_KEY, DEFAULT_PREFS));

  const [selectedId, setSelectedId] = useState(null);
  // The open chat's messages, each tagged with its chat so a switch never shows
  // the previous chat's: `newest` is the watched newest page; `kept` holds older
  // pages and messages the newest page has moved past (`done`: nothing older)
  const [newest, setNewest] = useState({ id: null, docs: [] });
  const [kept, setKept] = useState({ id: null, docs: new Map(), done: false });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  // Message to scroll to when a chat is opened from the records view
  const [focus, setFocus] = useState(null);

  const [toasts, setToasts] = useState([]);
  const [flashIds, setFlashIds] = useState(() => new Set());

  // Latest values for the snapshot callback, which is created once
  const live = useRef({});
  live.current = { prefs, waNumbers, selectedId };
  const seenLastAt = useRef(new Map());
  const firstSnapshot = useRef(true);
  // Last snapshot's objects, reused for docs that didn't change
  const convoObjs = useRef(new Map());
  const employeeObjs = useRef(new Map());
  const messageObjs = useRef(new Map());

  const labelFor = useCallback(
    (phoneNumberId, businessNumber) => {
      const n = waNumbers.find((x) => x.id === phoneNumberId);
      return n?.label || n?.verifiedName || formatPhone(n?.displayNumber || businessNumber);
    },
    [waNumbers]
  );
  const handlerOf = useCallback((c) => labelFor(c.phoneNumberId, c.businessNumber), [labelFor]);

  const dismissToast = useCallback((key) => setToasts((t) => t.filter((x) => x.key !== key)), []);

  // New customer message: popup, sound, desktop alert, row flash
  const alertNew = useCallback(
    (c) => {
      const { prefs: p, waNumbers: nums, selectedId: open } = live.current;
      const n = nums.find((x) => x.id === c.phoneNumberId);
      const handler = n?.label || n?.verifiedName || formatPhone(c.businessNumber);
      const name = displayName(c);
      const text = c.lastMessage || "New message";
      const viewing = open === c.id && document.visibilityState === "visible";

      setFlashIds((s) => new Set(s).add(c.id));
      setTimeout(() => setFlashIds((s) => {
        const next = new Set(s);
        next.delete(c.id);
        return next;
      }), 1700);

      if (viewing) return;
      if (p.sound) playPing();
      if (p.popups) {
        const key = `${c.id}-${Date.now()}`;
        setToasts((t) => [...t.filter((x) => x.convoId !== c.id), { key, convoId: c.id, customer: c.customer, name, text, handler }].slice(-4));
        setTimeout(() => dismissToast(key), TOAST_MS);
      }
      if (p.desktop && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try {
          const note = new Notification(`${name} · ${handler}`, { body: text, tag: c.id, icon: "/favicon.ico" });
          note.onclick = () => {
            window.focus();
            setView("chats");
            setSelectedId(c.id);
            note.close();
          };
        } catch {
          // Some browsers only allow notifications from a service worker.
        }
      }
    },
    [dismissToast]
  );

  // Live conversation list, newest first
  useEffect(() => {
    if (!isAdmin) return;
    firstSnapshot.current = true;
    const q = query(collection(db, "wa_conversations"), orderBy("lastAt", "desc"), limit(convoLimit));
    return onSnapshot(
      q,
      (snap) => {
        const list = freshDocs(snap, convoObjs.current);
        convoObjs.current = new Map(list.map((c) => [c.id, c]));
        if (!firstSnapshot.current) {
          for (const change of snap.docChanges()) {
            if (change.type === "removed") continue;
            const c = { id: change.doc.id, ...change.doc.data() };
            const at = toDate(c.lastAt)?.getTime() || 0;
            const prev = seenLastAt.current.get(c.id) || 0;
            if (isAwaiting(c) && at > prev && Date.now() - at < ALERT_WINDOW_MS) alertNew(c);
          }
        }
        for (const c of list) seenLastAt.current.set(c.id, toDate(c.lastAt)?.getTime() || 0);
        firstSnapshot.current = false;
        setConversations(list);
        setConvoLoading(false);
        setLoadingMore(false);
        setConvoError("");
      },
      (err) => {
        console.error("wa_conversations", err);
        setConvoError(err.code === "permission-denied" ? "You don't have permission to view WhatsApp data." : err.message);
        setConvoLoading(false);
        setLoadingMore(false);
      }
    );
  }, [isAdmin, alertNew, convoLimit]);

  // Can the picked employee's chats page? Only once every one of them has a
  // numberSortKey (both are cheap count queries)
  useEffect(() => {
    if (!isAdmin || employeeFilter === "all") return;
    let cancelled = false;
    const chats = collection(db, "wa_conversations");
    const [from, to] = sortKeyRange(employeeFilter);
    Promise.all([
      getCountFromServer(query(chats, where("numberSortKey", ">=", from), where("numberSortKey", "<=", to))),
      getCountFromServer(query(chats, where("phoneNumberId", "==", employeeFilter))),
    ]).then(
      ([keyed, all]) => !cancelled && setEmployeeMode({ id: employeeFilter, keyed: keyed.data().count >= all.data().count }),
      () => !cancelled && setEmployeeMode({ id: employeeFilter, keyed: false })
    );
    return () => {
      cancelled = true;
    };
  }, [isAdmin, employeeFilter]);

  // The picked employee's chats: newest first a page at a time, or all at
  // once (equality-only) while some still lack a numberSortKey
  useEffect(() => {
    if (!isAdmin || employeeFilter === "all" || employeeMode.id !== employeeFilter) {
      setEmployeeConvos([]);
      return;
    }
    const chats = collection(db, "wa_conversations");
    const [from, to] = sortKeyRange(employeeFilter);
    const q = employeeMode.keyed
      ? query(chats, where("numberSortKey", ">=", from), where("numberSortKey", "<=", to), orderBy("numberSortKey", "desc"), limit(employeeLimit))
      : query(chats, where("phoneNumberId", "==", employeeFilter));
    return onSnapshot(
      q,
      (snap) => {
        const list = freshDocs(snap, employeeObjs.current);
        employeeObjs.current = new Map(list.map((c) => [c.id, c]));
        setEmployeeConvos(list);
        setLoadingMore(false);
      },
      (err) => {
        console.error("wa_conversations (employee)", err);
        setLoadingMore(false);
      }
    );
  }, [isAdmin, employeeFilter, employeeMode, employeeLimit]);

  // The open chat, even when it isn't in the loaded lists (opened from records)
  useEffect(() => {
    if (!selectedId) {
      setSelectedDoc(null);
      return;
    }
    return onSnapshot(
      doc(db, "wa_conversations", selectedId),
      (d) => setSelectedDoc(d.exists() ? { id: d.id, ...d.data() } : null),
      (err) => console.error("wa_conversations (open chat)", err)
    );
  }, [selectedId]);

  // Connected numbers and the employee each one belongs to
  useEffect(() => {
    if (!isAdmin) return;
    return onSnapshot(
      collection(db, "wa_numbers"),
      (snap) => setWaNumbers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("wa_numbers", err)
    );
  }, [isAdmin]);

  // True chat totals, overall and per number; the lists only hold what's loaded
  const numberIds = waNumbers.map((n) => n.id).sort().join(",");
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const chats = collection(db, "wa_conversations");
    const ids = numberIds ? numberIds.split(",") : [];
    Promise.all([
      getCountFromServer(chats),
      ...ids.map((id) => getCountFromServer(query(chats, where("phoneNumberId", "==", id)))),
    ]).then(
      ([all, ...each]) => {
        if (cancelled) return;
        setTotalChats(all.data().count);
        setChatCounts(Object.fromEntries(ids.map((id, i) => [id, each[i].data().count])));
      },
      (err) => console.error("wa_conversations count", err)
    );
    return () => {
      cancelled = true;
    };
  }, [isAdmin, numberIds]);

  // Background upkeep (api/whatsapp-archive.js): saves any photo, voice note or
  // file with no permanent copy yet (Meta deletes them after 7 days), and adds
  // sort keys to older chats so they page. Asked again while it has work left.
  useEffect(() => {
    if (!isAdmin) return;
    try {
      if (Date.now() - Number(localStorage.getItem(ARCHIVE_SWEEP_KEY) || 0) < ARCHIVE_SWEEP_MS) return;
      localStorage.setItem(ARCHIVE_SWEEP_KEY, String(Date.now()));
    } catch {
      // Storage blocked; the server limits how often it runs anyway
    }
    let timer;
    let stopped = false;
    let warned = false;
    const run = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token || stopped) return;
        const res = await fetch("/api/whatsapp/archive", { method: "POST", headers: { authorization: `Bearer ${token}` } });
        // `npm run dev` answers /api with index.html
        const data = await res.json().catch(() => null);
        if (data?.error && !warned) {
          warned = true;
          toast.error(`WhatsApp media isn't being saved: ${data.error}`, { duration: 12000 });
        }
        if (data?.more && !stopped) timer = setTimeout(run, ARCHIVE_AGAIN_MS);
      } catch {
        // Offline; the daily run catches up
      }
    };
    run();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [isAdmin]);

  // Esc closes the contact drawer, then the chat
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      if (infoOpen) setInfoOpen(false);
      else setSelectedId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [infoOpen]);

  const updatePrefs = (next) => {
    setPrefs(next);
    writeStore(PREFS_KEY, next);
  };

  const togglePin = useCallback((id) => {
    setPins((p) => {
      const next = { ...p };
      if (next[id]) delete next[id];
      else next[id] = Date.now();
      writeStore(PINS_KEY, next);
      return next;
    });
  }, []);

  // Latest chats plus all of the picked employee's
  const allConversations = useMemo(() => {
    if (!employeeConvos.length) return conversations;
    const map = new Map(conversations.map((c) => [c.id, c]));
    for (const c of employeeConvos) if (!map.has(c.id)) map.set(c.id, c);
    return [...map.values()];
  }, [conversations, employeeConvos]);

  // One entry per connected business number, with conversation stats
  const employees = useMemo(() => {
    const map = new Map();
    const blank = (id, display, n) => ({
      id,
      display,
      name: n?.label || n?.verifiedName || formatPhone(display),
      label: n?.label || null,
      verifiedName: n?.verifiedName || null,
      // Only numbers in wa_numbers have a label to change
      canRename: Boolean(n),
      chats: 0, awaiting: 0, today: 0, lastAt: null, oldestWaiting: null,
    });
    for (const n of waNumbers) map.set(n.id, blank(n.id, n.displayNumber, n));
    for (const c of allConversations) {
      if (!c.phoneNumberId) continue;
      const e = map.get(c.phoneNumberId) || blank(c.phoneNumberId, c.businessNumber);
      const at = toDate(c.lastAt);
      e.chats += 1;
      if (isToday(at)) e.today += 1;
      if (isAwaiting(c)) {
        e.awaiting += 1;
        if (at && (!e.oldestWaiting || at < e.oldestWaiting)) e.oldestWaiting = at;
      }
      if (at && (!e.lastAt || at > e.lastAt)) e.lastAt = at;
      map.set(c.phoneNumberId, e);
    }
    for (const e of map.values()) e.chats = Math.max(e.chats, chatCounts[e.id] || 0);
    return [...map.values()].sort((a, b) => (b.lastAt?.getTime() || 0) - (a.lastAt?.getTime() || 0));
  }, [allConversations, waNumbers, chatCounts]);

  const scoped = useMemo(
    () => (employeeFilter === "all" ? allConversations : allConversations.filter((c) => c.phoneNumberId === employeeFilter)),
    [allConversations, employeeFilter]
  );

  const counts = useMemo(
    () => ({
      all: scoped.length,
      unanswered: scoped.filter(isAwaiting).length,
      today: scoped.filter((c) => isToday(toDate(c.lastAt))).length,
      pinned: scoped.filter((c) => pins[c.id]).length,
    }),
    [scoped, pins]
  );

  const totalUnanswered = useMemo(() => allConversations.filter(isAwaiting).length, [allConversations]);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    const digits = s.replace(/\D/g, "");
    const list = scoped.filter((c) => {
      if (filter === "unanswered" && !isAwaiting(c)) return false;
      if (filter === "today" && !isToday(toDate(c.lastAt))) return false;
      if (filter === "pinned" && !pins[c.id]) return false;
      if (!s) return true;
      return (
        (digits && String(c.customer || "").includes(digits)) ||
        String(c.customerName || "").toLowerCase().includes(s) ||
        String(c.lastMessage || "").toLowerCase().includes(s) ||
        handlerOf(c).toLowerCase().includes(s)
      );
    });

    const time = (c) => toDate(c.lastAt)?.getTime() || 0;
    const waiting = (c) => (isAwaiting(c) ? 1 : 0);
    const compare = {
      recent: (a, b) => time(b) - time(a),
      oldest: (a, b) => time(a) - time(b),
      waiting: (a, b) => waiting(b) - waiting(a) || (waiting(a) ? time(a) - time(b) : time(b) - time(a)),
      unread: (a, b) => (Number(b.unread) || 0) * waiting(b) - (Number(a.unread) || 0) * waiting(a) || time(b) - time(a),
      name: (a, b) => displayName(a).localeCompare(displayName(b)),
    }[sort];

    return list.sort((a, b) => (pins[b.id] ? 1 : 0) - (pins[a.id] ? 1 : 0) || compare(a, b));
  }, [scoped, filter, search, sort, pins, handlerOf]);

  const todayTotal = useMemo(() => allConversations.filter((c) => isToday(toDate(c.lastAt))).length, [allConversations]);
  const chatTotal = Math.max(totalChats || 0, allConversations.length);
  const canLoadMore =
    employeeFilter === "all"
      ? conversations.length >= convoLimit && (totalChats == null || totalChats > conversations.length)
      : employeeMode.id === employeeFilter && employeeMode.keyed && employeeConvos.length >= employeeLimit;

  // Unanswered count in the browser tab, like WhatsApp Web
  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);
  useEffect(() => {
    document.title = `${totalUnanswered ? `(${totalUnanswered}) ` : ""}WhatsApp Monitor`;
  }, [totalUnanswered]);

  const selected =
    allConversations.find((c) => c.id === selectedId) || (selectedDoc?.id === selectedId ? selectedDoc : null);

  // Whether the open chat pages by sort key; null until the chat itself is known
  const keyed = selected ? Boolean(selected.sortKeys) : null;

  // The newest messages of the open chat, live: its latest page, or (from
  // before paging) all of them in one equality-only query
  useEffect(() => {
    setInfoOpen((o) => o && Boolean(selectedId));
    setKept({ id: selectedId, docs: new Map(), done: false });
    if (!selectedId || keyed === null) return;
    const all = collection(db, "wa_messages");
    const [from, to] = sortKeyRange(selectedId);
    const q = keyed
      ? query(all, where("sortKey", ">=", from), where("sortKey", "<=", to), orderBy("sortKey", "desc"), limit(MSG_PAGE))
      : query(all, where("conversationId", "==", selectedId), limit(MESSAGE_LIMIT));
    return onSnapshot(
      q,
      (snap) => {
        const previous = messageObjs.current;
        const docs = freshDocs(snap, previous);
        // A new message pushes the oldest out of the watched page; it stays on screen
        const dropped = snap
          .docChanges()
          .filter((c) => c.type === "removed")
          .map((c) => previous.get(c.doc.id) || { id: c.doc.id, ...c.doc.data() });
        messageObjs.current = new Map(docs.map((m) => [m.id, m]));
        if (dropped.length) setKept((k) => keepDocs(k, selectedId, dropped));
        setNewest({ id: selectedId, docs });
      },
      (err) => {
        console.error("wa_messages", err);
        setNewest({ id: selectedId, docs: [] });
      }
    );
  }, [selectedId, keyed]);

  // Everything loaded for the open chat, oldest first; null while loading
  const thread = useMemo(() => {
    if (!selectedId || newest.id !== selectedId) return null;
    const all = new Map(kept.id === selectedId ? kept.docs : []);
    for (const m of newest.docs) all.set(m.id, m);
    return [...all.values()].sort(byTime);
  }, [selectedId, newest, kept]);
  const threadRef = useRef(null);
  threadRef.current = thread;

  const msgLoading = Boolean(selectedId) && !thread;
  const hasOlder = Boolean(keyed && thread && !(kept.id === selectedId && kept.done) && thread.length >= MSG_PAGE);
  const messages = useMemo(() => {
    if (!thread) return [];
    // Edits and deletes are already applied to the message they point at; one
    // whose message was never stored stays as a note (once nothing older is
    // left to load, since that message may just not be loaded yet)
    const ids = new Set(thread.map((m) => m.id));
    return thread.filter((m) => !(m.originalId && (m.type === "edit" || m.type === "revoke") && (hasOlder || ids.has(m.originalId))));
  }, [thread, hasOlder]);

  // Older messages, fetched once: the page before the oldest shown, or
  // (`fromKey`) everything back to that message, for search and records
  const olderBusy = useRef(false);
  const fetchOlder = useCallback(
    async (fromKey) => {
      const oldest = threadRef.current?.[0]?.sortKey;
      if (!keyed || !selectedId || !oldest || olderBusy.current || (fromKey && fromKey >= oldest)) return;
      olderBusy.current = true;
      setLoadingOlder(true);
      const id = selectedId;
      try {
        const [from] = sortKeyRange(id);
        const snap = await getDocs(
          fromKey
            ? query(collection(db, "wa_messages"), where("sortKey", ">=", fromKey), where("sortKey", "<", oldest), orderBy("sortKey", "desc"))
            : query(collection(db, "wa_messages"), where("sortKey", ">=", from), where("sortKey", "<", oldest), orderBy("sortKey", "desc"), limit(MSG_PAGE))
        );
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setKept((k) => keepDocs(k, id, docs, !fromKey && snap.size < MSG_PAGE));
      } catch (err) {
        console.error("wa_messages (older)", err);
      } finally {
        olderBusy.current = false;
        setLoadingOlder(false);
      }
    },
    [keyed, selectedId]
  );
  const loadOlder = useCallback(() => fetchOlder(), [fetchOlder]);

  // The newest SEARCH_DEPTH messages for in-chat search, read once per chat and
  // never drawn; finding one older than what's shown loads back to it
  const searchPool = useRef({ id: null, job: null });
  const loadSearchPool = useCallback(() => {
    if (searchPool.current.id === selectedId && searchPool.current.job) return searchPool.current.job;
    const [from, to] = sortKeyRange(selectedId);
    const job = getDocs(
      query(collection(db, "wa_messages"), where("sortKey", ">=", from), where("sortKey", "<=", to), orderBy("sortKey", "desc"), limit(SEARCH_DEPTH))
    ).then((snap) => ({
      messages: snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => !m.originalId),
      all: snap.size < SEARCH_DEPTH,
    }));
    job.catch(() => {
      if (searchPool.current.job === job) searchPool.current = { id: null, job: null };
    });
    searchPool.current = { id: selectedId, job };
    return job;
  }, [selectedId]);
  const selectedNumber = selected ? waNumbers.find((n) => n.id === selected.phoneNumberId) : null;

  // Switching employee closes a chat that belongs to someone else
  const chooseEmployee = (id) => {
    if (id !== employeeFilter) setEmployeeLimit(CONVO_PAGE);
    setEmployeeFilter(id);
    setView("chats");
    if (id !== "all" && selected && selected.phoneNumberId !== id) setSelectedId(null);
  };

  const openChat = useCallback((id) => {
    setView("chats");
    setSelectedId(id);
    setFocus(null);
  }, []);

  // From the records view: the list stays, the chat opens at that message
  // (ChatView loads back to it by its sortKey if it's older than what's shown)
  const openRecord = useCallback((convoId, messageId, sortKey) => {
    setSelectedId(convoId);
    setFocus({ messageId, sortKey, at: Date.now() });
  }, []);

  if (!isAdmin) return null;

  const connectTrigger = (open) => (
    <IconButton label="Connect a number" onClick={open}>
      <MdAddLink />
    </IconButton>
  );

  // Rail actions repeated in the panel header on small screens
  const mobileActions = (
    <div className="flex md:hidden items-center gap-1">
      <IconButton label={view === "team" ? "Chats" : "Team"} onClick={() => setView((v) => (v === "team" ? "chats" : "team"))}>
        {view === "team" ? <MdChat /> : <MdGroups />}
      </IconButton>
      <IconButton
        label={view === "records" ? "Chats" : "Deleted & edited"}
        onClick={() => setView((v) => (v === "records" ? "chats" : "records"))}
      >
        {view === "records" ? <MdChat /> : <MdManageHistory />}
      </IconButton>
      <NotificationSettings prefs={prefs} onChange={updatePrefs} unanswered={totalUnanswered} align="right" />
      <WhatsAppConnectNumber renderTrigger={connectTrigger} />
    </div>
  );

  return (
    <>
      <div className="wa-app flex h-[calc(100dvh-var(--nav-h))] min-h-[520px] overflow-hidden">
        {/* Navigation rail */}
        <nav className="hidden md:flex w-16 shrink-0 flex-col items-center gap-2 py-3 bg-[var(--wa-rail)] border-r border-[var(--wa-border)]">
          <div className="w-10 h-10 mb-2 rounded-full bg-[var(--wa-accent)] flex items-center justify-center text-[#111b21] text-2xl" title="WhatsApp Monitor">
            <FaWhatsapp />
          </div>
          <IconButton label="Chats" active={view === "chats"} onClick={() => setView("chats")} badge={totalUnanswered}>
            <MdChat />
          </IconButton>
          <IconButton label="Team overview" active={view === "team"} onClick={() => setView("team")}>
            <MdGroups />
          </IconButton>
          <IconButton label="Deleted & edited messages" active={view === "records"} onClick={() => setView("records")}>
            <MdManageHistory />
          </IconButton>
          <NotificationSettings prefs={prefs} onChange={updatePrefs} unanswered={0} />
          <div className="flex-1" />
          <WhatsAppConnectNumber renderTrigger={connectTrigger} />
        </nav>

        {/* Left panel */}
        <aside
          className={`${selected ? "hidden md:flex" : "flex"} w-full md:w-[360px] lg:w-[400px] shrink-0 flex-col min-h-0 border-r border-[var(--wa-border)]`}
        >
          {view === "team" ? (
            <TeamPanel
              employees={employees}
              totals={{ chats: chatTotal, unanswered: totalUnanswered, today: todayTotal }}
              headerActions={mobileActions}
              onRename={setRenaming}
              onPick={(id) => {
                setFilter("all");
                chooseEmployee(id);
              }}
            />
          ) : view === "records" ? (
            <RecordsPanel
              conversations={allConversations}
              employeeFilter={employeeFilter}
              scopeName={employees.find((e) => e.id === employeeFilter)?.name}
              onShowAll={() => setEmployeeFilter("all")}
              handlerOf={handlerOf}
              selectedMessageId={focus?.messageId}
              onOpen={openRecord}
              headerActions={mobileActions}
            />
          ) : (
            <div key="chats" className="wa-anim-panel flex flex-col h-full min-h-0">
              <ChatList
                conversations={visible}
                loading={convoLoading}
                error={convoError}
                selectedId={selectedId}
                onSelect={openChat}
                search={search}
                onSearch={setSearch}
                filter={filter}
                onFilter={setFilter}
                counts={counts}
                employees={employees}
                employeeFilter={employeeFilter}
                onEmployeeFilter={chooseEmployee}
                sort={sort}
                onSort={setSort}
                pins={pins}
                onTogglePin={togglePin}
                flashIds={flashIds}
                handlerOf={handlerOf}
                headerActions={mobileActions}
                onRename={setRenaming}
                canLoadMore={canLoadMore}
                loadingMore={loadingMore}
                onLoadMore={() => {
                  setLoadingMore(true);
                  if (employeeFilter === "all") setConvoLimit((n) => n + CONVO_PAGE);
                  else setEmployeeLimit((n) => n + CONVO_PAGE);
                }}
              />
            </div>
          )}
        </aside>

        {/* Chat */}
        <main className={`${selected ? "flex" : "hidden md:flex"} relative flex-1 min-w-0 min-h-0`}>
          {selected ? (
            <>
              <div className="flex-1 min-w-0 min-h-0">
                <ChatView
                  key={selected.id}
                  conversation={selected}
                  messages={messages}
                  loading={msgLoading}
                  handler={handlerOf(selected)}
                  infoOpen={infoOpen}
                  onBack={() => setSelectedId(null)}
                  onToggleInfo={() => setInfoOpen((o) => !o)}
                  focus={focus}
                  hasOlder={hasOlder}
                  loadingOlder={loadingOlder}
                  onLoadOlder={loadOlder}
                  onReveal={fetchOlder}
                  onSearchPool={loadSearchPool}
                />
              </div>
              {infoOpen && (
                <div className="absolute inset-0 z-30 xl:static xl:w-[380px] xl:shrink-0 min-h-0">
                  <ContactInfo
                    conversation={selected}
                    messages={messages}
                    hasOlder={hasOlder}
                    handler={handlerOf(selected)}
                    employeeNumber={selectedNumber?.displayNumber}
                    onClose={() => setInfoOpen(false)}
                  />
                </div>
              )}
            </>
          ) : (
            <Welcome
              numbers={employees.length}
              chats={chatTotal}
              unanswered={totalUnanswered}
              onUnanswered={() => {
                setView("chats");
                setFilter("unanswered");
              }}
            />
          )}
        </main>

        {renaming && <RenameEmployee employee={renaming} onClose={() => setRenaming(null)} />}

        <MessageToasts
          toasts={toasts}
          onDismiss={dismissToast}
          onOpen={(t) => {
            openChat(t.convoId);
            dismissToast(t.key);
          }}
        />
      </div>
    </>
  );
}

function Welcome({ numbers, chats, unanswered, onUnanswered }) {
  return (
    <div className="wa-anim-fade flex-1 flex flex-col items-center justify-center bg-[#222e35] border-b-[6px] border-[var(--wa-accent)] px-8 text-center">
      <div className="wa-anim-float relative w-40 h-40 mb-8">
        <div className="absolute inset-0 rounded-full bg-[var(--wa-accent)]/10" />
        <div className="absolute inset-5 rounded-full bg-[var(--wa-accent)]/15" />
        <div className="absolute inset-10 rounded-full bg-[var(--wa-accent)] flex items-center justify-center text-[#111b21] text-5xl shadow-[0_0_40px_rgba(0,168,132,0.45)]">
          <FaWhatsapp />
        </div>
      </div>
      <h2 className="text-[32px] font-light text-[var(--wa-text)]">WhatsApp Monitor</h2>
      <p className="mt-3 max-w-md text-[14px] leading-6 text-[var(--wa-muted)]">
        Every conversation from your team&apos;s WhatsApp Business numbers, live in one place. Pick a chat to read it,
        or open the team view to see who has customers waiting.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {[
          { label: "Numbers", value: numbers },
          { label: "Chats", value: chats },
        ].map((s, i) => (
          <div key={s.label} className="wa-anim-up min-w-[110px] rounded-xl bg-[var(--wa-panel)] px-5 py-3" style={{ animationDelay: `${i * 60}ms` }}>
            <p className="text-[24px] text-[var(--wa-text)]">{s.value}</p>
            <p className="text-[12.5px] text-[var(--wa-muted)]">{s.label}</p>
          </div>
        ))}
        <button
          type="button"
          onClick={onUnanswered}
          className="wa-anim-up min-w-[110px] rounded-xl bg-[var(--wa-panel)] px-5 py-3 hover:bg-[var(--wa-active)] transition-colors"
          style={{ animationDelay: "120ms" }}
        >
          <p className={`text-[24px] ${unanswered ? "text-amber-300" : "text-[var(--wa-text)]"}`}>{unanswered}</p>
          <p className="text-[12.5px] text-[var(--wa-muted)]">Unanswered</p>
        </button>
      </div>
      <p className="mt-12 text-[13px] text-[var(--wa-muted)] flex items-center gap-1.5">
        <MdLock /> Read-only. Replies are sent by employees from their own phones.
      </p>
    </div>
  );
}
