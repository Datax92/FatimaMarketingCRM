// Shared helpers for the admin-only WhatsApp endpoints, on the CRM's Firebase Admin app.

import { getAdminDb } from "@/lib/firebase/server";
import { requireAdmin as requireAdminToken } from "@/lib/firebase/serverAuth";

export function db() {
  return getAdminDb();
}

export const json = (status, data) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

// Runs fn over items, `limit` at a time.
export async function eachLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// A running instance serves many requests in a row (photo-link batches especially), so an
// admin it has just verified is remembered for a few minutes.
const ADMIN_CACHE_MS = 5 * 60 * 1000;
const verifiedAdmins = new Map(); // ID token -> { admin, until }

// The CRM's own gate: an active admin. WhatsApp monitoring is admin only.
export async function requireAdmin(request) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const known = verifiedAdmins.get(token);
  if (known && known.until > Date.now()) return known.admin;
  try {
    const auth = await requireAdminToken(token);
    const admin = { uid: auth.uid, email: auth.email || null };
    if (verifiedAdmins.size >= 200) verifiedAdmins.delete(verifiedAdmins.keys().next().value);
    verifiedAdmins.set(token, { admin, until: Date.now() + ADMIN_CACHE_MS });
    return admin;
  } catch {
    return null;
  }
}

// WhatsApp token for a phone number: the business token saved at Meta signup
// (wa_secrets/{wabaId}), else the system-user token (numbers linked via a partner).
export async function tokenFor(phoneId) {
  if (/^\d+$/.test(phoneId || "")) {
    const number = (await db().collection("wa_numbers").doc(phoneId).get()).data();
    if (number?.wabaId) {
      const secret = (await db().collection("wa_secrets").doc(String(number.wabaId)).get()).data();
      if (secret?.accessToken) return secret.accessToken;
    }
  }
  return process.env.WHATSAPP_ACCESS_TOKEN || null;
}
