import { getDeviceId, getDeviceName } from './device';
import { deviceStore } from './storage';

/**
 * Single-writer designation (docs/PLAN.md §5 Phase 4).
 *
 * Whole-file snapshot sync is last-write-wins, so two devices editing between
 * syncs means one side's work is destroyed silently. Rather than pretend
 * otherwise, exactly one device is the writer; the others are read-only until
 * the user promotes them.
 *
 * Enforcement is a single choke point rather than a banner: every ledger
 * mutation in `lib/actions` goes through `db.transaction()`, so
 * `lib/db/session.ts` wraps that one method with `assertWritable()`. Reads use
 * `db.query` and stay available. `getDashboardAnalytics`'s daily snapshot
 * insert and the `apikey:` settings writes also use `db.query`, which is
 * correct — both are device-local and neither belongs to another device.
 */
const WRITER_KEY = 'foliodude:sync-writer';

export interface WriterInfo {
  deviceId: string;
  deviceName: string;
}

/** Cached so `assertWritable()` can answer synchronously inside a query path. */
let cached: WriterInfo | null | undefined;

function read(): WriterInfo | null {
  if (cached !== undefined) return cached;

  const raw = deviceStore()?.getItem(WRITER_KEY);
  cached = raw ? (JSON.parse(raw) as WriterInfo) : null;
  return cached;
}

function write(info: WriterInfo | null): void {
  cached = info;
  const store = deviceStore();

  if (info) {
    store?.setItem(WRITER_KEY, JSON.stringify(info));
  } else {
    store?.removeItem(WRITER_KEY);
  }
}

/** The designated writer, or `null` when this device has never seen a snapshot. */
export function getWriter(): WriterInfo | null {
  return read();
}

/**
 * Fails open: a device that has never synced is writable.
 *
 * That is the offline-first case and by far the common one — a signed-out user
 * must have a fully working app (docs/PLAN.md §1). Read-only is only ever entered
 * after actually observing a snapshot written by a different device.
 */
export function isWritable(): boolean {
  const writer = read();
  return writer === null || writer.deviceId === getDeviceId();
}

export function assertWritable(): void {
  const writer = read();

  if (writer && writer.deviceId !== getDeviceId()) {
    throw new Error(
      `This device is read-only. "${writer.deviceName}" is the sync writer — promote this device in Sync to make changes here.`,
    );
  }
}

/** Record the writer named by a snapshot just downloaded from Drive. */
export function observeWriter(info: WriterInfo): void {
  write(info);
}

/** Make this device the writer. The next upload stamps it into the snapshot. */
export function claimWriter(): WriterInfo {
  const info = { deviceId: getDeviceId(), deviceName: getDeviceName() };
  write(info);
  return info;
}

/** Forget the designation — signing out returns this device to standalone. */
export function clearWriter(): void {
  write(null);
}
