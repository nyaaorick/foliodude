import { RemoteApiSettings } from '@/features/ai/ui/remote-api-settings';
import { useState } from 'react';
import { listApiKeyStatus, removeApiKey, saveApiKey } from '@/lib/actions/api-key-actions';
import type { ApiKeyStatus } from '@/lib/actions/api-key-actions';
import { revalidate } from '@/lib/data/store';
import { useLiveQuery } from '@/lib/data/use-live-query';
import type { ApiKeyProvider } from '@/lib/db/settings';
import { Loaded } from '@/components/app/page-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const PROVIDER_COPY: Record<Exclude<ApiKeyProvider, 'llm'>, { title: string; hint: string }> = {
  exchangerate: {
    title: 'Exchange rates',
    hint: 'ExchangeRate-API key. Without one every currency falls back to 1:1.',
  },
  finnhub: {
    title: 'Share prices',
    hint: 'Finnhub key, used by "Refresh Prices" on share accounts.',
  },

};

function ProviderForm({ status }: { status: Omit<ApiKeyStatus, 'provider'> & { provider: Exclude<ApiKeyProvider, 'llm'> } }) {
  const { title, hint } = PROVIDER_COPY[status.provider];

  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      setApiKey('');
      revalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(() =>
      saveApiKey(
        { provider: status.provider, apiKey },
      ),
    );

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-background/60 p-3 md:p-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{title}</h3>
          <span className="text-xs text-muted-foreground">
            {status.configured ? `Saved ${status.masked}` : 'Not set'}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>



      <div className="space-y-1.5">
        <Label htmlFor={`${status.provider}-key`}>API key</Label>
        <Input
          id={`${status.provider}-key`}
          type="password"
          autoComplete="off"
          placeholder={status.configured ? 'Enter a new key to replace it' : 'Paste your key'}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button size="lg" onClick={save} disabled={busy || !apiKey.trim()}>
          Save
        </Button>
        {status.configured && (
          <Button
            size="lg"
            variant="outline"
            disabled={busy}
            onClick={() => run(() => removeApiKey({ provider: status.provider }))}
          >
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

/** Where the user enters every bring-your-own-key credential (PLAN.md §1). */
export function ApiKeysSection() {
  const state = useLiveQuery(listApiKeyStatus);

  return (
    <section className="space-y-3 rounded-2xl border border-border/70 bg-card/80 p-4 md:p-6">
      <div>
        <h2 className="text-base font-medium tracking-tight">API keys</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Stored only in this device&apos;s local database and never included in sync.
        </p>
      </div>

      <Loaded state={state}>
        {(statuses) => (
          <div className="space-y-3">
            {statuses.map((status) => status.provider === 'llm' ? (
              <RemoteApiSettings key={`${status.provider}|${status.masked}|${status.endpoint?.baseUrl}|${status.endpoint?.model}`} status={status} />
            ) : (
              <ProviderForm key={`${status.provider}|${status.masked}`} status={{ ...status, provider: status.provider }} />
            ))}
          </div>
        )}
      </Loaded>
    </section>
  );
}
