import { useState } from 'react';
import { removeApiKey, saveApiKey } from '@/lib/actions/api-key-actions';
import type { ApiKeyStatus } from '@/lib/actions/api-key-actions';
import { revalidate } from '@/lib/data/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';


export function RemoteApiSettings({ status }: { status: ApiKeyStatus }) {
  const title = 'LLM (Create by intent)';
  const hint = 'An OpenAI-compatible Responses API. Enter its base URL, model and key.';

  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(status.endpoint?.baseUrl ?? '');
  const [model, setModel] = useState(status.endpoint?.model ?? '');
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
        { provider: 'llm', apiKey, baseUrl, model },
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

      {(
        <>
          <div className="space-y-1.5">
            <Label htmlFor="llm-base-url">Base URL</Label>
            <Input
              id="llm-base-url"
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="llm-model">Model</Label>
            <Input
              id="llm-model"
              placeholder="gpt-4o-mini"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </div>
        </>
      )}

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

