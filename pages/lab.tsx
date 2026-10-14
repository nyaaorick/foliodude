import { useState, useSyncExternalStore } from 'react';
import { Page, PageHeader } from '@/components/app/page-state';
import { AiSettingsSection, IntentEntry, getLocalRuntimeState, subscribeLocalRuntime } from '@/features/ai';
import { ApiKeysSection } from '@/components/features/lab/api-keys-section';

export default function LabPage() {
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [intentBusy, setIntentBusy] = useState(false);
  const runtime = useSyncExternalStore(subscribeLocalRuntime, getLocalRuntimeState);
  return <Page>
    <PageHeader eyebrow="Lab" title="Lab" description="Features under test. Feedback is always welcome." />
    <IntentEntry disabled={settingsBusy || runtime.status === 'loading'} onBusy={setIntentBusy} />
    <details className="rounded-2xl border border-border/70 bg-card/80 p-4 md:p-6">
      <summary className="cursor-pointer text-sm font-medium">AI settings and API keys</summary>
      <div className="mt-4 space-y-4">
        <AiSettingsSection disabled={intentBusy} onBusy={setSettingsBusy} />
        <fieldset disabled={intentBusy || settingsBusy}><ApiKeysSection /></fieldset>
      </div>
    </details>
  </Page>;
}
