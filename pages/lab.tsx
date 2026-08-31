import { useEffect, useState, useTransition } from 'react';

import { createByIntentFromText } from '@/lib/actions/createByIntent';
import { revalidate } from '@/lib/data/store';
import { Page, PageHeader } from '@/components/app/page-state';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type RunState =
  | { status: 'idle' }
  | { status: 'success'; data: unknown }
  | { status: 'error'; error: string };

const COOLDOWN_MS = 10_000;

export default function LabPage() {
  const [input, setInput] = useState('');
  const [state, setState] = useState<RunState>({ status: 'idle' });
  const [isPending, startTransition] = useTransition();
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const cooldownRemaining = lastRunAt ? Math.max(0, COOLDOWN_MS - (now - lastRunAt)) : 0;
  const isCoolingDown = cooldownRemaining > 0;

  useEffect(() => {
    if (!isCoolingDown) return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [isCoolingDown]);

  const onSubmit = () => {
    const text = input.trim();
    if (!text) {
      setState({ status: 'error', error: 'Please enter some text.' });
      return;
    }

    setLastRunAt(Date.now());
    startTransition(async () => {
      try {
        const data = await createByIntentFromText({ text });
        setState({ status: 'success', data });
        // This writes real ledger rows, so every open view has to refetch.
        revalidate();
      } catch (error) {
        setState({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Lab"
        title="Lab"
        description="Features under test. Feedback is always welcome."
      />

      <section className="space-y-3 rounded-2xl border border-border/70 bg-card/80 p-4 md:p-6">
        <div>
          <h2 className="text-base font-medium tracking-tight">Create by intent</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Submitting creates real data. Needs a Gemini key in settings; use test accounts
            and avoid sensitive info.
          </p>
        </div>

        <Textarea
          rows={5}
          placeholder="e.g. Transfer 10 from BoA Checking to Amex Gold"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />

        <Button
          className="w-full md:w-auto"
          size="lg"
          onClick={onSubmit}
          disabled={isPending || isCoolingDown}
        >
          {isPending
            ? 'Running…'
            : isCoolingDown
              ? `Wait ${Math.ceil(cooldownRemaining / 1000)}s`
              : 'Run'}
        </Button>

        {state.status === 'error' && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}
      </section>

      {state.status === 'success' && (
        <section className="space-y-2 rounded-2xl border border-border/70 bg-card/80 p-4 md:p-6">
          <h2 className="text-base font-medium tracking-tight">Result</h2>
          <pre className="overflow-x-auto rounded-xl border border-border/60 bg-background/70 p-3 text-xs">
            {JSON.stringify(state.data, null, 2)}
          </pre>
        </section>
      )}
    </Page>
  );
}
