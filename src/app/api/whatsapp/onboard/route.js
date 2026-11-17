// WhatsApp Coexistence onboarding (Next.js route handler).
//
// POST -> Called by the admin panel to start monitoring an employee's WhatsApp
//         Business app number. Subscribes this app to the number's WABA so
//         /api/whatsapp/webhook starts receiving its chats. Two ways in:
//
//   { code, ... }  The number was just linked through our own Embedded Signup
//                  (needs Tech Provider approval). Exchanges the one-time code
//                  for a business token and asks Meta to sync contacts + history.
//   { wabaId }     The number was linked through a partner such as Make.com.
//                  Uses the system-user token; the partner owns the history sync.
//
// The number is never registered here: it stays registered to the Business app
// on the employee's phone, which is what keeps Coexistence working.
//
// Required Vercel environment variables:
//   NEXT_PUBLIC_WHATSAPP_APP_ID        - Meta App ID (also used by the browser SDK)
//   WHATSAPP_APP_SECRET         - Meta App Settings > Basic > App Secret
//   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY - the CRM's admin credentials
//   WHATSAPP_ACCESS_TOKEN       - system-user token (only for the { wabaId } route)

import { FieldValue } from "@/lib/db/firestore";
import { db, json, requireAdmin } from "@/lib/whatsapp/server/admin.js";

const GRAPH = "https://graph.facebook.com/v25.0";

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (!admin) return json(403, { error: "Admins only." });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Bad JSON" });
  }
  const { code, wabaId, phoneNumberId, businessId, label } = body;
  if (!code && !wabaId) return json(400, { error: "Missing code or WhatsApp account ID" });

  try {
    let token;
    let wabaIds;
    if (code) {
      const appId = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID;
      const appSecret = process.env.WHATSAPP_APP_SECRET;
      if (!appId || !appSecret) return json(500, { error: "WhatsApp app credentials are not configured." });

      // The code is single-use and expires ~30 seconds after signup finishes.
      ({ access_token: token } = await graph("oauth/access_token", {
        query: { client_id: appId, client_secret: appSecret, code },
      }));
      wabaIds = wabaId ? [String(wabaId)] : await sharedWabaIds(token, `${appId}|${appSecret}`);
      if (!wabaIds.length) return json(400, { error: "Meta did not share a WhatsApp Business account." });
    } else {
      token = process.env.WHATSAPP_ACCESS_TOKEN;
      if (!token) return json(500, { error: "WHATSAPP_ACCESS_TOKEN is not configured in Vercel." });
      wabaIds = [String(wabaId).trim()];
    }

    const numbers = [];
    for (const id of wabaIds) {
      if (code) {
        // Saved first so a later failure never loses the token. wa_secrets has no
        // Firestore rule, so it is readable by the Admin SDK only.
        await db().collection("wa_secrets").doc(id).set(
          { accessToken: token, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
      }
      await graph(`${id}/subscribed_apps`, { token, method: "POST" });

      const { data: phones = [] } = await graph(`${id}/phone_numbers`, {
        token,
        query: { fields: "id,display_phone_number,verified_name" },
      });
      for (const p of phones) {
        if (phoneNumberId && p.id !== String(phoneNumberId)) continue;
        numbers.push(
          await connectNumber(p, { wabaId: id, businessId, label, token, admin, requestSync: Boolean(code) })
        );
      }
    }

    return json(200, { numbers });
  } catch (err) {
    console.error("whatsapp-onboard error", err);
    return json(502, { error: err.message });
  }
}

async function connectNumber(phone, { wabaId, businessId, label, token, admin, requestSync }) {
  const ref = db().collection("wa_numbers").doc(phone.id);
  const existing = (await ref.get()).data() || {};

  // Meta allows each sync to be requested once, within 24h of onboarding, by the
  // app that onboarded the number.
  const sync = async (type, previous) => {
    if (previous === "requested") return previous;
    if (!requestSync) return previous || "handled by Make.com";
    try {
      await graph(`${phone.id}/smb_app_data`, {
        token,
        method: "POST",
        body: { messaging_product: "whatsapp", sync_type: type },
      });
      return "requested";
    } catch (err) {
      return `failed: ${err.message}`;
    }
  };
  const contactsSync = await sync("smb_app_state_sync", existing.contactsSync);
  const historySync = await sync("history", existing.historySync);

  const data = {
    phoneNumberId: phone.id,
    wabaId,
    businessId: businessId || existing.businessId || null,
    displayNumber: phone.display_phone_number || null,
    verifiedName: phone.verified_name || null,
    label: String(label || "").trim() || existing.label || null,
    contactsSync,
    historySync,
    connectedBy: admin.email || admin.uid,
    connectedAt: existing.connectedAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.set(data, { merge: true });

  return {
    phoneNumberId: phone.id,
    displayNumber: data.displayNumber,
    label: data.label,
    contactsSync,
    historySync,
  };
}

// Fallback when the browser never received the signup session event: read the
// WABA ids the token was granted from its granular scopes.
async function sharedWabaIds(token, appToken) {
  const { data } = await graph("debug_token", { query: { input_token: token, access_token: appToken } });
  const scope = (data?.granular_scopes || []).find((s) => s.scope === "whatsapp_business_management");
  return scope?.target_ids || [];
}

async function graph(path, { token, method = "GET", query, body } = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error?.error_user_msg || data.error?.message || `Graph API ${res.status} on ${path}`);
  }
  return data;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
