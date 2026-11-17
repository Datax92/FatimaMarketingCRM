// WhatsApp Cloud API webhook (Next.js route handler).
//
// GET  -> Meta's one-time verification handshake (hub.verify_token / hub.challenge)
// POST -> Incoming events: customer messages, Coexistence echoes (messages staff
//         send from the WhatsApp Business app), delivery statuses, history sync
//         and contact sync. Everything is stored in Firestore for the admin panel.
//
// Photos, voice notes, videos and documents are copied into Firebase Storage
// right after the reply to Meta (lib/whatsapp/server/media.js), because Meta deletes them
// after 7 days. Anything that fails stays archivePending for /api/whatsapp/archive.
//
// Required Vercel environment variables:
//   WHATSAPP_VERIFY_TOKEN       - any secret string, same value you type in Meta
//   WHATSAPP_APP_SECRET         - Meta App Settings > Basic > App Secret
//   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY - the CRM's admin credentials

import crypto from "node:crypto";
import { FieldValue } from "@/lib/db/firestore";
import { getDeadline, waitUntil } from "@/lib/whatsapp/server/runtime.js";
import { db, eachLimit } from "@/lib/whatsapp/server/admin.js";
import { messageSortKey, numberSortKey } from "@/lib/whatsapp/server/keys.js";
import { archiveAll, timeLeft } from "@/lib/whatsapp/server/media.js";

// ---- Verification handshake ------------------------------------------------
export function GET(request) {
  const params = new URL(request.url).searchParams;
  const ok =
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN;
  return ok
    ? new Response(params.get("hub.challenge"), { status: 200 })
    : new Response("Forbidden", { status: 403 });
}

// ---- Events ----------------------------------------------------------------
export async function POST(request) {
  const raw = await request.text();

  if (!validSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  try {
    const writes = [];
    const ctx = { history: { latest: new Map(), numbers: new Map() }, chats: [] };
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        writes.push(...handleChange(entry.id, change.field, change.value || {}, ctx));
      }
    }
    await commit(writes);
    await applyChats(ctx.chats);
    await applyHistory(ctx.history);

    // Save the media after answering, so Meta isn't kept waiting on downloads
    const jobs = writes
      .filter((w) => w.data.archivePending && w.data.media?.id)
      .map((w) => ({ messageId: w.ref.id, mediaId: w.data.media.id, phoneId: w.data.phoneNumberId }));
    if (jobs.length) {
      const deadline = timeLeft(getDeadline(60));
      waitUntil(archiveAll(jobs, { deadline }).catch((err) => console.error("whatsapp-webhook archive error", err)));
    }
  } catch (err) {
    console.error("whatsapp-webhook error", err);
    // Non-200 makes Meta retry; writes are idempotent (doc id = message id).
    return new Response("Error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}

function validSignature(raw, header) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const given = header.slice(7);
  return (
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}

// Returns a list of { ref, data, merge } write descriptors. Chat updates from
// live messages go to ctx.chats, history's to ctx.history.
function handleChange(wabaId, field, value, { history, chats }) {
  const phoneNumberId = value.metadata?.phone_number_id || null;
  const businessNumber = value.metadata?.display_phone_number || null;
  const base = { wabaId, phoneNumberId, businessNumber };
  const writes = [];

  if (field === "messages") {
    const names = Object.fromEntries(
      (value.contacts || []).map((c) => [c.wa_id, c.profile?.name || null])
    );
    for (const m of value.messages || []) {
      writes.push(
        ...messageWrites(base, m, {
          customer: m.from,
          customerName: names[m.from] || null,
          direction: "in",
          source: "customer",
        }, chats)
      );
    }
    for (const s of value.statuses || []) {
      writes.push({
        ref: db().collection("wa_messages").doc(s.id),
        data: {
          status: s.status,
          statusAt: toDate(s.timestamp),
          ...(s.errors ? { errors: s.errors } : {}),
        },
        merge: true,
      });
    }
  }

  // Coexistence: messages staff sent from the WhatsApp Business app on their phone.
  if (field === "smb_message_echoes") {
    for (const m of value.message_echoes || []) {
      writes.push(
        ...messageWrites(base, m, { customer: m.to, direction: "out", source: "business_app" }, chats)
      );
    }
  }

  // Coexistence: one-time history import (up to ~6 months) after onboarding.
  // Messages are written one by one; each conversation is updated once per
  // webhook, and only if the history is newer than what it already shows.
  if (field === "history") {
    for (const h of value.history || []) {
      if (h.errors?.length && phoneNumberId) {
        history.numbers.set(phoneNumberId, `declined: ${h.errors[0].message || h.errors[0].title || h.errors[0].code}`);
      }
      if (h.metadata && phoneNumberId && !h.errors?.length) {
        history.numbers.set(phoneNumberId, `receiving: ${h.metadata.progress ?? "?"}%`);
      }
      for (const thread of h.threads || []) {
        // Media in history first arrives as an empty "media_placeholder"; the
        // photo, voice note or file follows in a later history webhook (below)
        for (const m of thread.messages || []) {
          const direction = m.from !== thread.id ? "out" : "in";
          writes.push(
            ...messageWrites(base, m, { customer: thread.id, direction, source: "history", withConversation: false }, chats)
          );
          const convoId = `${phoneNumberId}_${thread.id}`;
          const at = toDate(m.timestamp);
          const prev = history.latest.get(convoId);
          if (!prev || at > prev.lastAt) {
            history.latest.set(convoId, {
              ...base,
              customer: thread.id,
              lastMessage: extractText(m) || `[${m.type}]`,
              lastDirection: direction,
              lastAt: at,
            });
          }
        }
      }
    }
    // That later webhook: same message id, now with the media and its caption.
    // Only the content is written, so who it's from and when stay as they were.
    for (const m of value.messages || []) {
      if (!m.id || !m.type || m.type === "media_placeholder") continue;
      const media = extractMedia(m);
      writes.push({
        ref: db().collection("wa_messages").doc(m.id),
        data: {
          type: m.type,
          text: extractText(m),
          media,
          mediaSyncedAt: FieldValue.serverTimestamp(),
          ...(media ? { phoneNumberId, archivePending: true } : {}),
        },
        merge: true,
      });
    }
  }

  // Coexistence: address-book contacts synced from the Business app.
  if (field === "smb_app_state_sync") {
    for (const s of value.state_sync || []) {
      const phone = s.contact?.phone_number;
      if (!phone) continue;
      writes.push({
        ref: db().collection("wa_contacts").doc(`${phoneNumberId}_${phone}`),
        data: {
          ...base,
          phone,
          name: s.contact.full_name || s.contact.first_name || null,
          removed: s.action === "remove",
          updatedAt: FieldValue.serverTimestamp(),
        },
        merge: true,
      });
    }
  }

  return writes;
}

function messageWrites(base, m, { customer, customerName = null, direction, source, countUnread = true, withConversation = true }, chats) {
  const at = toDate(m.timestamp);
  const text = extractText(m);
  const convoId = `${base.phoneNumberId}_${customer}`;
  const sortKey = messageSortKey(convoId, at, m.id);

  // An edit or a delete changes the message it points at instead of adding a
  // new one. Kept as a hidden record too, so nothing is lost. An edit leaves
  // the original text in place: the new wording goes in editedText, and every
  // version in edits.
  const originalId = m.edit?.original_message_id || m.revoke?.original_message_id || null;
  if ((m.type === "edit" || m.type === "revoke") && originalId) {
    const editedMedia = m.type === "edit" ? extractMedia(m.edit.message || {}) : null;
    const change =
      m.type === "edit"
        ? {
            editedText: text,
            edited: true,
            editedAt: at,
            edits: FieldValue.arrayUnion({ text, at }),
            ...(editedMedia ? { media: editedMedia, phoneNumberId: base.phoneNumberId, archivePending: true } : {}),
          }
        : { revoked: true, revokedAt: at };
    return [
      { ref: db().collection("wa_messages").doc(originalId), data: change, merge: true },
      {
        ref: db().collection("wa_messages").doc(m.id),
        data: { ...base, id: m.id, conversationId: convoId, customer, direction, source, type: m.type, originalId, text, timestamp: at, sortKey, receivedAt: FieldValue.serverTimestamp() },
        merge: true,
      },
    ];
  }

  const media = extractMedia(m);
  const viewOnce = isViewOnce(m);
  const message = {
    ...base,
    id: m.id,
    conversationId: convoId,
    customer,
    direction,
    source,
    type: m.type,
    text,
    media,
    timestamp: at,
    sortKey,
    receivedAt: FieldValue.serverTimestamp(),
    ...(media ? { archivePending: true } : {}),
    ...(viewOnce ? { viewOnce: true } : {}),
    // What WhatsApp withheld (poll, view-once...), and why
    ...(m.type === "unsupported" ? { unsupportedType: m.unsupported?.type || null } : {}),
    ...(m.errors?.length
      ? { errors: m.errors.map((e) => ({ code: e.code ?? null, title: e.title || e.message || null, details: e.error_data?.details || null })) }
      : {}),
    // Types we don't read yet keep their content, so they can be shown later
    ...(!text && !KNOWN_TYPES.has(m.type) && m[m.type] ? { raw: JSON.stringify(m[m.type]).slice(0, 2000) } : {}),
  };

  if (withConversation) {
    chats.push({
      convoId,
      messageId: m.id,
      base,
      customer,
      customerName,
      direction,
      source,
      countUnread,
      at,
      lastMessage: text || (viewOnce ? "[view_once]" : `[${m.type}]`),
    });
  }
  return [{ ref: db().collection("wa_messages").doc(m.id), data: message, merge: true }];
}

// "unsupported" is left out so its details are kept in raw as well
const KNOWN_TYPES = new Set(["text", "image", "video", "audio", "voice", "document", "sticker", "location", "contacts", "reaction", "interactive", "button", "media_placeholder", "edit", "revoke"]);

// View-once photos and videos aren't among the types Cloud API delivers, so
// they arrive without content; flag anything that names them so the monitor
// can say what was sent.
function isViewOnce(m) {
  return (
    m.view_once === true ||
    m[m.type]?.view_once === true ||
    /view.?once/i.test(`${m.unsupported?.type || ""} ${JSON.stringify(m.errors || [])}`)
  );
}

function extractText(m) {
  switch (m.type) {
    case "text": return m.text?.body || "";
    case "image":
    case "video":
    case "document": return m[m.type]?.caption || m.document?.filename || "";
    case "button": return m.button?.text || "";
    case "interactive": {
      const i = m.interactive || {};
      return i.button_reply?.title || i.list_reply?.title || i.nfm_reply?.body || i.nfm_reply?.name || i.body?.text || "";
    }
    case "reaction": return m.reaction?.emoji || "";
    case "location": return m.location?.name || m.location?.address || `${m.location?.latitude},${m.location?.longitude}`;
    case "contacts":
      return (m.contacts || []).map((c) => [c.name?.formatted_name, c.phones?.[0]?.phone].filter(Boolean).join(" ")).join(", ");
    // The new content of an edited message
    case "edit": return m.edit?.message ? extractText(m.edit.message) : "";
    case "revoke": return "";
    default: {
      // Anything newer: use whatever text it carries
      const c = m[m.type] || {};
      return String(c.body || c.text || c.caption || c.title || c.name || "");
    }
  }
}

function extractMedia(m) {
  const media = m[m.type];
  if (!media?.id) return null;
  return { id: media.id, mimeType: media.mime_type || null, filename: media.filename || null };
}

function toDate(ts) {
  return ts ? new Date(Number(ts) * 1000) : new Date();
}

// Moves each chat up for its live messages, one transaction per message (after
// the messages themselves are saved). A chat's "last message" only moves
// forward, so a late, older message never replaces a newer one; and a message
// WhatsApp delivers twice is counted once, because inChat on the message
// records that it was. Messages of one chat run in order, chats in parallel.
async function applyChats(chats) {
  const byChat = new Map();
  for (const c of chats) byChat.set(c.convoId, [...(byChat.get(c.convoId) || []), c]);
  await eachLimit([...byChat.values()], 8, async (list) => {
    for (const c of list) await applyChat(c);
  });
}

async function applyChat(c) {
  const chatRef = db().collection("wa_conversations").doc(c.convoId);
  const msgRef = db().collection("wa_messages").doc(c.messageId);
  await db().runTransaction(async (tx) => {
    const [chat, msg] = await tx.getAll(chatRef, msgRef);
    if (msg.get("inChat")) return;
    const currentAt = chat.get("lastAt")?.toDate?.() || null;
    const newer = !currentAt || c.at >= currentAt;
    tx.set(
      chatRef,
      {
        ...c.base,
        customer: c.customer,
        updatedAt: FieldValue.serverTimestamp(),
        ...(c.customerName ? { customerName: c.customerName } : {}),
        // A brand-new chat: all of its messages carry a sortKey
        ...(chat.exists ? {} : { sortKeys: true }),
        ...(newer
          ? {
              lastMessage: c.lastMessage,
              lastDirection: c.direction,
              lastAt: c.at,
              numberSortKey: numberSortKey(c.base.phoneNumberId, c.at, c.convoId),
              ...(c.direction === "in" && c.countUnread ? { unread: FieldValue.increment(1) } : {}),
              ...(c.direction === "out" && c.source !== "history" ? { unread: 0, lastReplyAt: c.at } : {}),
            }
          : {}),
      },
      { merge: true }
    );
    tx.set(msgRef, { inChat: true }, { merge: true });
  });
}

// Creates conversations that only exist in history, and moves an existing one's
// "last message" only when the history message is newer than what it has.
// Several chats at a time, so large imports finish before the function times out.
async function applyHistory({ latest, numbers }) {
  await eachLimit([...latest], 10, async ([convoId, last]) => {
    const ref = db().collection("wa_conversations").doc(convoId);
    await db().runTransaction(async (tx) => {
      const current = await tx.get(ref);
      const currentAt = current.get("lastAt")?.toDate?.() || null;
      if (currentAt && currentAt >= last.lastAt) return;
      tx.set(
        ref,
        {
          ...last,
          numberSortKey: numberSortKey(last.phoneNumberId, last.lastAt, convoId),
          ...(current.exists ? {} : { sortKeys: true }),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
  });
  await Promise.all(
    [...numbers].map(([phoneId, status]) =>
      db().collection("wa_numbers").doc(phoneId).set(
        { historySync: status, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      )
    )
  );
}

// Firestore batches cap at 500 ops; history sync can be large.
async function commit(writes) {
  for (let i = 0; i < writes.length; i += 450) {
    const batch = db().batch();
    for (const w of writes.slice(i, i + 450)) batch.set(w.ref, w.data, { merge: w.merge });
    await batch.commit();
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
