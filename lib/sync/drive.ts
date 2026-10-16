import { getAccessToken } from '@/lib/auth/google';

/**
 * Google Drive `appDataFolder` access, called directly from the client.
 *
 * No upload server and no storage bucket to provision (docs/PLAN.md §5 Phase 4) —
 * the file lives in the user's own Drive, in a folder Drive's normal UI does
 * not show, and only this app's OAuth client can reach it.
 *
 * The snapshot is **not encrypted**: a deliberate scope cut recorded as risk #9.
 * It is bookkeeping data sitting in the user's own Google account, under the
 * same trust boundary as their Gmail already is.
 */
const FILE_NAME = 'foliodude-snapshot.json';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export interface DriveFile {
  id: string;
  modifiedTime: string;
}

async function authorized(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Drive request failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  return response;
}

/** The snapshot file, or `null` when this account has never synced. */
export async function findSnapshotFile(): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name = '${FILE_NAME}' and trashed = false`,
    fields: 'files(id,modifiedTime)',
    pageSize: '1',
  });

  const response = await authorized(`${DRIVE_FILES}?${params.toString()}`);
  const payload = (await response.json()) as { files?: DriveFile[] };
  return payload.files?.[0] ?? null;
}

export async function downloadSnapshot<T>(fileId: string): Promise<T> {
  const response = await authorized(`${DRIVE_FILES}/${fileId}?alt=media`);
  return (await response.json()) as T;
}

/**
 * Write the snapshot, creating the file on first sync and overwriting after.
 *
 * Overwriting is the model, not an oversight: this is whole-file last-write-wins
 * sync, which is exactly why the single-writer rule exists.
 */
export async function uploadSnapshot(snapshot: unknown, existing: DriveFile | null): Promise<void> {
  const body = JSON.stringify(snapshot);

  if (existing) {
    await authorized(`${DRIVE_UPLOAD}/${existing.id}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return;
  }

  // Creating the file needs metadata (name + parent) alongside the content, so
  // the first write is multipart while every later one is a plain media PATCH.
  const boundary = `foliodude-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] });

  await authorized(`${DRIVE_UPLOAD}?uploadType=multipart`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body:
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n` +
      `--${boundary}--`,
  });
}
