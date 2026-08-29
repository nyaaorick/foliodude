'use client';

import { useEffect, useState, useTransition } from 'react';
import { createByIntentFromText } from '@/lib/actions/createByIntent';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

type RunState =
  | { status: 'idle'; data?: undefined; error?: undefined }
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'success'; data: unknown; error?: undefined }
  | { status: 'error'; data?: undefined; error: string };

export function LabClient() {
  const [input, setInput] = useState('');
  const [state, setState] = useState<RunState>({ status: 'idle' });
  const [isPending, startTransition] = useTransition();
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const cooldownMs = 10_000;
  const cooldownRemainingMs = lastRunAt ? Math.max(0, cooldownMs - (now - lastRunAt)) : 0;
  const cooldownSeconds = Math.ceil(cooldownRemainingMs / 1000);
  const isCoolingDown = cooldownRemainingMs > 0;

  const onSubmit = () => {
    if (isCoolingDown) {
      return;
    }

    const text = input.trim();
    if (!text) {
      setState({ status: 'error', error: 'Please enter some text.' });
      return;
    }

    setLastRunAt(Date.now());
    setState({ status: 'loading' });
    startTransition(async () => {
      try {
        const result = await createByIntentFromText({ text });
        setState({ status: 'success', data: result });
      } catch (error) {
        setState({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });
  };

  useEffect(() => {
    if (!lastRunAt) {
      return;
    }

    if (!isCoolingDown) {
      return;
    }

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 500);

    return () => clearInterval(interval);
  }, [isCoolingDown, lastRunAt]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="rounded-3xl border border-border/70 bg-card/80 p-6 shadow-[0_12px_30px_rgba(48,33,22,0.08)]">
        <h2 className="text-lg font-medium tracking-tight">Input</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Submitting will create real data. Use test accounts and avoid sensitive info.
        </p>
        <div className="mt-4 space-y-3">
          <Textarea
            rows={6}
            placeholder="e.g. Transfer 10 from BoA Checking to Amex Gold"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={onSubmit} disabled={isPending || isCoolingDown}>
              {isPending ? 'Running…' : isCoolingDown ? `Wait ${cooldownSeconds}s` : 'Run'}
            </Button>
            {isCoolingDown ? (
              <span className="text-xs text-muted-foreground">
                Run is limited to once every 10 seconds.
              </span>
            ) : null}
          </div>
        </div>
        {state.status === 'error' ? (
          <p className="mt-3 text-sm text-destructive">{state.error}</p>
        ) : null}
      </section>

      <section className="rounded-3xl border border-border/70 bg-card/80 p-6 shadow-[0_12px_30px_rgba(48,33,22,0.08)]">
        <h2 className="text-lg font-medium tracking-tight">Result</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The raw JSON response from the createByIntent pipeline.
        </p>
        <div className="mt-4 rounded-2xl border border-border/60 bg-background/70 p-4 text-xs text-muted-foreground">
          {state.status === 'loading' ? (
            <p>Waiting for model response…</p>
          ) : state.status === 'success' ? (
            <pre className="whitespace-pre-wrap break-words text-foreground">
              {JSON.stringify(state.data, null, 2)}
            </pre>
          ) : (
            <p>No result yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
