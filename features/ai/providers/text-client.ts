import type OpenAI from 'openai';
import { getAiSettings } from '@/features/ai/application/ai-settings-actions';
import { getLlmConfig } from '@/features/ai/application/remote-settings';
import { getSessionContext } from '@/lib/db/session';
import { withLocalClient } from '@/features/ai/runtime/local-runtime';
import type { JsonSchemaFormat } from '@/features/ai/protocol/output-format';

export interface AiTextMeasurement {
  instructionChars: number; inputChars: number; outputChars: number;
  inputTokens: number | null; outputTokens: number | null; ms: number;
  /** The format the endpoint echoed as applied, or `unconfirmed`. */
  outputMode: string; status: string | null;
}
/** The model finished without a complete output in the requested format. */
export class AiOutputError extends Error {
  constructor(message: string, public readonly output: string) { super(message); }
}
// everything-webgpu 0.1.4 reports its post-decode JSON/schema rejections as failed responses with these messages.
const LOCAL_FORMAT_FAILURE = /^Generated (?:output is not complete valid JSON|JSON (?:must have an object root|does not match schema))/;
const applied = (response: OpenAI.Responses.Response, format: JsonSchemaFormat) => {
  const echoed = response.text?.format;
  return echoed?.type === format.type && echoed.strict === format.strict;
};
const observers = new Set<(measurement: AiTextMeasurement) => void>();
/** Measurements contain counts only, never prompt text, credentials or ledger data. */
export function observeAiText(observer: (measurement: AiTextMeasurement) => void) {
  observers.add(observer); return () => { observers.delete(observer); };
}

/** Both clients send exactly the same Responses request, including native JSON Schema output. */
async function generateResponse(client: OpenAI, model: string, instructions: string, input: string, format: JsonSchemaFormat, signal?: AbortSignal) {
  const started = performance.now();
  let response: OpenAI.Responses.Response | undefined;
  try {
    response = await client.responses.create({
      model, instructions, input, text: { format }, temperature: 0, max_output_tokens: 2048, store: false,
    }, { signal });
    const output = response.output_text ?? '';
    if (response.status === 'incomplete') throw new AiOutputError(`AI output stopped before the ${format.name} JSON was complete (${response.incomplete_details?.reason ?? 'incomplete'}).`, output);
    if (response.status === 'failed' && LOCAL_FORMAT_FAILURE.test(response.error?.message ?? '')) throw new AiOutputError(response.error!.message, output);
    if (response.status !== 'completed') {
      throw new Error(response.error?.message ?? `AI response ${response.status}; no entries were created.`);
    }
    // An endpoint that ignores text.format would return unconstrained text. Require the echoed format; never fall back.
    if (!applied(response, format)) throw new Error(`The AI endpoint did not confirm ${format.type} output; it is unsupported for planning. No entries were created.`);
    const refusal = response.output.flatMap(item => item.type === 'message' ? item.content : []).find(part => part.type === 'refusal');
    if (refusal) throw new Error(`The AI declined the request: ${refusal.refusal}`);
    return output;
  } catch (cause) {
    // Only a rejection that names the output format is a missing capability; other 400s keep their own message.
    if (cause instanceof Error && 'status' in cause && cause.status === 400 && /text\.format|json_schema|response_format|schema/i.test(`${'param' in cause ? cause.param : ''} ${cause.message}`)) {
      throw new Error(`The AI endpoint rejected native ${format.type} output: ${cause.message}. It is unsupported for planning; no fallback is attempted.`, { cause });
    }
    throw cause;
  } finally {
    const measurement: AiTextMeasurement = { instructionChars: instructions.length, inputChars: input.length,
      outputChars: response?.output_text?.length ?? 0, inputTokens: response?.usage?.input_tokens ?? null,
      outputTokens: response?.usage?.output_tokens ?? null, ms: performance.now() - started,
      outputMode: response && applied(response, format) ? `${format.type}${format.strict ? ':strict' : ''}` : 'unconfirmed', status: response?.status ?? null };
    for (const observer of observers) observer(measurement);
  }
}

export async function generateAiText(instructions: string, input: string, format: JsonSchemaFormat, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const settings = await getAiSettings();
  if (settings.backend === 'local') {
    if (!settings.local) throw new Error('Configure and load a local model on the Lab page.');
    const modelId = settings.local.modelId;
    return withLocalClient(modelId, (client, localSignal) => generateResponse(client, modelId, instructions, input, format, localSignal), signal);
  }
  const { db } = await getSessionContext();
  const config = await getLlmConfig(db);
  if (!config) throw new Error('No remote LLM configured. Add its Responses base URL, model and API key on the Lab page.');
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({
    baseURL: config.baseUrl, apiKey: config.apiKey, dangerouslyAllowBrowser: true, maxRetries: 0,
  });
  return generateResponse(client, config.model, instructions, input, format, signal);
}
