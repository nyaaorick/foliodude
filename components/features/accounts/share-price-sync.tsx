'use client';

import { useEffect, useEffectEvent, useRef, useState, useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { revalidate } from '@/lib/data/store';
import { refreshSharePrices } from '@/lib/actions/share-actions';
import { Button } from '@/components/ui/button';

interface SharePriceSyncProps {
  auto?: boolean;
  showButton?: boolean;
  triggerLabel?: string;
}

export function SharePriceSync({
  auto = false,
  showButton = false,
  triggerLabel = 'Refresh Price',
}: SharePriceSyncProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const autoRanRef = useRef(false);
  const autoThrottleKey = 'share_price_auto_refresh_at';
  const autoThrottleMs = 10_000;
  const manualThrottleKey = 'share_price_manual_refresh_at';
  const manualThrottleMs = 15_000;

  const triggerRefresh = (manual: boolean) => {
    if (manual) {
      try {
        const last = Number(sessionStorage.getItem(manualThrottleKey) ?? '0');
        if (Number.isFinite(last) && Date.now() - last < manualThrottleMs) {
          setInfo('');
          setError('Please wait a few seconds before refreshing prices again.');
          return;
        }
      } catch {
        // ignore
      }
    }

    startTransition(async () => {
      const result = await refreshSharePrices();

      if (!result.success) {
        if (manual) {
          setInfo('');
          setError(result.error);
        }
        return;
      }

      const { updated, freshSkipped } = result.data;
      if (updated === 0) {
        if (manual && freshSkipped > 0) {
          setError('');
          setInfo('Prices were updated recently. Please try again shortly.');
        } else {
          setError('');
          setInfo('');
        }
        return;
      }

      setError('');
      setInfo('');
      try {
        sessionStorage.setItem(autoThrottleKey, String(Date.now()));
        if (manual) {
          sessionStorage.setItem(manualThrottleKey, String(Date.now()));
        }
      } catch {
        // ignore
      }
      revalidate();
    });
  };

  const runAutoRefresh = useEffectEvent(() => {
    triggerRefresh(false);
  });

  useEffect(() => {
    if (!auto || autoRanRef.current) {
      return;
    }

    try {
      const last = Number(sessionStorage.getItem(autoThrottleKey) ?? '0');
      if (Number.isFinite(last) && Date.now() - last < autoThrottleMs) {
        autoRanRef.current = true;
        return;
      }
    } catch {
      // ignore
    }

    autoRanRef.current = true;
    runAutoRefresh();
  }, [auto]);

  if (!showButton && !error && !info) {
    return null;
  }

  return (
    <div className="space-y-2">
      {showButton && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => triggerRefresh(true)}
          disabled={isPending}
        >
          <RefreshCw className={`size-4 ${isPending ? 'animate-spin' : ''}`} />
          {isPending ? 'Refreshing...' : triggerLabel}
        </Button>
      )}
      {info && <p className="text-sm text-muted-foreground">{info}</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
