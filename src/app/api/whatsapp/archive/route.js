// Background upkeep for the WhatsApp monitor (Next.js route handler).
//
// GET  -> Vercel Cron, once a day (vercel.json). Needs CRON_SECRET in Vercel,
//         which Vercel sends as the Authorization header.
// POST -> Admins. The monitor calls it when it opens, and again while it
//         reports more work left.
//
// 1. Media: saves photos, voice notes, videos and documents that have no copy
//    in Firebase Storage yet. Retries every message still marked
//    archivePending (the webhook's own save failed); until one pass has
//    finished, also goes through everything received in the last 8 days,
//    which covers media from before saving existed. Meta deletes media 7 days
//    after the webhook, so nothing older can be fetched.
// 2. Sort keys: gives chats from before paging existed the keys the monitor
//    pages with (lib/whatsapp/server/keys.js), then marks them sortKeys. Until a chat is
//    marked, the monitor loads it the old way, all at once.
//
// Runs at most once every 5 minutes (each run stops before 4 minutes).

import { FieldValue } from "firebase-admin/firestore";
import { getDeadline } from "@/lib/whatsapp/server/runtime.js";
import { db, eachLimit, json, requireAdmin } from "@/lib/whatsapp/server/admin.js";
import { messageSortKey, numberSortKey } from "@/lib/whatsapp/server/keys.js";
import { archiveAll, bucket, timeLeft } from "@/lib/whatsapp/server/media.js";

const DAY = 86400000;
const BUDGET_MS = 230000;
const MIN_GAP_MS = 5 * 60 * 1000;

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return json(401, { error: "Unauthorized" });
  }
  return json(200, await sweep());
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (!admin) return json(403, { error: "Admins only." });
  return json(200, await sweep());
}

async function sweep() {
  const deadline = Math.min(Date.now() + BUDGET_MS, timeLeft(getDeadline(300)));
  const stateRef = db().collection("wa_meta").doc("archive");

  const state = await db().runTransaction(async (tx) => {
    const current = (await tx.get(stateRef)).data() || {};
    const last = current.startedAt?.toDate?.();
    if (last && Date.now() - last.getTime() < MIN_GAP_MS) return null;
    tx.set(stateRef, { startedAt: FieldValue.serverTimestamp() }, { merge: true });
    return current;
  });
  if (!state) return { skipped: "Ran in the last 5 minutes." };

  const media = await saveMedia(state, deadline).catch((err) => {
    console.error("whatsapp-archive media error", err);
    return { error: err.message };
  });
  const chats = await addSortKeys(state, deadline).catch((err) => {
    console.error("whatsapp-archive sort keys error", err);
    return { error: err.message, left: 1 };
  });

  await stateRef
    .set(
      {
        lastResult: { media, chats },
        lastError: media.error || chats.error || FieldValue.delete(),
        finishedAt: FieldValue.serverTimestamp(),
        // Finished without running out of time: no more need to scan by date
        ...(media.backfill && !media.left && !media.error ? { backfilledAt: FieldValue.serverTimestamp() } : {}),
        ...(!chats.left && !chats.error ? { keysDoneAt: FieldValue.serverTimestamp() } : {}),
      },
      { merge: true }
    )
    .catch(() => {});

  return { media, chats, more: Boolean(media.left || chats.left), ...(media.error ? { error: media.error } : {}) };
}

async function saveMedia(state, deadline) {
  // An error here (e.g. no permission to look the bucket up) isn't a missing
  // bucket; the saves themselves will report any real problem
  const [exists] = await bucket().exists().catch(() => [true]);
  if (!exists) {
    return {
      error: `Firebase Storage bucket "${bucket().name}" doesn't exist. Switch on Storage in the Firebase console (or set FIREBASE_STORAGE_BUCKET).`,
    };
  }

  const docs = [];
  const pending = await db().collection("wa_messages").where("archivePending", "==", true).limit(500).get();
  docs.push(...pending.docs);
  const backfill = !state.backfilledAt;
  if (backfill) {
    const recent = await db().collection("wa_messages").where("receivedAt", ">=", new Date(Date.now() - 8 * DAY)).get();
    docs.push(...recent.docs);
  }

  const jobs = new Map();
  for (const d of docs) {
    const m = d.data();
    if (!m.media?.id || m.archive?.mediaId === m.media.id || m.archiveError === "gone") continue;
    jobs.set(d.id, { messageId: d.id, mediaId: m.media.id, phoneId: m.phoneNumberId });
  }

  const result = await archiveAll([...jobs.values()], { deadline });
  return { ...result, checked: jobs.size, backfill };
}

async function addSortKeys(state, deadline) {
  if (state.keysDoneAt) return { left: 0 };

  const chats = await db()
    .collection("wa_conversations")
    .select("phoneNumberId", "lastAt", "numberSortKey", "sortKeys")
    .get();
  const todo = chats.docs.filter((c) => !c.get("sortKeys"));
  let done = 0;

  await eachLimit(todo, 4, async (chat) => {
    if (Date.now() >= deadline) return;

    // Every message of the chat gets its key; a chat with a failed write
    // stays unmarked and is tried again next run
    const messages = await db().collection("wa_messages").where("conversationId", "==", chat.id).select("timestamp", "sortKey").get();
    const writer = db().bulkWriter();
    const writes = [];
    for (const m of messages.docs) {
      const at = m.get("timestamp")?.toDate?.();
      if (m.get("sortKey") || !at) continue;
      writes.push(writer.set(m.ref, { sortKey: messageSortKey(chat.id, at, m.id) }, { merge: true }).then(() => true, () => false));
    }
    await writer.close();
    if ((await Promise.all(writes)).includes(false)) return;

    // Read again in a transaction, so a message arriving meanwhile keeps its
    // newer numberSortKey
    await db().runTransaction(async (tx) => {
      const fresh = await tx.get(chat.ref);
      const lastAt = fresh.get("lastAt")?.toDate?.();
      const phoneId = fresh.get("phoneNumberId");
      tx.set(
        chat.ref,
        { sortKeys: true, ...(!fresh.get("numberSortKey") && lastAt && phoneId ? { numberSortKey: numberSortKey(phoneId, lastAt, chat.id) } : {}) },
        { merge: true }
      );
    });
    done += 1;
  });

  return { indexed: done, left: todo.length - done };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
