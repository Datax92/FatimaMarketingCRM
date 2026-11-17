import { useCallback, useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase/client";

// Photos, voice notes, videos and documents. /api/whatsapp/media hands out
// links to the copies saved in Firebase Storage (plus a photo's small
// preview), asked for in batches: one request for every file that comes into
// view together. The browser loads each file straight from Storage. A link
// stays the same for days and the files are cacheable, so links are kept
// across visits (localStorage): a photo seen before shows from the browser's
// cache without asking the server again. A file with no saved copy (Storage
// switched off) comes through the function instead.

const BATCH_MS = 30;
const BATCH_MAX = 40;
// Stop using a link an hour before it expires
const LINK_MARGIN_MS = 60 * 60 * 1000;
const STORE_KEY = "wa-media-links";
const STORE_MAX = 1500;

// media id -> { job: Promise<{ url, thumbUrl, width, height, type, size }>, until }
const links = new Map();
// media id -> the resolved link with its expiresAt, as kept in localStorage
const stored = readStored();
let saveTimer = null;
let queue = [];
let timer = null;

function readStored() {
  try {
    const all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    const now = Date.now();
    return new Map(Object.entries(all).filter(([, l]) => l?.url && l.expiresAt - LINK_MARGIN_MS > now));
  } catch {
    return new Map();
  }
}

// Written a moment after the last change; keeps the links that expire last.
// A photo whose preview is still being made isn't kept, so the next visit
// picks the preview up.
function remember(id, link) {
  if (!link.expiresAt || link.url.startsWith("blob:")) return;
  if (/^image\/(jpeg|png)$/.test(link.type) && !link.thumbUrl) return;
  stored.set(id, link);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const keep = [...stored.entries()].sort((a, b) => b[1].expiresAt - a[1].expiresAt).slice(0, STORE_MAX);
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(keep)));
    } catch {
      // Storage full or blocked: links just aren't kept between visits
    }
  }, 1000);
}

async function authHeader() {
  if (!auth.currentUser) throw new Error("Sign in again to view media.");
  return { authorization: `Bearer ${await auth.currentUser.getIdToken()}` };
}

// `npm run dev` doesn't serve /api and answers with the app's index.html
function checkApi(res) {
  if ((res.headers.get("content-type") || "").includes("text/html")) {
    throw new Error("Media loads on the deployed site only (the /api functions don't run under npm run dev).");
  }
}

async function flush() {
  const batch = queue.splice(0, BATCH_MAX);
  timer = queue.length ? setTimeout(flush, 0) : null;
  try {
    const res = await fetch("/api/whatsapp/media", {
      method: "POST",
      headers: { ...(await authHeader()), "content-type": "application/json" },
      body: JSON.stringify({ items: batch.map(({ m }) => ({ id: m.media.id, phone: m.phoneNumberId || "", msg: m.id || "" })) }),
    });
    checkApi(res);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not load media (${res.status})`);
    for (const { m, resolve, reject } of batch) {
      const r = data.items?.[m.media.id];
      if (r?.url) {
        const link = {
          url: r.url,
          thumbUrl: r.thumbUrl || null,
          width: r.width || 0,
          height: r.height || 0,
          type: r.type || "",
          size: r.size || 0,
          expiresAt: r.expiresAt || 0,
        };
        remember(m.media.id, link);
        resolve(link);
      } else if (r?.proxy) {
        fetchFile(m).then((blob) => resolve({ url: URL.createObjectURL(blob), type: blob.type, size: blob.size }), reject);
      } else reject(new Error(r?.error || "Could not load media."));
    }
  } catch (err) {
    for (const { reject } of batch) reject(err);
  }
}

// { url, thumbUrl, width, height, type, size } to show a message's media,
// shared by every viewer of it.
export function loadMedia(m) {
  const id = m?.media?.id;
  if (!id) return Promise.reject(new Error("This media was not shared with the monitor."));
  const now = Date.now();
  const cached = links.get(id);
  if (cached && cached.until > now) return cached.job;
  const known = stored.get(id);
  if (known && known.expiresAt - LINK_MARGIN_MS > now) {
    const job = Promise.resolve(known);
    links.set(id, { job, until: known.expiresAt - LINK_MARGIN_MS });
    return job;
  }
  const job = new Promise((resolve, reject) => {
    queue.push({ m, resolve, reject });
    timer ||= setTimeout(flush, BATCH_MS);
  });
  // Until the answer says when the link expires, reuse it for an hour
  links.set(id, { job, until: now + LINK_MARGIN_MS });
  job.then(
    (link) => link.expiresAt && links.set(id, { job, until: link.expiresAt - LINK_MARGIN_MS }),
    // Let a failed load be retried
    () => links.delete(id)
  );
  return job;
}

// The file itself, through the function (downloads, and media with no saved copy)
async function fetchFile(m) {
  const qs = new URLSearchParams({ id: m.media.id, phone: m.phoneNumberId || "", msg: m.id || "" });
  const res = await fetch(`/api/whatsapp/media?${qs}`, { headers: await authHeader() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Could not load media (${res.status})`);
  }
  checkApi(res);
  return res.blob();
}

// Saves a message's file to the computer; `filename` may be a function of the
// file's type. The in-memory copy is released afterwards.
export async function downloadMedia(m, filename) {
  if (!m?.media?.id) throw new Error("This media was not shared with the monitor.");
  const blob = await fetchFile(m);
  const url = URL.createObjectURL(blob);
  saveFile(url, typeof filename === "function" ? filename(blob.type) : filename);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// { ref, status: idle|loading|ready|error, url, thumbUrl, width, height, size, type, error, load }.
// With auto=true the file loads as soon as the element scrolls into view.
export function useMedia(m, { auto = false } = {}) {
  const ref = useRef(null);
  const [state, setState] = useState({ status: "idle" });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(() => {
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    return loadMedia(m).then(
      (file) => {
        if (mounted.current) setState({ status: "ready", ...file });
        return file;
      },
      (err) => {
        if (mounted.current) setState({ status: "error", error: err.message });
        throw err;
      }
    );
  }, [m]);

  useEffect(() => {
    if (!auto || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          load().catch(() => {});
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [auto, load]);

  return { ref, ...state, load };
}

export function formatBytes(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function saveFile(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "whatsapp-file";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
