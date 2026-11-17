import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { clientDb as db } from "@/lib/db/client";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { firebaseConfig } from "./config";

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

const auth = getAuth(app);

/**
 * Firebase is **sign-in only** now. The data lives in Neon Postgres and the
 * browser reads it through `/api/db` (`lib/db/client`); `db` is that client's
 * handle, kept under the same name so every `collection(db, …)` keeps working.
 */
const functions = getFunctions(app);
const storage = getStorage(app);

// Use emulators in development if true
const USE_EMULATORS = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";

if (USE_EMULATORS && typeof window !== "undefined") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}

export { app, auth, db, functions, storage };
