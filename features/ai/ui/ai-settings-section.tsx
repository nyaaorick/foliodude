import { useState, useSyncExternalStore } from 'react';
import { getAiSettings, saveAiSettings } from '@/features/ai/application/ai-settings-actions';
import { DEFAULT_LOCAL_MODEL, type AiSettings } from '@/features/ai/config';
import { cancelLocalWork, getLocalRuntimeState, loadLocalModel, releaseLocalModel, subscribeLocalRuntime } from '@/features/ai/runtime/local-runtime';
import { revalidate } from '@/lib/data/store';
import { useLiveQuery } from '@/lib/data/use-live-query';
import { Loaded } from '@/components/app/page-state';
import { Field } from '@/components/app/form-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function SettingsForm({ settings, disabled, onBusy }: {
  settings: AiSettings;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const runtime = useSyncExternalStore(subscribeLocalRuntime, getLocalRuntimeState);
  const [source, setSource] = useState<'url' | 'folder'>(settings.local?.kind ?? 'url');
  const [modelId, setModelId] = useState(settings.local?.kind === 'url' ? settings.local.modelId : DEFAULT_LOCAL_MODEL.modelId);
  const [model, setModel] = useState(settings.local?.kind === 'url' ? settings.local.model : DEFAULT_LOCAL_MODEL.model);
  const [modelLib, setModelLib] = useState(settings.local?.kind === 'url' ? settings.local.modelLib : DEFAULT_LOCAL_MODEL.modelLib);
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const localBusy = runtime.status === 'loading' || runtime.status === 'running';

  const run = async (action: () => Promise<void>) => {
    setBusy(true); onBusy(true); setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'AI configuration failed'); }
    finally { setBusy(false); onBusy(false); revalidate(); }
  };
  const chooseBackend = (backend: AiSettings['backend']) => run(async () => {
    await releaseLocalModel();
    await saveAiSettings({ ...settings, backend });
  });
  const prepare = () => run(async () => {
    await releaseLocalModel();
    const local = source === 'url'
      ? { kind: 'url' as const, modelId, model, modelLib }
      : files?.length
        ? { kind: 'folder' as const, modelId: `foliodude-${crypto.randomUUID()}`, label: files[0].webkitRelativePath.split('/')[0] || files[0].name }
        : settings.local?.kind === 'folder' ? settings.local : null;
    if (!local) throw new Error('Select a compiled MLC model folder first.');
    await saveAiSettings({ backend: 'local', local });
    await loadLocalModel(local, source === 'folder' ? files ?? undefined : undefined);
    setFiles(null);
  });

  return (
    <div className="space-y-4">
      <fieldset disabled={disabled || busy || localBusy} className="space-y-4">
        <legend className="mb-2 text-sm font-medium">AI backend</legend>
        <div className="flex gap-2">
          {(['remote', 'local'] as const).map((backend) => (
            <Button key={backend} aria-pressed={settings.backend === backend}
              variant={settings.backend === backend ? 'default' : 'outline'}
              disabled={settings.backend === backend}
              onClick={() => chooseBackend(backend)}>
              {backend === 'remote' ? 'Remote API' : 'Local WebGPU'}
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {settings.backend === 'remote'
            ? 'Uses the remote LLM credentials in API keys below.'
            : 'Text inference stays on this device. URL models download and cache files; imported folders stay local.'}
        </p>
        {settings.backend === 'local' && (
          <>
            <Field label="Model source" htmlFor="local-source">
              <select id="local-source" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                value={source} onChange={(event) => setSource(event.target.value as 'url' | 'folder')}>
                <option value="url">Model URL</option>
                <option value="folder">Local model folder</option>
              </select>
            </Field>
            {source === 'url' ? (
              <>
                <Field label="Model ID" htmlFor="local-model-id">
                  <Input id="local-model-id" value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="my-mlc-model" />
                </Field>
                <Field label="Model directory URL" htmlFor="local-model-url">
                  <Input id="local-model-url" value={model} onChange={(event) => setModel(event.target.value)} placeholder="https://host/models/my-model/resolve/main/" />
                </Field>
                <Field label="Matching WebGPU WASM URL" htmlFor="local-model-lib">
                  <Input id="local-model-lib" value={modelLib} onChange={(event) => setModelLib(event.target.value)} placeholder="https://host/libs/my-model-webgpu.wasm" />
                </Field>
                <p className="text-xs text-muted-foreground">Use an explicit /resolve/revision/ model path. Both hosts must allow CORS.</p>
              </>
            ) : (
              <Field label="Compiled MLC model folder" htmlFor="local-model-folder">
                <Input id="local-model-folder" type="file" multiple
                  {...{ webkitdirectory: '' }}
                  onChange={(event) => setFiles(event.target.files)} />
                <p className="text-xs text-muted-foreground">
                  Include mlc-chat-config.json, tensor-cache.json (or ndarray-cache.json), all weight shards,
                  the tokenizer and exactly one matching WebGPU .wasm. Raw GGUF and safetensors are unsupported.
                </p>
                {settings.local?.kind === 'folder' && <p className="text-sm">Imported: {settings.local.label}. If browser storage is cleared, import it again.</p>}
              </Field>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={prepare}>Save and load model</Button>
              <Button variant="outline" onClick={() => run(releaseLocalModel)} disabled={runtime.modelId === null}>Release model</Button>
            </div>
          </>
        )}
      </fieldset>
      {settings.backend === 'local' && (
        <div role="status" aria-live="polite" className="space-y-2 text-sm">
          <p>{runtime.label}</p>
          {runtime.status === 'loading' && <progress className="w-full" max={1} value={runtime.progress ?? undefined} aria-label="Model loading progress" />}
          {runtime.status === 'loading' && <Button variant="outline" onClick={cancelLocalWork}>Cancel loading</Button>}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function AiSettingsSection({ disabled, onBusy }: { disabled: boolean; onBusy: (busy: boolean) => void }) {
  const state = useLiveQuery(getAiSettings);
  return (
    <section className="space-y-3 rounded-2xl border border-border/70 bg-card/80 p-4 md:p-6">
      <h2 className="text-base font-medium tracking-tight">AI for Create by intent</h2>
      <Loaded state={state}>
        {(settings) => <SettingsForm settings={settings} disabled={disabled} onBusy={onBusy} />}
      </Loaded>
    </section>
  );
}
