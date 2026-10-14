# AI usage and evaluation

## Text entry with remote or local AI

On **Lab → AI for Create by intent**, choose **Remote API** or **Local WebGPU**.
Both use the same MLP extraction, response validation and ledger operations.
The model selects actions and account types and extracts names and amounts
without receiving ledger IDs. The host validates, applies defaults, resolves
references and executes the reviewed plan. Names are resolved against local accounts.
Missing or ambiguous accounts stop the request; expenses never create accounts
implicitly. Multiple actions commit in one transaction: a failed step rolls back
the entire request. Images/OCR are not included.

Remote mode uses your saved OpenAI-compatible **Responses** base URL,
model and key in **API keys**. Local mode uses the pinned Everything WebGPU
0.1.3 GitHub release package and its official SDK **Responses text subset**.
Both call `responses.create()` with the same text-only request parameters,
then validate the returned text as JSON with Zod. Endpoints that support only
Chat Completions cannot be used. Selecting local never falls back to a remote provider.

The default URL model is [Qwen3.8-2B-q4f16_1-MLC](https://huggingface.co/nyaaorick/Qwen3.8-2B-q4f16_1-MLC), with its matching WASM in the same repository. Its compiled configuration disables thinking.

For **Model URL**, enter an ID, the model directory URL (use an explicit
`/resolve/main/` or other revision path), and its matching compiled WebGPU WASM
URL. Both hosts must allow CORS. **Save and load model** downloads files into
browser cache, reports progress, then initializes WebGPU. For **Local model
folder**, select compiled MLC/WebLLM artifacts containing `mlc-chat-config.json`,
`tensor-cache.json` (or `ndarray-cache.json`), every referenced weight shard, a
configured tokenizer, and exactly one matching WebGPU `.wasm`. Files are copied
to browser Cache Storage, never uploaded. Raw GGUF/safetensors are unsupported.

Load the model before running text entry. The runtime stays loaded across Lab
navigation and repeated requests. **Cancel loading** or **Cancel generation**
stops pending work; **Release model** or switching back to remote frees the
Worker/GPU while retaining cached artifacts. After page reload, load again; a
cached folder can be reused without selecting files unless storage was evicted.
Import the original folder again after eviction.

AI selection and source configuration are device-local and excluded from ledger
sync, as are API keys. Model caches are origin-specific and can consume substantial
storage. Local inference requires WebGPU, IndexedDB, Cache Storage and HTTPS or
localhost; there is no CPU fallback. Browser/GPU support and model capacity must
be checked on the target device. Firefox may require WebGPU preferences; iOS
Safari support is not established by a successful PWA build.

## Real-model AI harness

Run `npm run harness:ai -- --help` for options. The default downloads the configured
Qwen3.8 model directly from Hugging Face and runs visible Edge on the host GPU:

```sh
npm run harness:ai
npm run harness:ai -- --browser firefox --folder /path/to/Qwen3.8-2B-q4f16_1-MLC
npm run harness:ai -- --folder /path/to/model --repeat 3
npm run harness:ai -- --folder /path/to/model --mode extraction
```

Use `FOLIO_AI_BROWSER_PATH` for other installed browser locations. The runner uses
its own browser profile and origin (`127.0.0.1:4175`), resets a synthetic ledger for
each fixture, and calls the production Responses/extraction/actions against real
PGlite. It never reuses a personal browser profile. This evaluates inference and
ledger execution; it is separate from PWA/extension UI and offline verification.
Firefox's test profile enables WebGPU explicitly.

JSON reports and screenshots are under `.artifacts/ai/` (gitignored). Reports
include case expectations, actual rows, timings, rejection reasons, production source hashes,
Responses call counts, prompt character counts and MLP context selection counts. Token
usage is reported only when Responses provides it; missing usage remains `null`. Ledger
failures and infrastructure failures return exit code 1. `--mode extraction` is
a read-only draft evaluation; reports score plan accuracy separately from ledger results.
Expected missing/ambiguous-account rejections are accepted only with their specific reason. Fixtures
cover Chinese names, cash/card spending, repayment, explicit multi-step creation,
missing/duplicate accounts, atomic rollback, greetings, negation and cancellation.
Each scenario has independent setup; use repeats to measure variability. Passing
this finite set does not establish general natural-language accuracy.

Text entry sends the original request to the model for semantic planning: account
creation, spending, transfers and dependent steps (up to eight). There is no verb
keyword router or required clause separator. Account opening defaults to ASSET/USD
and balance 0; initial debt is stored as a negative LIABILITY balance without
transaction rows. Transfers accept a numeric amount or `"all"`; the latter reads
and locks the source balance inside the writing transaction, after earlier steps.
Zero available balance fails; cross-currency transfers need an explicit target amount.
Missing execution information returns a clarification question without writes.

The model returns one JSON envelope: `{"steps":[flat action objects]}`,
`{"steps":[]}` for no operation, or `{"clarification":"question"}`. Unknown
fields, malformed JSON, trailing explanation, ambiguous references and invented
nonzero amounts fail validation. Validation does not prove semantic correctness.

Every request follows **Describe → Review → Save → Receipt**. Preparation is
read-only. Review cards expose names, account types, currencies, amounts and account
selections; initial debt is shown as amount owed. Editing the request invalidates
its draft. Save executes the reviewed fields without another model call.

`prepareIntentDraft` and `commitIntentDraft` in
[`features/ai/application/intent-draft-actions.ts`](../application/intent-draft-actions.ts) replace
the combined execution boundary. Drafts live in page memory with private baseline
state. Save rechecks permissions and referenced account state inside Tx. Changed
accounts or balances require a refreshed preview and another explicit Save.
Concurrent/repeated saves of the same draft are blocked; failed/cancelled saves
roll back every step. There is no automatic retry, fallback or undo.

No MCP or vector database is required for the current account lookup.

## MLP and the action registry

[`features/ai/protocol/action-registry.ts`](../protocol/action-registry.ts) defines the three text-entry
capabilities: account creation, spending and transfers/repayment. Each definition
owns its extraction schema, normalized input schema, result schema, availability,
normalization and `Tx` executor. Names, descriptions, schemas and behavior annotations
follow the concepts in the [MCP tool specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
This is an in-process project API, not an MCP server or a claim of MCP compatibility.
All registered actions write the ledger, are not idempotent, and have no automatic undo.
Annotations describe behavior; executable validation and database constraints enforce it.

[`features/ai/protocol/mlp.ts`](../protocol/mlp.ts) is the small-model view of that registry:

- Offer registry capabilities according to real permissions and business preconditions,
  allowing creation followed by dependent operations. The model selects only offered actions.
- Compile compact field descriptions for every available registry action.
  The model supplies names, account types,
  currencies, amount semantics and ordered steps. Host defaults and strict schemas normalize them.
- Include all eligible accounts when they fit; otherwise select literal mentions without
  truncating duplicates. The limit is eight candidates and 320 serialized name characters.
  Registry context has a 2,000-character budget and the original request a 4,000-character
  budget. These are character limits, not guarantees about a model's token window.
- Use one Responses request for semantic understanding and the complete ordered
  plan. There is no preliminary classifier, keyword intent router or repair loop.
  Behavioral rules live in instructions; input contains the original request and
  bounded account context. Host schemas supply deterministic defaults.

The model selects a registered action; it cannot supply executable code. The host validates amounts and names,
resolves private aliases, and executes through the registry in one transaction.
Executors recheck relevant account state inside that transaction; cancellation during
execution throws to roll back, including cancellation after the final write.
Draft preparation and commit are application boundaries, not additional action directories.
A future MCP adapter can expose the same registry separately, with its own transport;
MLP does not need to become an MCP client.

Compare two ledger reports from the same browser version, GPU, model, fixtures and
repeat count:

```sh
node features/ai/eval/compare.mjs .artifacts/ai/before.json .artifacts/ai/after.json
```

The comparison reports correctness, call and character totals, token totals when available,
and p50/p95 case time. Case time includes host checks, expected refusals and cancellation;
model loading is excluded. Preserve the baseline before changing production source.
Fixture success is regression evidence, not general natural-language accuracy.

### Seeded bilingual semantic evaluation

`features/ai/eval/natural-cases.ts` generates 12 reproducible random variants across English
and Chinese opening/all-transfer groups, plus 13 targeted scenarios (46 total with
the existing fixtures). Use `--seed 20261012` to select a reproducible sample. The seed,
actual natural-language inputs, expected ledger rows and results are saved in reports.
These evaluation templates are not included in the model prompt. They include
`set a new chase account, with 300 assest`, Chinese colloquial expressions,
initial debt, spending, dependent steps, negation and missing information.
They are development regression cases, not a claim of general-language accuracy.

### Recovery evaluation gates

```sh
npm run harness:ai -- --browser edge --seed 20261012 --repeat 3
npm run harness:ai -- --browser firefox --seed 20261012 --repeat 3
npm run harness:ai -- --browser edge --suite holdout
npm run harness:ai -- --browser firefox --suite holdout
```

The regression suite retains 46 cases and requires at least 95% plan accuracy,
with every critical name/debt/negation/dependent-step/clarification case passing.
The separate 100-case English/Chinese evaluation uses wording excluded from prompt
tuning and requires at least 90%, with no executable negative/hypothetical plans.
`expected-plans.ts` compares the exact action sequence, names, account type/currency,
opening balance/credit limit, numeric versus all amounts, explicit target amounts
and explicitly requested memos. Unrequested optional memo/category/date wording is
not scored; these are finite operational-plan tests, not proof of general accuracy.
The cancellation case tests the host contract rather than language recognition.

Reports separate plan correctness, save correctness, preparation writes, format,
semantic, validation and database failures. The feature remains experimental until
these gates pass; a review screen preventing a write does not turn an incorrect
model draft into a passing case.

The macOS harness prevents idle sleep while active. Keep the lid open for GPU
evaluations; a sleeping device can invalidate browser sessions and time budgets.
Use `npm run ai:results --` with four complete report paths to generate
the combined acceptance report. Interrupted runs are excluded.

The 2026-10-14 recovery evaluation failed every accuracy gate: Edge regression
28/138, Firefox regression 35/138; bilingual holdout Edge 46/100, Firefox 44/100.
Preparation wrote nothing across 476 cases. Holdout negations produced one
executable draft in Edge and three in Firefox. The feature remains experimental;
explicit review and Save do not constitute recognition recovery. Full inputs,
failures, timing and provenance are in `.artifacts/ai/recovery-report.md`.
