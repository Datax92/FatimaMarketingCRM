// Permanent copies of WhatsApp media.
//
// Meta keeps a webhook's photo, voice note, video or document for 7 days (less
// once the sender deletes it), then the media id stops working. So every file
// is copied into Firebase Storage as soon as the webhook delivers it, and the
// monitor reads that copy from then on — deleted and old media stay viewable.
//
// Bucket: FIREBASE_STORAGE_BUCKET, else the project's default
// {projectId}.firebasestorage.app. Firebase Storage has to be switched on for
// the project (Firebase console > Storage > Get started).
//
// Each photo also gets a small WebP preview ({mediaId}.thumb.webp) whose size
// is kept on the file and on the message, so the monitor shows a light image
// in its true shape before it loads. Files never change once saved, so they
// carry a long browser cache, and signedLinks() hands out links that stay the
// same for days, which is what lets the browser reuse that cache.

import { getStorage } from "firebase-admin/storage";
import { FieldValue } from "firebase-admin/firestore";
import { db, tokenFor } from "./admin.js";

const GRAPH = "https://graph.facebook.com/v25.0";

// A saved file never changes: browsers may keep it for a week
export const FILE_CACHE = "private, max-age=604800, immutable";
// Photos get previews; stickers (often animated WebP) and GIFs are left as they are
const THUMB_TYPES = new Set(["image/jpeg", "image/png"]);
const THUMB_EDGE = 480;

// Meta no longer has the file (expired or deleted); retrying won't help.
export class MediaGone extends Error {}

export function bucket() {
  db();
  const name =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    `${process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebasestorage.app`;
  return getStorage().bucket(name);
}

export const archiveFile = (mediaId) => bucket().file(`whatsapp-media/${mediaId}`);
const thumbFile = (mediaId) => bucket().file(`whatsapp-media/${mediaId}.thumb.webp`);

// "480x360" -> { width, height }; "none" (no preview possible) or missing -> null
function parseThumb(value) {
  const m = /^(\d+)x(\d+)$/.exec(value || "");
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

// What's known about the saved copy, or null if there isn't one:
// { contentType, size, cached, thumb, thumbTried }
export async function savedCopy(mediaId) {
  try {
    const [meta] = await archiveFile(mediaId).getMetadata();
    return {
      contentType: meta.contentType || "application/octet-stream",
      size: Number(meta.size) || 0,
      cached: meta.cacheControl === FILE_CACHE,
      thumb: parseThumb(meta.metadata?.thumb),
      thumbTried: Boolean(meta.metadata?.thumb),
    };
  } catch (err) {
    if (err.code === 404) return null;
    throw err;
  }
}

// Small WebP preview of a photo: { body, width, height }, or null if it can't
// be read. sharp is loaded only when a photo needs it.
async function makeThumb(body, contentType) {
  if (!THUMB_TYPES.has(contentType)) return null;
  try {
    const { default: sharp } = await import("sharp");
    const { data, info } = await sharp(body)
      .rotate() // follow the photo's orientation tag
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer({ resolveWithObject: true });
    return { body: data, width: info.width, height: info.height };
  } catch (err) {
    console.error("whatsapp media preview failed", err.message);
    return null;
  }
}

// Links that read the saved copy (and its preview). Signed with a start time
// rounded down to a 3-day window and valid 7 days from it, so the same file
// gets the same link for days (and is served from the browser's cache) and
// every link has at least 4 days left.
const LINK_WINDOW_MS = 3 * 86400000;
const LINK_LIFE_MS = 7 * 86400000;
export async function signedLinks(mediaId, { thumb = false } = {}) {
  const accessibleAt = Math.floor(Date.now() / LINK_WINDOW_MS) * LINK_WINDOW_MS;
  const options = { version: "v4", action: "read", accessibleAt, expires: accessibleAt + LINK_LIFE_MS };
  const [[url], thumbUrl] = await Promise.all([
    archiveFile(mediaId).getSignedUrl(options),
    thumb ? thumbFile(mediaId).getSignedUrl(options).then(([u]) => u) : null,
  ]);
  return { url, thumbUrl, expiresAt: accessibleAt + LINK_LIFE_MS };
}

// Brings a copy saved before previews and caching existed up to date: the
// long cache setting, and a preview for a photo. Returns the preview size.
export async function upgradeCopy({ messageId, mediaId, copy }) {
  let thumb = copy.thumb;
  let thumbTag = copy.thumbTried ? undefined : "none";
  if (!copy.thumbTried && THUMB_TYPES.has(copy.contentType)) {
    const [body] = await archiveFile(mediaId).download();
    thumb = await makeThumb(body, copy.contentType);
    if (thumb) {
      await thumbFile(mediaId).save(thumb.body, { contentType: "image/webp", resumable: false, metadata: { cacheControl: FILE_CACHE } });
      thumbTag = `${thumb.width}x${thumb.height}`;
      thumb = { width: thumb.width, height: thumb.height };
    }
  }
  await archiveFile(mediaId).setMetadata({ cacheControl: FILE_CACHE, ...(thumbTag ? { metadata: { thumb: thumbTag } } : {}) });
  if (thumb && messageId) await markSaved(messageId, mediaId, { ...copy, thumb });
  return thumb;
}

// Downloads a file from Meta with the number's token: { body, contentType }.
export async function downloadFromMeta(mediaId, phoneId) {
  const token = await tokenFor(phoneId);
  if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN is not configured in Vercel.");

  const metaUrl = new URL(`${GRAPH}/${mediaId}`);
  if (/^\d+$/.test(phoneId || "")) metaUrl.searchParams.set("phone_number_id", phoneId);
  const metaRes = await fetch(metaUrl, { headers: { authorization: `Bearer ${token}` } });
  const meta = await metaRes.json().catch(() => ({}));
  if (!metaRes.ok || !meta.url) {
    if (metaRes.status === 404 || meta.error?.code === 100) throw new MediaGone("WhatsApp no longer has this file.");
    throw new Error(meta.error?.message || "Could not look up media.");
  }

  // Meta's media host answers with an HTML error page (status 200) when the
  // request has no User-Agent, so send one and reject anything that isn't the file.
  const file = await fetch(meta.url, {
    headers: { authorization: `Bearer ${token}`, "user-agent": "OSTravelPortal/1.0 (WhatsApp monitor)" },
  });
  const upstreamType = (file.headers.get("content-type") || "").toLowerCase();
  if (!file.ok || upstreamType.includes("text/html") || upstreamType.includes("application/json")) {
    const detail = (await file.text().catch(() => "")).slice(0, 200);
    console.error("whatsapp media download failed", file.status, upstreamType, detail);
    throw new Error(`Media download failed (${file.status})`);
  }
  // Buffered: fetch has already decompressed the body, so Meta's
  // content-length would be wrong, and a buffer gives the exact size.
  const body = Buffer.from(await file.arrayBuffer());
  return { body, contentType: meta.mime_type || upstreamType || "application/octet-stream" };
}

// Saves a downloaded file (and a photo's preview), then notes the copy on its
// message (only if the message still points at this media). Returns what
// savedCopy() would.
export async function storeCopy({ messageId, mediaId, file }) {
  const preview = await makeThumb(file.body, file.contentType);
  const thumb = preview ? { width: preview.width, height: preview.height } : null;
  if (preview) {
    await thumbFile(mediaId).save(preview.body, { contentType: "image/webp", resumable: false, metadata: { cacheControl: FILE_CACHE } });
  }
  await archiveFile(mediaId).save(file.body, {
    contentType: file.contentType,
    resumable: false,
    metadata: { cacheControl: FILE_CACHE, metadata: { thumb: thumb ? `${thumb.width}x${thumb.height}` : "none" } },
  });
  const copy = { contentType: file.contentType, size: file.body.length, cached: true, thumb, thumbTried: true };
  if (messageId) await markSaved(messageId, mediaId, copy);
  return copy;
}

async function markSaved(messageId, mediaId, { contentType, size, thumb }) {
  const ref = db().collection("wa_messages").doc(messageId);
  const current = (await ref.get()).data();
  if (current?.media?.id !== mediaId) return;
  await ref.set(
    {
      archive: {
        mediaId,
        path: archiveFile(mediaId).name,
        contentType,
        size,
        // The preview's size, so the monitor can lay the photo out before it loads
        ...(thumb ? { thumb } : {}),
        savedAt: FieldValue.serverTimestamp(),
      },
      archivePending: FieldValue.delete(),
      archiveError: FieldValue.delete(),
    },
    { merge: true }
  );
}

// Makes sure one message's media has a saved copy. Returns saved | gone | failed.
export async function archiveMedia({ messageId, mediaId, phoneId }) {
  try {
    const existing = await savedCopy(mediaId);
    if (existing) await markSaved(messageId, mediaId, existing);
    else await storeCopy({ messageId, mediaId, file: await downloadFromMeta(mediaId, phoneId) });
    return "saved";
  } catch (err) {
    const gone = err instanceof MediaGone;
    if (!gone) console.error("whatsapp media archive failed", messageId, err.message);
    await db()
      .collection("wa_messages")
      .doc(messageId)
      .set(
        {
          archiveError: gone ? "gone" : String(err.message || err).slice(0, 300),
          archiveTries: FieldValue.increment(1),
          // Pending items are retried by /api/whatsapp-archive; a file Meta
          // has dropped can't be fetched again
          ...(gone ? { archivePending: FieldValue.delete() } : {}),
        },
        { merge: true }
      )
      .catch(() => {});
    return gone ? "gone" : "failed";
  }
}

// When to stop starting new saves: 20s before the function's own time limit
// (getDeadline() from @vercel/functions), or no limit when there isn't one.
export const timeLeft = (functionDeadline) => (functionDeadline ? functionDeadline.getTime() - 20000 : Infinity);

// Archives a list of { messageId, mediaId, phoneId }, a few at a time, until
// the list or the time budget runs out. Whatever is left stays archivePending.
export async function archiveAll(jobs, { concurrency = 4, deadline = Infinity } = {}) {
  const results = { saved: 0, gone: 0, failed: 0, left: 0 };
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && Date.now() < deadline) {
      results[await archiveMedia(jobs[next++])] += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  results.left = jobs.length - next;
  return results;
}
