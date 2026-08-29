'use client';

import { useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { NOTICE, shouldShowNotice } from '@/lib/config/notice';

const STORAGE_KEY = 'notice:readVersion';

function subscribeToNoticeVersion() {
  return () => {};
}

function getStoredReadVersion() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function NoticeDialog() {
  const readVersion = useSyncExternalStore(
    subscribeToNoticeVersion,
    getStoredReadVersion,
    () => null,
  );
  const [dismissed, setDismissed] = useState(false);
  const open = !dismissed && shouldShowNotice(readVersion, NOTICE.version);

  const handleRead = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(NOTICE.version));
    } catch {
      // Ignore storage failures so the dialog can still close.
    }

    setDismissed(true);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setDismissed(false);
        }
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader className="space-y-1">
          <DialogTitle>{NOTICE.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {typeof NOTICE.body === 'string' ? (
            <p className="text-sm text-muted-foreground">{NOTICE.body}</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {NOTICE.body.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}

          {NOTICE.changelog.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                What&apos;s new
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {NOTICE.changelog.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {NOTICE.thanks ? (
            <p className="text-sm text-muted-foreground">{NOTICE.thanks}</p>
          ) : null}
        </div>

        <DialogFooter className="sm:justify-end">
          <Button onClick={handleRead} size="lg" className="min-w-[8rem]">
            I&apos;ve read
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
