import { z } from 'zod';

const HttpUrl = z.string().trim().url().regex(/^https?:\/\//, 'Use an http(s) URL');
export const LocalModelSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('url'),
    modelId: z.string().trim().min(1),
    model: HttpUrl,
    modelLib: HttpUrl,
  }).strict(),
  z.object({
    kind: z.literal('folder'),
    modelId: z.string().trim().min(1),
    label: z.string().trim().min(1),
  }).strict(),
]);
export const AiSettingsSchema = z.object({
  backend: z.enum(['remote', 'local']),
  local: LocalModelSchema.nullable(),
}).strict();
export type LocalModelConfig = z.infer<typeof LocalModelSchema>;
export type AiSettings = z.infer<typeof AiSettingsSchema>;

/** User-selected default; the matching compiled library lives in the same repository. */
export const DEFAULT_LOCAL_MODEL = {
  kind: 'url' as const,
  modelId: 'Qwen3.8-2B-q4f16_1-MLC',
  model: 'https://huggingface.co/nyaaorick/Qwen3.8-2B-q4f16_1-MLC/resolve/main/',
  modelLib: 'https://huggingface.co/nyaaorick/Qwen3.8-2B-q4f16_1-MLC/resolve/main/Qwen3.8-2B-q4f16_1_cs1k-webgpu.wasm',
};
