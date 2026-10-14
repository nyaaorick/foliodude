# Failure audit, ownership and recovery experiments

## Evidence and confirmed failure mechanisms

The immutable baseline contains 476 cases: Edge regression 28/138 correct plans,
Firefox regression 35/138; separate bilingual sets Edge 46/100, Firefox 44/100.
All four gates failed. Preparation wrote zero rows. Four no-action requests produced
executable drafts in the holdout (Edge 1, Firefox 3); the harness explicitly saved
them only in synthetic ledgers. Correct transaction execution can therefore still
produce the wrong intended ledger outcome. Schema validity is not intent validity.

Of 323 failed cases, 227 (70.3%) were labeled format failures:

| Output defect | Cases | Mechanism |
|---|---:|---|
| Invalid JSON / prose outside the JSON object | 105 | Whole-output parsing rejects trailing explanations, malformed output or non-JSON |
| Both `steps` and `clarification` | 61 | The two strict envelopes are mutually exclusive |
| Wrong root envelope | 24 | Arrays/single actions/other root shapes fail the envelope contract |
| Invalid schema fields | 37 | Types, required fields, unknown keys or enums fail strict registry-derived schemas |

The original scorer labeled 96 failures semantic. Offline subdivision found:
action/order errors 24, missing clarification 22, wrong parameters/response 18,
ungrounded names 12, empty plans 9, blocked no-action proposals 6, executable
no-action drafts 4, and one aborted request. The aborted request remains a failure
and is identified as runtime evidence rather than proof of language misunderstanding.
Categories describe observed output; they do not prove a single model root cause.

Examples:

- `set a new chase account, with 300 assest` returned a fenced empty plan followed
  by `Brief explanation of what was done.` Its complete output is not valid JSON.
- Debt/negation examples emitted both envelope keys, rejected by the strict union.
- `“备用口袋 1”里的钱保持原样，千万不要打入“港湾存款 1”。` produced an all-transfer
  in Edge's held-out run. Names and account references were valid, so ordinary
  schema/grounding/database checks could not detect the reversed meaning.

The prior two-call baseline scored 21/46 ledger outcomes per browser, not exact
plans; it lacks sufficient raw extraction data for a direct exact-plan rescore.
Current timings cannot establish a controlled speed improvement: initial browser
runs overlapped GPU work. Case-call counts exclude the model's one-token loading
warmup and excluded interrupted runs.

## What source inspection establishes

- [MLP](../protocol/mlp.ts) puts behavior in `instructions`, request/account context
  in `input`, exposes all three permitted registry actions, and performs one call.
  It strips only an empty leading think block or a whole JSON fence. It does not
  extract JSON from trailing prose or perform a repair call.
- [Text client](../providers/text-client.ts) sends `temperature:0`,
  `max_output_tokens:2048`, `store:false` to both Responses backends. Remote SDK
  retries are disabled. Local/remote selection has no silent fallback.
- Installed `everything-webgpu/src/engine/responses.js` prepends `instructions`
  as a system message and forwards generation options to `completeRaw`.
  `engine.js` uses nullish defaults, so numeric temperature zero is preserved.
  There is no observed evidence that the application drops system instructions
  or accidentally uses the published temperature 0.6.
- Version 0.1.3's transport accepts plain `text.format.type=text` and rejects
  JSON Schema/JSON mode and nonempty tools. The model currently generates free
  text; prompt instructions alone do not constrain its decoder to valid JSON.
  The Responses transport has no brace-based stop parameter. Stopping at the
  first closing brace would truncate nested/multiple actions anyway.
- The current [published model configuration](https://huggingface.co/nyaaorick/Qwen3.8-2B-q4f16_1-MLC/resolve/main/mlc-chat-config.json),
  copied to [a read-only snapshot](model-config-snapshot.json), declares
  `model_type=qwen3_5`, template `qwen3_5_nothink`, context window 4096 and prefill
  chunk 1024. Assistant prefix includes an empty think block. The repository
  name and WASM filename alone cannot establish checkpoint/template compatibility.
  This mutable published configuration does not prove what earlier caches loaded.
  Effective WASM metadata/tokenizer parity still needs a controlled verification.
- Registry schemas normalize defaults and resolve names/host aliases. Source
  grounding is case-normalized substring/digit checking; it is not a semantic
  negation detector. Save rechecks private snapshots/permissions inside Tx and
  delegates SQL-relative writes to shared ledger helpers.

## Plausible causes requiring experiments

1. The prompt first says “only a steps array” and then permits a clarification-only
   object. Together with two root shapes and many optional fields, this may
   contribute to mixed envelopes. The 61 observations support testing it, not a
   claim that this wording caused all 61 failures.
2. A single call now chooses actions, interprets negation/debt, preserves names,
   emits typed JSON and orders dependencies. Three tools and all category/currency
   choices may exceed this model's reliable instruction-following capacity.
   “One call” reduces rounds; it does not prove lower cognitive load.
3. Character budgets are not token counts. Effective prompt length, output budget,
   stop behavior, template/tokenizer compatibility and cold versus reused runtime
   may matter. No context-overflow or cache-corruption cause was established.
4. Tiny models may not reliably distinguish negated/hypothetical requests even
   with valid output formatting. Four executable negative drafts demonstrate
   that formatting-only improvements cannot satisfy acceptance alone.

## Ownership and migration

| Previous location | Current owner |
|---|---|
| `lib/ai/mlp.ts`, `action-registry.ts` | `features/ai/protocol/` |
| `lib/ai/intent-draft.ts`, intent/settings action files | `features/ai/application/` |
| `lib/ai/text-client.ts` | `features/ai/providers/` |
| `lib/ai/local-runtime.ts`, `config.ts` | `features/ai/runtime/`, module `config.ts` |
| Lab intent/settings components and LLM-only credential form | `features/ai/ui/` |
| Intent tests and LLM-specific endpoint assertions | `features/ai/tests/` |
| `test/ai/*`, ignored UI/report helper logic | `features/ai/eval/` |
| Root README AI-only guide and PLAN AI-only history | Module README and `docs/` |

`pages/lab.tsx` is assembly only. The shared API-key section delegates its LLM
slot to the AI UI; FX/Finnhub form behavior stays shared. AI endpoint validation
and lookup are local to the module, while `device_secrets`, `device_ai_settings`,
schema/backup exclusion, session, writer permissions and ordinary business actions
remain shared integration points. Build CSP/worker and Service Worker integration
remain target-level configuration. Dependency internals and caches are not copied.

No old-path compatibility files were retained. Thirteen core/UI/fixture file bodies
were compared with the pre-migration snapshot: only import paths changed. Provider
endpoint lookup moved without changing its SQL/request contract; endpoint UI and
validation were split from mixed files and verified in both targets.

## Repeatability fixes

- Versioned all 476 baseline records, 46/100 fixture inventories, eight observed
  format outputs, UI runner, scoring, diagnosis, report retention/merge and batch
  drivers. Generated artifacts remain ignored.
- Removed machine-specific `/@fs` paths and persistent UI ledgers. Every UI run
  uses a new managed profile; PWA starts its own test server/cache directory.
  Canonical `/@fs` paths share the application's DB singleton.
- Full ordered IDs, unique coverage, completion and regression repetition count
  now gate acceptance. A 3/3 diagnostic subset cannot become a recovery pass.
- Model errors, evaluation infrastructure errors and optional screenshot errors
  are separate. Whole repetitions only may be retained; originals are never
  overwritten. Current-source hashes are required when certifying retained data.
- Deterministic verification records actual test/build/UI results, rather than
  hardcoding a historical test count. Offline diagnosis reproduces old failures.

## Prioritized solutions — proposals, not implemented tuning

| Priority | Experiment | Benefit / cost / acceptance evidence |
|---|---|---|
| P0 | Audit actual tokenizer, source chat template, rendered tokens, special stop IDs and effective WASM/context metadata; compare cold/reused identical requests | Rules out conversion/runtime faults; moderate inspection cost. Require recorded artifact hashes and golden token/render checks. Do not infer from filenames. |
| P1 | Trial one consistent root envelope and remove conflicting root instructions; compile a minimal planner view from registry fields, retain full editor/business schemas | Targets 61 envelope and some field errors; low/moderate cost. Keep three actions and defaults; compare the same regression inputs with only this factor changed. |
| P1 | Verify grammar/JSON-schema constrained decoding through a future supported Responses interface | Targets syntax/schema failures; requires dependency work because pinned 0.1.3 rejects it. No hidden raw-engine or Chat Completions bypass. Valid JSON alone must still pass semantic tests. |
| P2 | Trial balanced generic examples for negation, initial debt, clarification and dependencies; test generation budget/stop settings separately | Targets semantic failures; low experiment cost but possible prompt growth/overfitting. Tune only development regressions; holdout remains untouched. |
| P2 | Record effective prompt/output tokens and raw response completion status; compare equivalent compact versus full planner contexts | Tests context/output-budget hypothesis; moderate instrumentation cost. Preserve privacy of normal user telemetry and retain synthetic raw outputs only in explicit evaluation. |
| P3 | Consider retrieval only when account counts/aliases exceed literal bounded context | Addresses missing context, not malformed JSON or reversed negation. No evidence that RAG explains these named-account fixtures; requires explicit ambiguity handling. |
| P3 | Add MCP only for external agent/third-party interoperability needs | Transport/discovery does not constrain this decoder. Preserve registry → MLP/MCP parallel views; no local MCP round trip. Not an accuracy recovery experiment by itself. |

Run one factor at a time against the fixed regression corpus. Report format,
semantics, executable negatives, call count and latency independently. Use the
independent set only for final validation; do not lower 95%/90% or drop difficult
cases. Model replacement, tuning/training and dependency changes need a separate
scope decision. The review/Save boundary and Experimental label stay in place.

## Verification limits

Consolidation passed 152 tests, typecheck, both builds and two consecutive UI runs
per target (52 fixed-output checks). Real Edge migration smoke passed 3/3 with
three planning calls and zero preparation writes. It verifies loading/imports and
the migrated plan/save path, not restored recognition accuracy. Full 476-case GPU
evaluation was not repeated for import-only migration; its frozen failure evidence
and gates remain unchanged. Full reruns are available through `ai:eval -- --full`.
