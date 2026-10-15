import { z } from 'zod';
import type OpenAI from 'openai';

export type JsonSchemaFormat = OpenAI.Responses.ResponseFormatTextJSONSchemaConfig;
type Node = Record<string, unknown>;

// Accepted by everything-webgpu 0.1.4 (src/engine/structured-output.js) and by strict Responses providers.
const DECODABLE = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'enum', 'const', 'anyOf', '$ref']);
// Metadata, not constraints. Field meanings travel in the instructions, which every backend reads; the local decoder never
// shows the schema to the model. `id` names a $defs entry.
const PROMPT_ONLY = new Set(['description', 'id']);
// Not expressible by the decoder. Zod still enforces each one after decoding.
const VALIDATED_AFTER = new Set(['$schema', 'default', 'minLength', 'maxLength', 'minimum', 'exclusiveMinimum', 'maximum', 'format', 'pattern']);
const allowsNull = (node: Node): boolean => node.type === 'null' || (Array.isArray(node.anyOf) && node.anyOf.some(branch => allowsNull(branch as Node)));
const nullable = (node: Node): Node => {
  if (allowsNull(node)) return node;
  return { anyOf: [...(Array.isArray(node.anyOf) && Object.keys(node).length === 1 ? node.anyOf as Node[] : [node]), { type: 'null' }] };
};

function narrow(node: Node, path: string): Node {
  const out: Node = {};
  for (const [key, value] of Object.entries(node)) {
    // Zod emits oneOf for discriminated unions; const discriminators make the branches disjoint, so anyOf is equivalent.
    if (key === 'oneOf' || key === 'anyOf') out.anyOf = (value as Node[]).map((branch, index) => narrow(branch, `${path}/${key}/${index}`));
    else if (key === 'properties') out.properties = Object.fromEntries(Object.entries(value as Record<string, Node>).map(([name, child]) => [name, narrow(child, `${path}/properties/${name}`)]));
    else if (key === 'items') out.items = narrow(value as Node, `${path}/items`);
    else if (key === '$defs') out.$defs = Object.fromEntries(Object.entries(value as Record<string, Node>).map(([name, child]) => [name, narrow(child, `${path}/$defs/${name}`)]));
    else if (DECODABLE.has(key)) out[key] = value;
    else if (!VALIDATED_AFTER.has(key) && !PROMPT_ONLY.has(key)) throw Error(`The local JSON decoder cannot express ${key} at ${path}.`);
  }
  // Strict decoding requires every property; optional values are represented as null and removed by withoutOptionalNulls.
  if (out.type === 'object') {
    const required = new Set(out.required as string[] | undefined);
    out.properties = Object.fromEntries(Object.entries(out.properties as Record<string, Node>).map(([name, child]) => [name, required.has(name) ? child : nullable(child)]));
    out.required = Object.keys(out.properties as Node);
  }
  return out;
}

/** Derive the shared Responses text.format from the internal Zod contract. */
export function jsonSchemaFormat(name: string, schema: z.ZodType): JsonSchemaFormat {
  // Schemas given an id (meta) are emitted once under $defs and referenced; everything else stays inline.
  return { type: 'json_schema', name, strict: true, schema: narrow(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'throw' }) as Node, '#') };
}

/** Undo the strict-mode null encoding for properties that the Zod object treats as optional. */
export function withoutOptionalNulls(value: unknown, shape: Record<string, z.ZodType>): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key, field]) => field !== null || !shape[key]?.safeParse(undefined).success));
}
