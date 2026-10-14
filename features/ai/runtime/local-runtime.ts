import type OpenAI from 'openai';
import type { createLocalClient } from 'everything-webgpu';
import { LocalModelSchema, type LocalModelConfig } from '@/features/ai/config';

export interface LocalRuntimeState {
  status: 'idle' | 'loading' | 'ready' | 'running' | 'error';
  modelId: string | null;
  label: string;
  progress: number | null;
}
let state: LocalRuntimeState = { status: 'idle', modelId: null, label: 'Model not loaded', progress: null };
const listeners = new Set<() => void>();
let client: ReturnType<typeof createLocalClient> | null = null;
let controller: AbortController | null = null;

export const getLocalRuntimeState = () => state;
export function subscribeLocalRuntime(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function update(patch: Partial<LocalRuntimeState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
export function cancelLocalWork() { controller?.abort(); }
export async function releaseLocalModel() {
  if (controller) throw new Error('Cancel the active local operation before releasing the model.');
  const previous = client;
  client = null;
  await previous?.dispose();
  update({ status: 'idle', modelId: null, label: 'Model released; cached files retained', progress: null });
}

/** Import/download artifacts first so progress is visible; the Responses client owns the GPU Worker. */
export async function loadLocalModel(config: LocalModelConfig, files?: FileList) {
  if (controller) throw new Error('A local AI operation is already running.');
  config = LocalModelSchema.parse(config);
  const current = new AbortController();
  controller = current;
  update({ status: 'loading', modelId: config.modelId, label: 'Preparing model files…', progress: null });
  let storage: ({ close?: () => void }) | undefined;
  try {
    const previous = client;
    client = null;
    await previous?.dispose();
    const { CreateScheduledEngine, createLocalClient, filesFromInput, probeDevice } = await import('everything-webgpu');
    const { indexedDBStorage } = await import('everything-webgpu/adapters/idb');
    current.signal.throwIfAborted();
    if (!(await probeDevice()).webgpu) throw new Error('WebGPU is unavailable in this browser. Select Remote API or enable WebGPU in a supported browser.');
    const adapter = await indexedDBStorage();
    storage = adapter;
    const engine = await CreateScheduledEngine(undefined, { store: adapter });
    const onProgress = (report: { done: number; total: number; label: string }) => {
      current.signal.throwIfAborted();
      update({ label: report.label, progress: report.total ? report.done / report.total : null });
    };
    if (config.kind === 'url') {
      await engine.load(config, { defer: true });
      await engine.prefetch(config.modelId, { signal: current.signal, onProgress });
    } else if (files?.length) {
      await engine.load({ modelId: config.modelId, files: filesFromInput(files) }, { defer: true, onProgress });
    } else if (await engine.cacheState(config.modelId) !== 'cached') {
      throw new Error('Imported model files are missing. Select the original model folder again.');
    }
    current.signal.throwIfAborted();
    update({ label: 'Initializing WebGPU…', progress: null });
    const next = createLocalClient(config.modelId);
    client = next;
    // A one-token request initializes the GPU without touching the ledger.
    const result = await next.responses.create({
      model: config.modelId, input: 'Reply OK.', max_output_tokens: 1, store: false,
    }, { signal: current.signal });
    if (result.status === 'failed') throw new Error(result.error?.message ?? 'Model initialization failed');
    current.signal.throwIfAborted();
    update({ status: 'ready', label: 'Ready', progress: 1 });
  } catch (error) {
    const previous = client;
    client = null;
    await previous?.dispose();
    update({ status: 'error', label: current.signal.aborted ? 'Loading cancelled' : error instanceof Error ? error.message : 'Model loading failed', progress: null });
    throw error;
  } finally {
    storage?.close?.();
    controller = null;
  }
}

/** Keep lifecycle/cancellation separate from the shared Responses request. */
export async function withLocalClient<T>(
  modelId: string,
  work: (client: OpenAI, signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!client || state.modelId !== modelId || state.status !== 'ready') {
    throw new Error('Load the selected local model on the Lab page before running.');
  }
  const current = new AbortController();
  controller = current;
  update({ status: 'running', label: 'Generating…', progress: null });
  try {
    return await work(client, signal ? AbortSignal.any([signal, current.signal]) : current.signal);
  } finally {
    controller = null;
    update({ status: 'ready', label: 'Ready', progress: 1 });
  }
}
