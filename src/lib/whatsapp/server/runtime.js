// Stand-ins for @vercel/functions on Next.js route handlers.
import { after } from "next/server";

/** Work that continues after the response has been sent. */
export function waitUntil(promise) {
  after(() => promise);
}

/** When this invocation will be stopped; routes declare maxDuration in seconds. */
export function getDeadline(maxDurationSeconds = 60) {
  return new Date(Date.now() + maxDurationSeconds * 1000);
}
