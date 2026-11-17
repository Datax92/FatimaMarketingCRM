// WhatsApp media for the monitor (Next.js route handler). Admin-only.
//
// POST { items: [{ id, phone, msg }] }  (up to 50)
//   -> { items: { [mediaId]: { url, thumbUrl?, width?, height?, type, size, expiresAt }
//                            | { proxy: true } | { error, gone? } } }
//   Signed links to the copies saved in Firebase Storage (lib/whatsapp/server/media.js),
//   so the browser loads photos, voice notes and videos straight from Storage
//   instead of through this function; a photo also gets its small preview and
//   that preview's size. Links stay the same for days, so the browser serves
//   repeat views from its cache. Media with no copy yet is fetched from Meta
//   and saved first. { proxy: true } means no copy could be made (Storage
//   off); fetch that one with GET.
//
// GET /api/whatsapp-media?id={mediaId}&phone={phoneNumberId}&msg={messageId}
//   The file itself: the saved copy, or else downloaded from Meta with the
//   WhatsApp token, returned and saved at the same time. Used for downloads
//   and the proxy fallback. The token never reaches the browser.
//
// Token: the business token saved at Meta signup (wa_secrets/{wabaId}), else the
// system-user token in WHATSAPP_ACCESS_TOKEN (numbers linked through Make.com).

import { Readable } from "node:stream";
import { waitUntil } from "@/lib/whatsapp/server/runtime.js";
import { eachLimit, json, requireAdmin } from "@/lib/whatsapp/server/admin.js";
import { MediaGone, archiveFile, downloadFromMeta, savedCopy, signedLinks, storeCopy, upgradeCopy } from "@/lib/whatsapp/server/media.js";

const GONE = "WhatsApp deleted this file (it keeps media for 7 days) before the monitor saved a copy.";

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (!admin) return json(403, { error: "Admins only." });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Bad JSON" });
  }
  const items = (Array.isArray(body.items) ? body.items : [])
    .filter((i) => /^\d+$/.test(String(i?.id || "")))
    .slice(0, 50);

  const links = {};
  await eachLimit(items, 6, async (i) => {
    links[i.id] = await linkFor(String(i.id), String(i.phone || ""), String(i.msg || ""));
  });
  return json(200, { items: links });
}

async function linkFor(mediaId, phoneId, messageId) {
  let copy;
  try {
    copy = await savedCopy(mediaId);
  } catch {
    return { proxy: true }; // Storage unreachable
  }
  if (!copy) {
    let file;
    try {
      file = await downloadFromMeta(mediaId, phoneId);
    } catch (err) {
      return err instanceof MediaGone ? { gone: true, error: GONE } : { error: err.message };
    }
    try {
      copy = await storeCopy({ messageId, mediaId, file });
    } catch (err) {
      console.error("whatsapp-media save failed", err.message);
      return { proxy: true };
    }
  } else if (!copy.cached || !copy.thumbTried) {
    // Saved before previews and long caching existed: brought up to date
    // after answering (shown without a preview this once)
    waitUntil(upgradeCopy({ messageId, mediaId, copy }).catch((err) => console.error("whatsapp-media upgrade failed", err.message)));
  }
  try {
    // Signed with the service account's key; no extra permission needed
    const links = await signedLinks(mediaId, { thumb: Boolean(copy.thumb) });
    return { ...links, type: copy.contentType, size: copy.size, ...(copy.thumb || {}) };
  } catch (err) {
    console.error("whatsapp-media signing failed", err.message);
    return { proxy: true };
  }
}

export async function GET(request) {
  const admin = await requireAdmin(request);
  if (!admin) return json(403, { error: "Admins only." });

  const params = new URL(request.url).searchParams;
  const mediaId = params.get("id") || "";
  const phoneId = params.get("phone") || "";
  const messageId = params.get("msg") || "";
  if (!/^\d+$/.test(mediaId)) return json(400, { error: "Missing media id" });

  // The saved copy, streamed so large videos and documents aren't held in memory
  try {
    const copy = await savedCopy(mediaId);
    if (copy) {
      return new Response(Readable.toWeb(archiveFile(mediaId).createReadStream()), {
        status: 200,
        headers: {
          "content-type": copy.contentType,
          "content-length": String(copy.size),
          "cache-control": "private, max-age=86400",
        },
      });
    }
  } catch (err) {
    // Storage not set up or unreachable: fall back to Meta below
    console.error("whatsapp-media storage read failed", err.message);
  }

  try {
    const file = await downloadFromMeta(mediaId, phoneId);
    waitUntil(
      storeCopy({ messageId, mediaId, file }).catch((err) => console.error("whatsapp-media save failed", err.message))
    );
    return new Response(file.body, {
      status: 200,
      headers: {
        "content-type": file.contentType,
        "content-length": String(file.body.length),
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (err) {
    if (err instanceof MediaGone) return json(410, { error: GONE });
    console.error("whatsapp-media error", err);
    return json(502, { error: err.message });
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
