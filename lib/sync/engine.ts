import { isSignedIn } from '@/lib/auth/google';
import { getDb } from '@/lib/db/client';
import { buildSnapshot, restoreSnapshot, type Snapshot } from '@/lib/db/backup';
import { revalidate, subscribe } from '@/lib/data/store';
import { getDeviceId, getDeviceName } from './device';
import { downloadSnapshot, findSnapshotFile, uploadSnapshot } from './drive';
import { claimWriter, clearWriter, getWriter, isWritable, observeWriter } from './writer';

/**
 * Snapshot sync against the user's own Google Drive.
 *
 * Whole-file, last-write-wins, single-writer — see docs/PLAN.md §5 Phase 4 for why
 * per-row change-log sync is out of scope. The engine never merges: it either
 * uploads this device's ledger or replaces it with the remote one, and the
 * writer designation is what makes that safe.
 */

export type SyncStatus =
  | { state: 'signed-out' }
  | { state: 'idle'; lastSyncedAt: number | null }
  | { state: 'syncing' }
  /** This device holds data the remote writer's snapshot would destroy. */
  | { state: 'blocked'; writerName: string }
  | { state: 'error'; message: string };

let status: SyncStatus = { state: 'signed-out' };
const listeners = new Set<() => void>();

function setStatus(next: SyncStatus): void {
  status = next;
  for (const listener of listeners) listener();
}

export function getStatus(): SyncStatus {
  return status;
}

export function subscribeStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let lastSyncedAt: number | null = null;
/** Guards against a push racing a pull, and against a restore re-entering. */
let running: Promise<void> | null = null;

async function pushLocal(): Promise<void> {
  const db = await getDb();

  const snapshot = await buildSnapshot(db, {
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
  });

  await uploadSnapshot(snapshot, await findSnapshotFile());
}

/** Does this device hold a ledger of its own? Settings alone do not count. */
async function hasLocalLedger(): Promise<boolean> {
  const db = await getDb();
  const result = await db.query<{ present: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM accounts) OR EXISTS (SELECT 1 FROM transactions) AS present`,
  );
  return result.rows[0]!.present;
}

async function pullRemote(snapshot: Snapshot): Promise<void> {
  const db = await getDb();

  // The raw handle, not `getSessionContext()`'s guarded one — restoring is the
  // one write a read-only device must be able to perform. See lib/db/session.ts.
  await restoreSnapshot(db, snapshot);
  revalidate();
}

/**
 * Reconcile this device with Drive.
 *
 * - No remote snapshot → this device becomes the writer and uploads.
 * - Remote written by this device → upload local changes over it.
 * - Remote written by another device → this device is read-only; adopt the
 *   remote ledger wholesale.
 */
export async function syncNow(options: { adoptRemote?: boolean } = {}): Promise<void> {
  if (!isSignedIn()) {
    setStatus({ state: 'signed-out' });
    return;
  }

  if (running) return running;

  running = (async () => {
    setStatus({ state: 'syncing' });

    try {
      const file = await findSnapshotFile();

      if (!file) {
        claimWriter();
        await pushLocal();
      } else {
        const remote = await downloadSnapshot<Snapshot>(file.id);
        observeWriter({
          deviceId: remote.writerDeviceId,
          deviceName: remote.writerDeviceName,
        });

        if (isWritable()) {
          await pushLocal();
        } else if (!options.adoptRemote && (await hasLocalLedger())) {
          // Adopting the remote snapshot overwrites this device's ledger. When
          // there is one to lose — a second device signing in for the first
          // time, say — that is not a decision to make silently on the user's
          // behalf. Stop and make them pick a direction.
          setStatus({ state: 'blocked', writerName: remote.writerDeviceName });
          return;
        } else {
          await pullRemote(remote);
        }
      }

      lastSyncedAt = Date.now();
      setStatus({ state: 'idle', lastSyncedAt });
    } catch (error) {
      setStatus({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      running = null;
    }
  })();

  return running;
}

/**
 * Take over as writer and overwrite the remote snapshot with this device's
 * ledger. Destructive to the other device's unsynced work, which is inherent to
 * the model — the UI states this before calling.
 */
export async function promoteThisDevice(): Promise<void> {
  claimWriter();
  await syncNow();
}

/**
 * Accept the writer's snapshot, discarding this device's ledger. The other half
 * of the `blocked` decision, and equally destructive in the other direction.
 */
export async function adoptRemote(): Promise<void> {
  await syncNow({ adoptRemote: true });
}

export function forgetSync(): void {
  clearWriter();
  lastSyncedAt = null;
  setStatus({ state: 'signed-out' });
}

const DEBOUNCE_MS = 4000;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/**
 * Upload after local writes settle.
 *
 * Debounced because `revalidate()` fires once per mutation and a burst of edits
 * would otherwise mean a burst of full-snapshot uploads. Read-only devices
 * never push — that is the single-writer rule, enforced a second time here so a
 * bug in the DB guard cannot reach Drive.
 */
export function startAutoSync(): void {
  if (started) return;
  started = true;

  subscribe(() => {
    if (!isSignedIn() || !isWritable()) return;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void syncNow();
    }, DEBOUNCE_MS);
  });

  if (isSignedIn()) {
    setStatus({ state: 'idle', lastSyncedAt: null });
    void syncNow();
  }
}

export { getWriter, isWritable };
