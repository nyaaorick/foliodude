import type OpenAI from 'openai';
import { getAiSettings } from '@/features/ai/application/ai-settings-actions';
import { getLlmConfig } from '@/features/ai/application/remote-settings';
import { getSessionContext } from '@/lib/db/session';
import { withLocalClient } from '@/features/ai/runtime/local-runtime';

export interface AiTextMeasurement {
  instructionChars: number; inputChars: number; outputChars: number;
  inputTokens: number | null; outputTokens: number | null; ms: number;
}
const observers = new Set<(measurement: AiTextMeasurement) => void>();
/** Measurements contain counts only, never prompt text, credentials or ledger data. */
export function observeAiText(observer: (measurement: AiTextMeasurement) => void) {
  observers.add(observer); return () => { observers.delete(observer); };
}

/** Both clients use exactly the same supported, text-only Responses request. */
async function generateResponse(client: OpenAI, model: string, instructions: string, input: string, signal?: AbortSignal) {
  const started = performance.now();
  let response: OpenAI.Responses.Response | undefined;
  try {
    response = await client.responses.create({
      model, instructions, input, temperature: 0, max_output_tokens: 2048, store: false,
    }, { signal });
    if (response.status !== 'completed') {
      throw new Error(response.error?.message ?? `AI response ${response.status}; no entries were created.`);
    }
    if (!response.output_text.trim()) throw new Error('AI returned no text; no entries were created.');
    return response.output_text.trim();
  } finally {
    const measurement: AiTextMeasurement = { instructionChars: instructions.length, inputChars: input.length,
      outputChars: response?.output_text?.length ?? 0, inputTokens: response?.usage?.input_tokens ?? null,
      outputTokens: response?.usage?.output_tokens ?? null, ms: performance.now() - started };
    for (const observer of observers) observer(measurement);
  }
}

export async function generateAiText(instructions: string, input: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const settings = await getAiSettings();
  if (settings.backend === 'local') {
    if (!settings.local) throw new Error('Configure and load a local model on the Lab page.');
    const modelId = settings.local.modelId;
    return withLocalClient(modelId, (client, localSignal) => generateResponse(client, modelId, instructions, input, localSignal), signal);
  }
  const { db } = await getSessionContext();
  const config = await getLlmConfig(db);
  if (!config) throw new Error('No remote LLM configured. Add its Responses base URL, model and API key on the Lab page.');
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({
    baseURL: config.baseUrl, apiKey: config.apiKey, dangerouslyAllowBrowser: true, maxRetries: 0,
  });
  return generateResponse(client, config.model, instructions, input, signal);
}
