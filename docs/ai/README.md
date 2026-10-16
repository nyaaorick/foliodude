# AI intent module

All AI-owned application code, protocol/registry, providers, runtime, UI, tests and
evaluation fixtures live in [`features/ai/`](../../features/ai); its documentation is
here in `docs/ai/`. Code paths below are relative to `features/ai/`. Lab and the shared API-key
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

<!-- AUTO-GENERATED: AI commands from package.json scripts (ai:*, harness:ai) and eval/*.mjs --help -->
| Command | Purpose |
|---|---|
| `npm run ai:test` | Real PGlite boundaries, protocol replay, endpoint storage and evaluator gates; no GPU/model download |
| `npm run ai:verify -- --ui-repeat 2` | Typecheck, full test suite, both builds, fresh-profile PWA/installed Firefox UI twice |
| `npm run ai:ui` | Fixed-output PWA UI on an owned test Vite server, port 4180 |
| `npm run ai:ui -- --firefox` | Installed production extension UI; requires `npm run build:firefox` first |
| `npm run ai:eval` | **Default model test**: the 10-case core suite on Edge, once; every case must pass (about 4 minutes locally) |
| `npm run ai:eval -- --full` | Archived: Edge/Firefox 57-case regression ×3 and 100-case holdout ×1, several hours. Run only on explicit request |
| `npm run harness:ai -- --help` | Individual browser/suite (`core` default, `regression`, `holdout`)/repeat/case/model-folder selection |
| `npm run harness:ai -- --remote …` | Same pipeline against the remote endpoint in the gitignored root `config.json` (see Remote evaluation) |
| `npm run ai:report -- results --baseline --verification FILE` | Frozen four-suite report plus actual application verification |
| `npm run ai:report -- diagnose` | Offline classification of all 476 frozen baseline records; writes a new diagnostic report |
| `npm run ai:report -- diagnose REPORT...` | Diagnose new reports using the same categories |
| `npm run ai:report -- summary REPORT` | Recompute full-coverage acceptance; failed gates return nonzero |
| `npm run ai:report -- retain REPORT --runs 1,3 --output NEW` | Retain whole complete repetitions with unchanged current source hashes; preserve originals and error provenance |
| `npm run ai:report -- merge REPORTS... --output NEW` | Merge compatible whole repetitions with matching model/fixtures/core sources |
| `npm run ai:report -- compare BEFORE AFTER` | Same browser/model/fixtures/repeat-count comparison, including plan versus ledger scores |
<!-- END AUTO-GENERATED -->

Export one comparable frozen report with `ai:report -- summary
features/ai/eval/fixtures/baseline.json --select edge/regression --output NEW`.
Failed historical gates intentionally return nonzero while still writing the report.
A `--cases` selection is diagnostic: it exits successfully only when its selected
cases pass, and its `acceptance.passed` remains false because coverage is incomplete.

Scoring version 2 requires a validated draft for successful requests. Ledger-mode
acceptance also requires correct saves for every plan-correct case; batch success
requires successful runner exits. Plan and save scores remain separate. Version 1
reports remain immutable historical evidence; do not compare scores across versions.
Acceptance is versioned separately (`ACCEPTANCE_VERSION` 3 in `eval/report-utils.mjs`):
version 3 dropped the separate no-executable-negative-draft gate. Comparisons also
refuse reports whose fixtures or expectations differ, so a fixture change (such as
the card-brand rule below) starts a new comparison series.

Real-model acceptance is the **core suite**: the 10 cases in manifest `coreIds`, on
Edge, one repetition, **10/10**. They cover a stated-amount transfer, transfer
everything, card repayment, a cross-currency transfer, an asset opening, a card brand
with debt, card spending, a partial-name account match, a three-step plan, and a
missing amount that must be asked for. The full suites are archived, not deleted:
regression (57, ≥95%, all critical cases, three repetitions) and holdout (100, ≥90%)
keep their original gates and run only on explicit request. A draft proposed for a negative or
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

## Remote evaluation

`harness:ai -- --remote` runs the unchanged pipeline against the Responses endpoint
in the gitignored root `config.json`:

```json
{ "remote": { "baseUrl": "https://api.groq.com/openai/v1", "model": "openai/gpt-oss-120b", "apiKey": "…", "tokensPerMinute": 8000 } }
```

The harness stores the endpoint with the app's own `saveApiKey` and selects the
remote backend; reports record only `baseUrl` and `model`, never the key. Cases are
paced to `tokensPerMinute` (default 8000) from reported usage. A rejected generation
reports no usage, so it is charged the largest request seen. A 429 ends the
repetition as an infrastructure fault, so rerun it whole. Groq's free tier also
caps daily tokens, so a full suite spans several days. `ai:report -- compare`
refuses local-versus-remote pairs (model differs); compare those reports by case.

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
ASSET/USD/0. A card, charge card, or card brand/issuer named as the account (Amex,
Visa) opens a LIABILITY; a bank account (chase checking) stays ASSET. Debt is a
negative liability balance with no transaction. Expenses and
transfers never implicitly create accounts. An existing account may be named by a part
of its name that only it has ("把我chase里记录一笔debit消费" uses chase checking; Latin parts
are whole words, Chinese parts substrings); the draft carries the full name, and a
part shared by several accounts is rejected. New account names must still appear
verbatim. Missing information asks for clarification.
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
afterwards, and throws on any other keyword. It also drops `description` and `id`:
field meanings travel in the instructions, which every backend reads, and the local
decoder never shows the schema to the model. Each wire step schema carries an id, so
it is emitted once under `$defs` and referenced from both its intent branch and
`multi` (7523 → 3772 characters; on Groq 2489 → 1656 input tokens per request, of which
582 are instructions and request). Strict mode encodes optional fields as
required-nullable. Because a root union is unsupported, the internal
`{steps} | {clarification}` union travels as `{"result": …}`. `result` starts with
an `intent`: `create`, `spend` or `transfer` (from each tool's `plannerIntent`),
`multi` (two or more steps of different kinds), `none` or `ask`. Each branch fixes the
plan's shape; the grammar cannot express "different kinds", so `fromWire` rejects a
same-kind `multi` as a format failure.
The model fills only each tool's registry planner view: name/type/currency/
balance/credit limit/reward currency, account/amount/currency/memo, and
from/to/amount/currencies/`targetAmount`/memo. Transfer has two views told apart by
action name: `transfer` (a positive amount) and `transfer_all` (no amount; `fromWire`
restores `amount: "all"`). Groq's strict validator rejects a `number | "all"` field
even for valid output, because it cannot disambiguate the union. Strict mode makes the model fill these
optional fields, so a memo or reward currency is kept only when the request states it
verbatim (a reward id needs a Latin word boundary, or its display name); otherwise it
is dropped from the draft before review (`STATED_FIELDS`). Date and category are not
extracted: a relative date or a guessed category cannot be grounded. They take their
defaults and stay editable in review. `fromWire` in `protocol/mlp.ts` is the single place that
unwraps the envelope, turns optional nulls back into omitted fields, maps each view
back to its action with the view's fixed fields, and maps the intent back to the
internal union. Draft types and business semantics are unchanged. The grammar
makes the previously observed "both steps and clarification", wrong-root and
prose-outside-JSON categories impossible to emit locally. A remote provider gives
that guarantee only if it honors strict `json_schema`.

Native constraints do not replace understanding or checks. Zod, grounding, registry
permissions, preview, stale-state checks and the DB CHECKs all still apply. Outputs
that satisfy the decoder can still fail Zod: a 0 amount, an empty name or
clarification, or a non-ISO date. These are reported as `format` failures (diagnose
category `format/constraint-outside-decoder-subset`). One documented exception: the
local model writes `transfer` with `amount: 0` for "move everything", which the
decoder cannot exclude, so `fromWire` reads a 0 transfer as `transfer_all`. A request
that gives no amount can therefore produce a move-everything draft; Review shows
"Entire remaining balance" and Save still needs explicit confirmation.

A provider that validates after generating (Groq) returns a 400
`json_validate_failed` with the rejected output in `failed_generation`; that is the
model's `format` failure, not a missing capability.

Unsupported capability handling: a response that echoes a different `text.format`
type or `strict` is rejected as unsupported. Many compatible servers apply the format
without echoing it, so a missing echo is accepted; the plan is still parsed against
the strict schema and never repaired. So is a 400 that names
the format/schema. Other 400s keep their own message. Refusals surface as errors.
There is no prompt-formatting fallback, repair call or backend switch. Remote mode is
verified live against Groq `openai/gpt-oss-120b` (Responses API, strict
`json_schema`, CORS) and in UI tests against an intercepted fixture endpoint.

Production prompt: removed "Output one JSON object…", "No Markdown or
explanations", `{"steps":[]}` / `{"clarification":…}` shapes, "Never combine steps
and clarification", "Amounts/balances are JSON numbers", "Omit unknown optional
fields, no null", both JSON examples, "JSON only. Stop after the closing brace", the
input suffix, and enum-spelling/type hints in registry field descriptions. Retained:
verbatim names and generic-suffix exclusion, ASSET/USD/0 defaults, cards and card
brands (Amex, Visa) as LIABILITY, initial debt as a negative LIABILITY with no
transaction, negation/question/hypothetical/greeting = no action, missing
information → clarification, ordered dependent steps and pronouns, no implicit
creation of existing accounts, explicit cross-currency `targetAmount`, today's date.
Added: four placeholder-name examples (transfer_all, spend, none, ask; two English,
two Chinese; no JSON syntax), and one line per planner view generated from the
registry (later views of an action are described against its first, e.g.
`transfer_all: …; as transfer, without amount`). The budget is
`MLP_LIMITS.instructionChars` = 2000. `YYYY-MM-DD` stays because the decoder cannot
express date patterns.

## Fixture expectations

The core suite is a fixed selection from the regression set, listed once in the
manifest (`coreIds`); `harness:ai` sends those ids and `report-utils` grades them.
The regression set (`eval/cases.ts`, manifest version 3) is 57 explicit bilingual
cases weighted to everyday use, each with its exact plan; end balances are derived
from the seed and plan (`settle`), never hand-computed. Chinese cases use CNH accounts.

| Group | Cases | Covers |
|---|---:|---|
| `transfer-*` | 15 | stated amounts (decimals, `1,000`), pronouns, card repayment, everything (`transfer_all`), currency conversion with the received amount |
| `create-*` | 14 | assets, cards and card brands, opening debt, credit limits, EUR/HKD/CNH, several at once |
| `spend-*` | 8 | asset and card spending, stated memos |
| `match-*` | 7 | existing accounts named by part of their name (`chase` → chase checking, 招商 → 招商银行, 信用卡 → 招行信用卡), case-insensitive names, ambiguous parts |
| `multi-*` | 6 | steps that depend on earlier ones (create then spend/fund, spend then move the rest, two transfers) |
| `edge-*` | 7 | a question, a negation, missing amount or destination, a missing account, rollback, cancellation |

The holdout (`eval/holdout-cases.ts`, 100 cases) is unchanged. Its wording stays out
of prompts and tuning. A test feeds every regression plan through the pipeline as a
perfect answer: each `success` case must produce a draft and each rejected case must
fail with its named error, so no fixture is unpassable. The rules the cases encode
(scoring is `planOutcomeMatches` in `eval/expected-plans.ts`):

- `success`: a validated draft whose steps and operational parameters match exactly
  (unrequested optional memo/category/date are not scored).
- `no_action`: the model must answer `none`. A clarification instead is a failure.
- `clarification`: the model must answer `ask`.
- `reject`: the model must faithfully extract the stated plan, and host validation
  must reject it with the named error (`Several accounts match`, `Account not found`,
  `Insufficient balance` at save). Answering `none` or `ask` instead is a failure.
- `cancel`: a host-contract check that abort reaches the request.
- Card brands/issuers open as LIABILITY; a bank account stays ASSET.
- An existing account named by a part of its name that only it has is that account;
  it is never re-created. A part shared by several accounts is rejected.

Still undecided: whether `ask` may substitute for `none` on how-to questions, and
whether `none`/`ask` may substitute for `reject` when an account is missing.

## Findings and proposals

Recognition gates remain failed and the UI remains Experimental. Latest complete
local evaluation (C+B+A, before the review fixes): Edge regression 65/138, Firefox
62/138, Edge holdout 48/100, Firefox holdout 50/100; 14 of 20 critical cases fail in
both browsers. Single Edge regression repetitions since then, on the previous 46-case
fixture set: review fixes 25/46; transfer split 18/46 (the local model
wrote `transfer` with amount 0); remote `gpt-oss-120b` on the same pipeline 40/46.
The remote result shows the pipeline is not the main limit. The
[failure audit and experiments](audit.md) records every step. Development fixture
wording may guide experiments; holdout wording must remain excluded.
