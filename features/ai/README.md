# AI intent module

All AI-owned application code, protocol/registry, providers, runtime, UI, tests,
evaluation fixtures and documentation live here. Lab and the shared API-key
section assemble this module. Shared ledger actions, PGlite/SQL, secret storage,
sync permissions and general UI remain in their existing modules.

```text
ui/intent-entry → application/intent-draft-actions
  prepare → protocol/mlp (+ output-format) → providers/text-client
                          ├─ remote Responses SDK
                          └─ runtime/local-runtime → everything-webgpu
  review  → application/intent-draft → protocol/action-registry
  Save    → private snapshot/state checks → registry → shared Tx/ledger
```

`index.ts` is the external Lab entry. Internal imports name their actual owner;
there are no forwarding files at old paths. `config.ts` owns backend/model settings.
`application/remote-settings.ts` owns AI endpoint queries and validation;
`lib/db/settings.ts` owns shared device-secret persistence. The shared API-key
section dispatches the `llm` slot to `ui/remote-api-settings.tsx`.

Planning uses one Responses request with native JSON Schema output. Save and refresh use none. Drafts are private
page-memory capabilities; edits retain schemas/business checks, Save locks and
rechecks state, and failures/cancellation roll back all steps. MLP calls the
registry in process. There is no MCP transport or keyword intent router.

## Repeatable commands

Run from the repository root. Browser executables default to the installed macOS
Edge/Firefox paths; `FOLIO_AI_BROWSER_PATH` overrides the real-model runner path.

| Command | Purpose |
|---|---|
| `npm run ai:test` | Real PGlite boundaries, protocol replay, endpoint storage and evaluator gates; no GPU/model download |
| `npm run ai:verify -- --ui-repeat 2` | Typecheck, full test suite, both builds, fresh-profile PWA/installed Firefox UI twice |
| `npm run ai:ui` | Fixed-output PWA UI on an owned test Vite server, port 4180 |
| `npm run ai:ui -- --firefox` | Installed production extension UI; requires `npm run build:firefox` first |
| `npm run ai:smoke` | Three real Edge cases, seed 20261012; diagnostic subset, never an acceptance pass |
| `npm run ai:eval -- --full` | Sequential Edge/Firefox 46-case regression ×3 and 100-case holdout ×1; keep lid open |
| `npm run harness:ai -- --help` | Individual browser/suite/seed/repeat/case/model-folder selection |
| `npm run ai:report -- results --baseline --verification FILE` | Frozen four-suite report plus actual application verification |
| `npm run ai:report -- diagnose` | Offline classification of all 476 frozen baseline records; writes a new diagnostic report |
| `npm run ai:report -- diagnose REPORT...` | Diagnose new reports using the same categories |
| `npm run ai:report -- summary REPORT` | Recompute full-coverage acceptance; failed gates return nonzero |
| `npm run ai:report -- retain REPORT --runs 1,3 --output NEW` | Retain whole complete repetitions with unchanged current source hashes; preserve originals and error provenance |
| `npm run ai:report -- merge REPORTS... --output NEW` | Merge compatible whole repetitions with matching model/fixtures/core sources |
| `npm run ai:report -- compare BEFORE AFTER` | Same browser/model/fixtures/repeat-count comparison, including plan versus ledger scores |

Export one comparable frozen report with `ai:report -- summary
features/ai/eval/fixtures/baseline.json --select edge/regression --output NEW`.
Failed historical gates intentionally return nonzero while still writing the report.
Diagnostic smoke exits successfully only when its selected cases pass; its
`acceptance.passed` remains false because coverage is incomplete.

Scoring version 2 requires a validated draft for successful requests. Ledger-mode
acceptance also requires correct saves for every plan-correct case; batch success
requires successful runner exits. Plan and save scores remain separate. Version 1
reports remain immutable historical evidence; do not compare scores across versions.

Real-model acceptance is **95% regression**, all critical cases, at least three
complete repetitions; **90% holdout**. A draft proposed for a negative or
hypothetical request is a plan failure and is reported (forbidden proposals,
executable no-action drafts), but is not a separate gate: FolioDude is a personal
ledger, and Review → Save, atomic rollback, stale-state checks and strict Zod
validation are what protect it.
Empty/subset/duplicate/incomplete coverage never qualifies. All wrong drafts count
as failures even if review or validation prevents a write. The cancellation fixture
is a host-contract check; unrequested optional prose/category/date is excluded from
the defined operational-plan comparison.

UI tests intercept a fictional remote endpoint and use real UI/PGlite; they do not
measure model recognition. Each invocation creates a fresh managed profile and
timestamped outputs. PWA UI does not rely on the user's development server. Firefox
privileged-page screenshots are unsupported; its DOM flow/account values are checked.
The test-only Firefox system-access flag applies only to the isolated test process.

`eval/fixtures/baseline.json` freezes all 476 measured cases, source hashes and error
provenance. It contains synthetic ledger data, not credentials. The original raw
reports remain untouched in `.artifacts/ai/`. `observed-format.json` replays seven
actual regression outputs; it deliberately preserves rejection rather than silently
repairing invalid model output. Holdout wording is never used in production prompts
or prompt tuning. Successful raw outputs were not captured by the original harness;
normalized actions must not be described as their raw text.

Reports, screenshots, generated logs, profiles and model caches stay in ignored
`.artifacts/ai/`; model weights do not belong in this source directory. Runtime
adapter source stays owned by the pinned dependency under `node_modules`.

## Loading and using AI

On Lab, choose Remote API or Local WebGPU. Remote mode needs a Responses base URL,
model and key; Chat Completions-only endpoints are unsupported. Remote endpoints
must also support strict `text.format` `json_schema` (see below). Both backends use
one Responses call with no repair call or silent fallback.

The default is Qwen3.8-2B-q4f16_1-MLC and its matching WebGPU WASM. URL sources need
an explicit model directory revision URL and matching WASM URL, both allowing CORS.
Folder imports need `mlc-chat-config.json`, tensor/ndarray cache manifest, all shards,
tokenizer assets and exactly one matching WASM. Raw GGUF/safetensors are unsupported.
Imported files remain local. Sources/settings and credentials are excluded from sync.

Load before generating a preview. Loading progress and cancellation are visible;
release or switching to remote frees the GPU while retaining cached files. After
reload, load again; cached folder imports can be reused until browser storage is
cleared or evicted. Local inference needs WebGPU, IndexedDB, Cache Storage and HTTPS
or localhost; no CPU fallback. iOS support has not been established.

Every request follows Describe → Review → Save → Receipt. Openings default to
ASSET/USD/0; debt is a negative liability balance with no transaction. Expenses and
transfers never implicitly create accounts. Missing information asks for clarification.
`"all"` resolves the locked remaining source balance after preceding steps. Cross-
currency transfers require an explicit received amount. Edit fields before saving;
editing the original request invalidates its draft. Changed accounts require refreshed
review. Save is atomic and model-free; there is no automatic retry or undo. The
Receipt is a dialog listing the saved steps in order — accounts, amount, links to the
earlier step each one builds on, and balances before → after — built only from the
reviewed preview, so it makes no model call.

## Native JSON output (everything-webgpu 0.1.4)

Both backends receive the same request: `text: { format: MLP_OUTPUT_FORMAT }`, a
`json_schema` named `ledger_plan` with `strict: true`, plus `temperature: 0`,
`max_output_tokens: 2048`, `store: false`. Verified in the installed 0.1.4 source
(`src/engine/structured-output.js`, `responses.js`) and bundled README:

- `text.format` accepts `text`, `json_object` and `json_schema`. Locally, the schema
  reaches WebLLM/XGrammar as `response_format.schema` and masks tokens on every
  decode step. The completed text is then parsed and revalidated by
  `@cfworker/json-schema`. `json_object` guarantees only an object root of valid
  JSON syntax, not conformance to any schema, and is not used here.
- Supported subset: object root without `anyOf`/`$ref`; closed objects
  (`additionalProperties: false`); basic types plus nullable unions; homogeneous
  arrays with `minItems`/`maxItems` ≤ 256; primitive `const`/`enum`; nested `anyOf`
  (≤ 16 branches), local `$defs`/`$ref`; `description`/`title`. Rejected: string
  length/pattern/format, numeric bounds, tuples, other composition. Limits: 64 KiB,
  2048 nodes, 10 levels, 1000 properties/enum values. `strict: true` requires every
  property to be listed in `required`.
- Truncation returns `incomplete`; local decode/validation failures return `failed`
  with `server_error` and a `Generated …` message (no distinct error code).
  Usage tokens are `null` for this model. No repair or retry.
- The Qwen3.8 `qwen3_5_nothink` template puts the empty think block in the
  assistant prefix, and the grammar forces `{` first. The old think/fence
  stripping was removed.

The schema is derived, not handwritten: `protocol/output-format.ts` converts the
internal Zod contract (`MlpActionSchema` from the registry's extraction schemas)
with `z.toJSONSchema`. It maps Zod's discriminated `oneOf` to the equivalent
`anyOf`. It drops only the keywords the decoder cannot express (`minLength`,
`exclusiveMinimum`, date `format`/`pattern`, `default`), which Zod still enforces
afterwards, and throws on any other keyword. Strict mode encodes optional fields as
required-nullable. Because a root union is unsupported, the internal
`{steps} | {clarification}` union travels as `{"result": …}`. `result` starts with
an `intent`: `create`, `spend` or `transfer` (from each tool's `plannerIntent`),
`multi` (two or more steps), `none` or `ask`. Each branch fixes the plan's shape.
The model fills only each tool's registry `plannerFields`: name/type/currency/
balance/credit limit, account/amount/currency, and from/to/amount/currencies/
`targetAmount`. Reward currency, memo, date and category take their defaults and
stay editable in review. `fromWire` in `protocol/mlp.ts` is the single place that
unwraps the envelope, turns optional nulls back into omitted fields, and maps the
intent back to the internal union. Draft types and business semantics are unchanged. The grammar
makes the previously observed "both steps and clarification", wrong-root and
prose-outside-JSON categories impossible to emit locally. A remote provider gives
that guarantee only if it honors strict `json_schema`.

Native constraints do not replace understanding or checks. Zod, grounding, registry
permissions, preview, stale-state checks and the DB CHECKs all still apply. Outputs
that satisfy the decoder can still fail Zod: a 0 amount, an empty name or
clarification, or a non-ISO date. These are reported as `format` failures (diagnose
category `format/constraint-outside-decoder-subset`).

Unsupported capability handling: a response that does not echo the same
`text.format` type and `strict` is rejected as unsupported. So is a 400 that names
the format/schema. Other 400s keep their own message. Refusals surface as errors.
There is no prompt-formatting fallback, repair call or backend switch. Remote
endpoints were verified only against intercepted fixtures, not a live provider.

Production prompt: removed "Output one JSON object…", "No Markdown or
explanations", `{"steps":[]}` / `{"clarification":…}` shapes, "Never combine steps
and clarification", "Amounts/balances are JSON numbers", "Omit unknown optional
fields, no null", both JSON examples, "JSON only. Stop after the closing brace", the
input suffix, and enum-spelling/type hints in registry field descriptions. Retained:
verbatim names and generic-suffix exclusion, ASSET/USD/0 defaults, initial debt as
a negative LIABILITY with no transaction, negation/question/hypothetical/greeting =
no action, missing information → clarification, ordered dependent steps and
pronouns, no implicit creation of existing accounts, `"all"` after prior steps,
explicit cross-currency `targetAmount`, today's date. `YYYY-MM-DD` stays because the
decoder cannot express date patterns.

## Findings and proposals

Recognition gates remain failed and the UI remains Experimental. Native JSON (0.1.4)
removed syntax/envelope failures, but those cases became semantic failures; regression
accuracy is unchanged (Edge 30/138, Firefox 33/138) and the partial holdout regressed. The
[failure audit and prioritized experiments](docs/audit.md) records the frozen
baseline, observed failures and remaining model/runtime hypotheses. Development
fixture wording may guide experiments; holdout wording must remain excluded.
