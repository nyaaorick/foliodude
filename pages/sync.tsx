import { useState, useSyncExternalStore } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';

import { isAuthConfigured, isExtension } from '@/lib/auth/config';
import { isSignedIn, signIn, signOut } from '@/lib/auth/google';
import {
  adoptRemote,
  forgetSync,
  getStatus,
  getWriter,
  isWritable,
  promoteThisDevice,
  subscribeStatus,
  syncNow,
} from '@/lib/sync/engine';
import { getDeviceName, setDeviceName } from '@/lib/sync/device';
import { Page, PageHeader } from '@/components/app/page-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border/70 bg-card/80 p-4 md:p-6">
      {children}
    </section>
  );
}

function formatTime(value: number | null) {
  if (!value) return 'not yet';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(value);
}

export default function SyncPage() {
  const status = useSyncExternalStore(subscribeStatus, getStatus, getStatus);
  const [signedIn, setSignedIn] = useState(() => isSignedIn());
  const [deviceName, setLocalDeviceName] = useState(() => getDeviceName());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const writer = getWriter();
  const writable = isWritable();

  const run = async (action: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
      setSignedIn(isSignedIn());
    }
  };

  if (!isAuthConfigured()) {
    return (
      <Page>
        <PageHeader eyebrow="Sync" title="Google Drive sync" />
        <Panel>
          <div className="flex items-start gap-3">
            <CloudOff className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Sign-in is not configured in this build.</p>
              <p>
                This build has no Google OAuth client id, so sync is unavailable. Everything
                else works — your data lives in the local database on this device.
              </p>
              <p>
                To enable it, set{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  {isExtension() ? 'VITE_GOOGLE_CLIENT_ID_EXTENSION' : 'VITE_GOOGLE_CLIENT_ID_WEB'}
                </code>{' '}
                at build time. See <code className="text-xs">lib/auth/config.ts</code> for which
                Google client type each target needs.
              </p>
            </div>
          </div>
        </Panel>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Sync"
        title="Google Drive sync"
        description="A snapshot of your ledger, stored in your own Google Drive. Nothing passes through a server of ours."
      />

      {!signedIn ? (
        <Panel>
          <p className="text-sm text-muted-foreground">
            Sign in to back this device up to Google Drive. The app asks only for access to its
            own hidden app-data folder — it cannot see the rest of your Drive.
          </p>
          <Button
            className="w-full md:w-auto"
            size="lg"
            disabled={busy}
            onClick={() => void run(async () => { await signIn(); await syncNow(); })}
          >
            Continue with Google
          </Button>
        </Panel>
      ) : (
        <>
          <Panel>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {status.state === 'syncing'
                    ? 'Syncing…'
                    : status.state === 'error'
                      ? 'Sync failed'
                      : status.state === 'blocked'
                        ? 'Sync paused'
                        : 'Signed in'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {status.state === 'idle' && `Last synced ${formatTime(status.lastSyncedAt)}`}
                  {status.state === 'error' && status.message}
                  {status.state === 'syncing' && 'Talking to Google Drive'}
                  {status.state === 'blocked' && 'Waiting for you to choose a direction'}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={busy || status.state === 'syncing'}
                onClick={() => void run(syncNow)}
              >
                <RefreshCw className={status.state === 'syncing' ? 'animate-spin' : ''} />
                Sync now
              </Button>
            </div>
          </Panel>

          {status.state === 'blocked' && (
            <Panel>
              <div>
                <h2 className="text-base font-medium tracking-tight">
                  Two devices have data
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{status.writerName}</span> already
                  has a snapshot in Drive, and this device has its own accounts and transactions.
                  Sync replaces rather than merges, so one of them has to win — and this is the
                  one choice the app will not make for you.
                </p>
              </div>
              <div className="flex flex-col gap-2 md:flex-row">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(promoteThisDevice)}
                >
                  Keep this device's data
                </Button>
                <Button variant="destructive" disabled={busy} onClick={() => void run(adoptRemote)}>
                  Replace with {status.writerName}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Whichever you pick, the other device's unsynced data is discarded.
              </p>
            </Panel>
          )}

          <Panel>
            <div>
              <h2 className="text-base font-medium tracking-tight">Writer</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sync replaces the whole snapshot rather than merging it, so exactly one device
                may make changes. The others follow along read-only.
              </p>
            </div>

            {writable ? (
              <p className="rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5 text-sm">
                <span className="font-medium">This device</span> is the writer
                {writer ? '' : ' (nothing synced yet)'}.
              </p>
            ) : (
              <>
                <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
                  <span className="font-medium">{writer?.deviceName}</span> is the writer. This
                  device is read-only — edits here are blocked, and syncing replaces its data
                  with that device's.
                </p>
                <Button
                  variant="outline"
                  className="w-full md:w-auto"
                  disabled={busy}
                  onClick={() => void run(promoteThisDevice)}
                >
                  Make this device the writer
                </Button>
                <p className="text-xs text-muted-foreground">
                  This overwrites the snapshot in Drive with this device's data. Anything the
                  other device has not yet synced is lost.
                </p>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="device-name">This device's name</Label>
              <div className="flex gap-2">
                <Input
                  id="device-name"
                  value={deviceName}
                  onChange={(event) => setLocalDeviceName(event.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeviceName(deviceName);
                    setLocalDeviceName(getDeviceName());
                  }}
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Shown on your other devices when this one holds the writer role.
              </p>
            </div>
          </Panel>

          <Panel>
            <Button
              variant="destructive"
              className="w-full md:w-auto"
              disabled={busy}
              onClick={() => void run(async () => { await signOut(); forgetSync(); })}
            >
              Sign out
            </Button>
            <p className="text-xs text-muted-foreground">
              Your ledger stays on this device. Signing out only stops syncing it to Drive.
            </p>
          </Panel>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </Page>
  );
}
