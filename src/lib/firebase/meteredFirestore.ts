'use client';

/**
 * Formerly the Firestore read meter and the 2026-09 "quiet hours" switch.
 *
 * The data now lives in Neon Postgres, which bills neither reads nor writes
 * per document, so there is nothing to meter and nothing to ration. The
 * exports stay, under the same names, so the hooks that import them need no
 * change: the reads go straight to `lib/db/client`.
 */

import type { Query, DocumentData, Unsubscribe, QuerySnapshot } from '@/lib/db/client';
import { onSnapshot } from '@/lib/db/client';

export { onSnapshot, getDocs, getDoc, getCountFromServer } from '@/lib/db/client';

export function inQuietHours(): boolean {
  return false;
}

export function setQuietHoursExempt(isFinanceRole: boolean): void {
  void isFinanceRole;
}

export function withLive<R>(open: () => R): R {
  return open();
}

export function onSnapshotLive<T = DocumentData>(
  query: Query<T>,
  onNext: (snapshot: QuerySnapshot<T>) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(query, onNext, onError);
}
