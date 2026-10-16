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

The bullets below describe the frozen 0.1.3 baseline. The 0.1.4 native-JSON
contract is in the [module README](../README.md#native-json-output-everything-webgpu-014),
and its measured results are under "Native JSON Schema output" below.

- [MLP](../../features/ai/protocol/mlp.ts) puts behavior in `instructions`, request/account context
  in `input`, exposes all three permitted registry actions, and performs one call.
  It strips only an empty leading think block or a whole JSON fence. It does not
  extract JSON from trailing prose or perform a repair call.
- [Text client](../../features/ai/providers/text-client.ts) sends `temperature:0`,
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
| Root README AI guide | Module README and failure audit; historical checkpoints remain in Git |

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

- Versioned all 476 baseline records, 46/100 fixture inventories, seven observed
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
| Done | Grammar/JSON-schema constrained decoding through the supported Responses interface (everything-webgpu 0.1.4) | Implemented; see "Native JSON Schema output". Valid JSON alone did not pass semantic tests. |
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

## Evaluator hardening and maintenance trim

Scoring version 2 fixes three review findings: successful requests need validated
ready drafts, correct plans must save correctly before ledger acceptance can pass,
and comparisons must preserve scoring version and all expected plans. Batch success
also requires zero runner exit codes. Historical version 1 results are preserved;
they were not rerun or retroactively corrected. Shared comparison validation and one
`ai:report` CLI replace separate report/diagnosis/comparison entry points. The module
README is the maintained usage guide; historical checklists live in Git. Review-field
controls are separated from page lifecycle and save state, without prompt changes.

## Native JSON Schema output (everything-webgpu 0.1.4, 2026-10-15)

Contract: see the [module README](../README.md#native-json-output-everything-webgpu-014).
Same model (Qwen3.8-2B-q4f16_1-MLC), seed 20261012, Edge 155.0.4283.45 and Firefox
157.0.1 on the same Apple M4. Browser versions match the frozen baseline. Reports
are labeled `everything-webgpu 0.1.4, json_schema:strict` from the format each
endpoint echoed. The baseline stays labeled 0.1.3 plain text.

| Suite | 0.1.3 plans | 0.1.4 plans | Format | Semantic | DB | Forbidden / executable no-action | Prep writes | Calls | Planning p50 / p95 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Edge regression ×3 | 28/138 | 30/138 | 73 → 9 | 37 → 99 | 0 | 3/0 → 15/0 | 0 | 138 | 5.3 s / 30.9 s |
| Firefox regression ×3 | 35/138 | 33/138 | 67 → 9 | 36 → 96 | 0 | 3/0 → 15/0 | 0 | 138 | 11.4 s / 61.0 s |
| Edge holdout | 46/100 | incomplete: 1/23 (0.1.3 same 23: 11/23) | 7 | 15 | 0 | 2/0 | 0 | 23 | — |
| Firefox holdout | 44/100 | not measured | — | — | — | — | — | — | — |

All gates fail; the feature remains Experimental. Both browsers fail the same 14 of
20 critical cases in all three repetitions. Grammar plus temperature 0 makes the
failures deterministic. All 9 regression format failures, and the 7 holdout ones,
are `format/constraint-outside-decoder-subset`: well-formed JSON with a 0 amount,
which the decoder cannot forbid. No invalid JSON, combined envelope or wrong root
was emitted. Commit made no model calls. Every correct plan saved correctly.

The syntax failures became semantic failures. The dominant new pattern is a leading
`create_account` for an account that already exists (`action-order` Edge 30 / Firefox 33,
`ungrounded-name` 18). Every regression negation/question/hypothetical/greeting
case now proposes one; validation blocks all of them, so none is executable. Strict
mode makes the model fill every optional field with a value rather than null. That
includes an invented `reward_currency` (MR/RC), which exact-plan scoring does not
cover, so some "passing" openings would save an unrequested reward currency.
Single-run development A/B on Edge regression: strict 10/46 versus non-strict
(optional fields omittable) 10/46. Even with omission allowed, the model still
filled the fields. Strict was kept for its cross-provider guarantee.

Holdout infrastructure: the batch Edge holdout lost its renderer frame after 23
cases (`Attempted to use detached Frame`, no console errors). The two reruns then
stalled in `Generating…`: Edge on case 1 and Firefox on case 2, each for the full
60-minute budget. The harness's 90 s per-case abort did not end either generation,
although 0.1.4 rejects an aborted foreground request immediately
(`responses.js:232`), so the hang is below the request layer. (An earlier note that a
3-case smoke also stalled was wrong: macOS has no `timeout` command, so it never ran.
The next day the same smoke passed.) A later Edge regression run also detached at
case 33; that case passed alone, and a full rerun completed. Treat this as an
unresolved, intermittent environment fault: a GPU/renderer crash, with no crash dump
written. Rerun both holdouts with `npm run harness:ai -- --browser edge|firefox
--suite holdout --seed 20261012` after a browser/GPU reset.

Next single-factor experiments, regression wording only:
1. Put a no-action/clarification cue in semantic words, without JSON shapes.
2. Change action branch order, or put the discriminator after the fields, to test
   the `create_account` bias.
3. Use non-strict locally with the same schema, to cut forced optional fields.
4. Test whether cancellation reaches a stalled WebGPU decode.

## Planner view and intent-first wire (single-factor, Edge regression ×1, 2026-10-15)

Generation is deterministic (identical failures in all three repetitions above), so
one repetition per step is used for attribution. Baseline is repetition 1 of the
0.1.4 run above.

| Step | Plans | Format | Opens / spends / transfers proposed (expected 21/9/10) | Wrong create of existing account | None / clarify correct | Forbidden / executable no-action | Invented reward | 8-step loops |
|---|---:|---:|---|---:|---|---|---:|---:|
| Baseline | 10/46 | 3 | 70 / 3 / 2 | 22 | 1/6, 0/4 | 5 / 0 | 39 | 4 |
| C: registry `plannerFields` view | 12/46 | 10 | 56 / 7 / 4 | 14 | 1/6, 0/4 | 4 / 0 | 0 | 3 |
| C+B: `intent` first, shape-enforcing branches | 18/46 | 0 | 82 / 2 / 6 | 17 | 0/6, 0/4 | 6 / **1** | 0 | 6 |

- C removed every invented reward currency and reduced false creates. 9 of its 10
  format failures are transfers with `targetAmount: 0`: strict mode forces a value,
  and the decoder cannot express a positive number. They are not repaired.
  `asset-expense` expects a memo, which is no longer extracted, so it cannot pass.
- B made the grammar enforce plan shape: none has no steps, ask has only a question,
  a single-action intent admits only that action, and multi needs two or more steps.
  The package validator rejects every inconsistent shape. Accuracy rose through
  opens (10/12), but the model never chose `none` or `ask`.
  `natural-question` (a hypothetical "what if I move everything…? don't do it yet")
  produced a valid transfer-all draft that saved in ledger mode, which is a hard gate
  violation. `transfer-without-amount` also invented `"all"` and saved.
- The no-executable-negative-draft hard gate and its stop rule were later dropped
  (personal ledger; Review → Save, atomic rollback, stale checks and Zod validation
  protect correctness). Such drafts remain plan failures and stay reported.

### C+B+A: four semantic examples (Edge regression ×1)

`compile()` gained four placeholder-name examples, one per line as "request →
intent and parameters", with no JSON syntax or field spelling: transfer-all (EN),
spend (ZH), none for a question (EN), ask for a missing amount (ZH). Instructions
1914/2000 characters.

| Step | Plans | Format | Opens / spends / transfers proposed (expected 21/9/10) | Wrong create of existing account | None / clarify correct | Forbidden / executable no-action | Over-long plans (8-step) | p50 planning ms |
|---|---:|---:|---|---:|---|---|---:|---:|
| C | 12/46 | 10 | 56 / 7 / 4 | 14 | 1/6, 0/4 | 4 / 0 | 13 (3) | 5757 |
| C+B | 18/46 | 0 | 82 / 2 / 6 | 17 | 0/6, 0/4 | 6 / 1 | 19 (6) | 5236 |
| C+B+A | 21/46 | 2 | 62 / 6 / 8 | 6 | 2/6, 0/4 | 3 / 0 | 12 (5) | 5765 |

Per intent (C+B → C+B+A): open 10→7/12, transfer-all 1→4/7, debt 3→2/4, spend 1→2/4,
none 0→2/6, reject 2→3/5; multi 0/2, clarify 0/4 and plain transfer 0/1 unchanged.
Failure kinds: format 2 (both `targetAmount: 0`), semantic 23, validation 0, database 0.
The examples cut false creates of existing accounts (17→6) and moved choices toward
spend/transfer/none, at a cost of three openings. `ask` was still never chosen.

### C+B+A full evaluation (2026-10-15)

Complete repetitions only. The Firefox regression batch stalled in `Generating…` at
repetition 2, case 23. Its complete repetition 1 was retained and merged with a full
×2 rerun. The first Firefox holdout lost its frame after 51 cases and was rerun whole.

| Browser / suite | Plans | Frozen 0.1.3 | First 0.1.4 | Format / semantic | Forbidden / executable no-action | p50 ms | Gate |
|---|---:|---:|---:|---|---|---:|---|
| Edge regression ×3 | 65/138 | 28/138 | 30/138 | 6 / 67 | 9 / 0 | 6050 | FAIL |
| Firefox regression ×3 | 62/138 | 35/138 | 33/138 | 7 / 69 | 9 / 0 | 12201 | FAIL |
| Edge holdout ×1 | 48/100 | 46/100 | none complete | 5 / 47 | 0 / 0 | 6426 | FAIL |
| Firefox holdout ×1 | 50/100 | 44/100 | none complete | 4 / 46 | 0 / 0 | 12524 | FAIL |

Preparation wrote 0 rows. Every case made exactly one planning call, and Save made
none. 14 of the 20 critical cases failed in both browsers: natural-user-typo,
natural-debt-en, natural-sequence, natural-question, natural-missing-target,
natural-cross-currency, default-opening, opening-synonym, opening-inquiry,
opening-hypothesis, expense-without-amount, transfer-without-amount, liability-account,
create-and-spend. Status remains Experimental.

### Review fixes on C+B+A (Edge regression ×1)

- Memo (expense, transfer) and reward currency (create) are planner fields again.
  An unstated value is dropped from the draft before review (`STATED_FIELDS`), so the
  model's invented MR/RC never reached a draft. In this run they appeared only in
  raw outputs that failed validation for other reasons.
- A same-kind `multi` is a format failure. A missing `text.format` echo is accepted.
  Acceptance is versioned separately from plan scoring (acceptance 3, scoring 2).

| Step | Plans | Format | Opens / spends / transfers proposed (expected 21/9/10) | Wrong create of existing account | None / clarify correct | Over-long plans (8-step) | p50 planning ms |
|---|---:|---:|---|---:|---|---:|---:|
| C+B+A | 21/46 | 2 | 62 / 6 / 8 | 6 | 2/6, 0/4 | 12 (5) | 5765 |
| + review fixes | 25/46 | 1 | 25 / 6 / 10 | 5 | 3/6, 0/4 | 7 (0) | 6567 |

Newly passing: asset-expense (memo), natural-all-en-3, natural-all-zh-2,
natural-question; none regressed. `liability-account` emitted the example placeholder
"Acorn Jar" (rejected by grounding): the examples leak into outputs. Not yet
measured ×3 or on holdout.

### Remote comparison: Groq gpt-oss-120b on the same pipeline (Edge regression ×1)

`run.mjs --remote` runs the unchanged Responses pipeline against the endpoint in the
gitignored `config.json`, pacing cases to the provider's token limit and ending a
repetition on a 429. Groq validates strict `json_schema` after generation and rejects
a `number | "all"` field even for valid output (it cannot disambiguate the union), so
transfer was split into `transfer` and `transfer_all` planner views. A Groq
`json_validate_failed` 400 is now a `format` failure carrying `failed_generation`.

| Run (same commit) | Plans | Format | transfer-all | multi | none / clarify | False creates | p50 ms |
|---|---:|---:|---|---|---|---:|---:|
| Local, before split | 25/46 | 1 | 6/7 | 0/2 | 3/6, 0/4 | 5 | 6567 |
| Local, split | 18/46 | 10 | 0/7 | 0/2 | 2/6, 0/4 | 4 | 3644 |
| Remote, split | 40/46 | 0 | 7/7 | 2/2 | 4/6, 4/4 | 0 | 1875 |

The pipeline is not the main limit: the remote model passes 87% with the same prompt,
schema and checks. The split costs the local model 7 cases: it chose `transfer` with
`amount: 0` (which the decoder cannot exclude) instead of `transfer_all`. Remote
failures: default-opening (amex as LIABILITY), opening-inquiry (asked instead of
none), opening-hypothesis, opening-duplicate, missing-account (asked instead of a
rejected draft), after-cancel (kept the name suffix).

### Schema dedup

Step schemas are emitted once under `$defs` and referenced; `description`/`id` are
dropped from the wire (meanings are in the instructions). Schema 7523 → 3772
characters. Groq, same request: 2489 → 1656 input tokens (instructions and request
alone: 582), identical output. Local Edge regression ×1: 18 → 18 plans, 44/46
byte-identical outputs (the other two fail either way), p50 3644 → 3654 ms.

### Zero amounts read as transfer_all (local Edge regression ×1)

The local decoder cannot exclude 0, and after the transfer split the local model wrote
`transfer` with `amount: 0` and `targetAmount: 0` instead of `transfer_all`. `fromWire`
now reads a transfer amount of 0 as `transfer_all` and a received amount of 0 as
unstated. 18 → 25/46. Format failures 10 → 0. transfer-all 0/7 → 6/7. Newly passing:
natural-all-en-2/3, natural-all-zh-1/2/3, natural-user-all, natural-zero.

Cost: `transfer-without-amount` (no amount stated; expected: ask) now becomes a
transfer-all draft, and the harness saved it in ledger mode. In the app it still
requires Review → Save. It already failed before the change, as a format error.

### Regression set v2 and partial-name matching (2026-10-16)

The 46-case set was a third edge cases, had one stated-amount transfer and no
partial-name matching. It was replaced by 57 explicit cases weighted to everyday use
(manifest version 2; see the README's fixture expectations). Earlier results above
are on the old set and are not comparable. An existing account may now be named by a
part only it has (`chase` → chase checking); the draft carries the full name, and
grounding accepts a distinctive part. Card brands open as LIABILITY. A 0 transfer
reads as `transfer_all`. The seed parameter was removed with the seeded generator.

First local Edge regression ×1 on set v2: 35/57 plans, 13/20 critical, 0 format and
0 preparation writes, p50 6653 ms. By group: transfer 13/15, create 8/14, spend 7/8,
match 4/7, multi 0/6, edge 3/7. The dominant failure is stopping after the first
step: create-several, multi-create-spend and multi-three each kept only their first
step. Others: card/asset type swaps (BoA Checking as LIABILITY, Chase Sapphire as
ASSET), re-creating an existing account instead of using it (spend-memo-en,
match-part-zh, multi-repay-spend-en), and the received amount used as the sent amount
(transfer-cross-en). After this run, multi-two-transfers-zh was made unambiguous; its
second source was unstated, and the model's reading was valid.

### Intent-first variants on the core suite (Edge, 2 runs each, 2026-10-16)

Raw outputs (now kept for every call) showed `multi-three-en` writing intent `create`
and stopping after one step, which looked like B's per-action lock. Two variants
were measured and reverted:

| Wire intent | Core plans (run 1 / run 2) | Notes |
|---|---|---|
| B: create/spend/transfer lock steps to that action; multi for mixes | 5/10 (earlier run) | baseline |
| none / ask / plan (any mix) | 1/10 / 1/10 | the model chose ask or none for almost everything, including "从现金钱包转300到招商银行" |
| create/spend/transfer, any mix of steps | 4/10 / 4/10 | transfer-all-en-1 regressed: intent transfer but a create_account step, which B's lock forbids |

In both variants `multi-three-en` still stopped after its first step, so the lock is
not why multi-step plans end early; the local model ends after one step. The
action-named first token matters: an abstract `plan` label collapsed the model onto
ask/none. B stays.
