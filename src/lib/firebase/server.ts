import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "@/lib/db/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";

const EMULATED = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);

function getAdminApp(): App {
  const existing = getApps();
  if (existing.length > 0) {
    return existing[0];
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (privateKey) {
    privateKey = privateKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');
  }

  if (clientEmail && privateKey) {
    return initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  // **No service account.** Falling through to Application Default
  // Credentials, which exist on Cloud Run / App Engine / a machine with
  // `gcloud auth application-default login`, and nowhere else — not on Vercel,
  // and not on a plain dev box.
  //
  // Said out loud at startup because of how this fails otherwise: the browser
  // keeps reading Firestore perfectly (it uses the `NEXT_PUBLIC_*` config and
  // the user's own token) while every Server Action spends ~3 seconds probing
  // the metadata server and then fails. That reads as one broken screen on a
  // slow network, and it is neither.
  if (!EMULATED) {
    console.warn(
      '[firebase-admin] FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are not set — ' +
        'falling back to Application Default Credentials. If this is a local machine ' +
        'or Vercel, every Server Action will fail until they are set in .env.local ' +
        '(Firebase console → Project settings → Service accounts → Generate new private key).'
    );
  }

  return initializeApp({
    projectId,
  });
}

/**
 * **The database is Neon Postgres** (`lib/db/firestore`), behind the same
 * document API the server code was written against. Firebase is used for
 * **Auth only** — `getAdminAuth` below — so the service account is needed to
 * verify ID tokens and set custom claims, never to read or write data.
 */
let firestore: Firestore | null = null;

export function getAdminDb(): Firestore {
  if (!firestore) firestore = getFirestore();
  return firestore;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export const adminDb: Firestore = new Proxy({} as Firestore, {
  get(_target, prop) {
    const db = getAdminDb();
    const val = (db as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === "function" ? val.bind(db) : val;
  },
});

export const adminAuth: Auth = new Proxy({} as Auth, {
  get(_target, prop) {
    const auth = getAdminAuth();
    const val = (auth as unknown as Record<string | symbol, unknown>)[prop];
    return typeof val === "function" ? val.bind(auth) : val;
  },
});
