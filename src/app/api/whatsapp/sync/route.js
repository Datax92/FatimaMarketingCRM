// WhatsApp Coexistence history + contacts sync (Next.js route handler).
//
// POST { phoneNumberId, request }
//   Admin-only. Always reports which webhook fields this app is subscribed to,
//   because history and contacts only reach /api/whatsapp/webhook if the
//   `history` and `smb_app_state_sync` fields are on.
//   With request: true it also asks Meta to send the number's chat history
//   (up to ~6 months) and its saved contacts. Meta accepts each request once,
//   within 24 hours of the number being linked, and only if the employee chose
//   to share history when scanning the QR code.

import { FieldValue } from "firebase-admin/firestore";
import { db, json, requireAdmin, tokenFor } from "@/lib/whatsapp/server/admin.js";

const GRAPH = "https://graph.facebook.com/v25.0";
// The Meta App ID (public).
const APP_ID = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID;
const NEEDED_FIELDS = ["messages", "smb_message_echoes", "history", "smb_app_state_sync"];

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (!admin) return json(403, { error: "Admins only." });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Bad JSON" });
  }
  const phoneId = String(body.phoneNumberId || "");

  const webhook = await webhookFields();
  const result = { webhook };
  if (!body.request) return json(200, result);
  if (!/^\d+$/.test(phoneId)) return json(400, { error: "Missing phoneNumberId", ...result });

  const token = await tokenFor(phoneId);
  if (!token) return json(500, { error: "WHATSAPP_ACCESS_TOKEN is not configured in Vercel.", ...result });

  const request_ = async (type) => {
    const res = await fetch(`${GRAPH}/${phoneId}/smb_app_data`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", sync_type: type }),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && !data.error
      ? "requested"
      : `failed: ${data.error?.error_user_msg || data.error?.message || res.status}`;
  };

  result.contactsSync = await request_("smb_app_state_sync");
  result.historySync = await request_("history");

  await db().collection("wa_numbers").doc(phoneId).set(
    {
      contactsSync: result.contactsSync,
      historySync: result.historySync,
      syncRequestedAt: FieldValue.serverTimestamp(),
      syncRequestedBy: admin.email || admin.uid,
    },
    { merge: true }
  );
  return json(200, result);
}

async function webhookFields() {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return { error: "WHATSAPP_APP_SECRET is not configured." };
  if (!APP_ID) return { error: "NEXT_PUBLIC_WHATSAPP_APP_ID is not configured." };
  try {
    const url = new URL(`${GRAPH}/${APP_ID}/subscriptions`);
    url.searchParams.set("access_token", `${APP_ID}|${secret}`);
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) return { error: data.error?.message || `HTTP ${res.status}` };
    const waba = (data.data || []).find((s) => s.object === "whatsapp_business_account");
    const fields = (waba?.fields || []).map((f) => f.name);
    return {
      active: Boolean(waba?.active),
      callbackUrl: waba?.callback_url || null,
      fields,
      missing: NEEDED_FIELDS.filter((f) => !fields.includes(f)),
    };
  } catch (err) {
    return { error: err.message };
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
