# AI integration history

Historical checkpoints; current interfaces and commands are in ../README.md.

### Local text AI integration

- [x] Pin the Everything WebGPU 0.1.3 release tarball and official OpenAI 6.49.0 SDK.
- [x] Remote and local use the same text-only Responses request, prompt and validation; no Chat Completions adapter.
- [x] Device-local backend selection, model URLs with a matching WASM, and compiled MLC folder import on Lab.
- [x] Visible download/import progress, cancellation, runtime reuse and GPU release.
- [x] Commit multi-step createByIntent plans atomically; preserve single-writer enforcement.
- [x] Keep model caches when the PWA replaces its app shell.

### Small-model extraction and real-machine harness

- [x] Host-selected single-operation extraction; keep IDs, type, currency and date handling in application code.
- [x] Retrieve literal candidate names locally; reject absent/ambiguous accounts and implicit creation.
- [x] Independently seed real PGlite fixtures, verify rows/rollback/cancellation, report failures with a nonzero exit code.
- [x] Keep managed test profiles and reports separate from app origins and personal browser data.
- [x] Broader semantic evaluation completed on a separate 100-case bilingual set in each browser; accuracy gates failed.
- [ ] Production PWA Service Worker registration failure observed in Firefox remains a separate issue.

### Unified action registry and MLP

- [x] One action directory owns text extraction, normalized schemas, results, availability and Tx executors.
- [x] MLP compiles a filtered in-process view; no MCP transport, SDK dependency or compatibility adapter.
- [x] Limit fields and account context; stop on ambiguity, unknown fields or context budget overflow.
- [x] Use one Responses call for the complete semantic plan; expose all available actions without a preliminary classifier.
- [x] Recheck relevant account state and cancellation inside the writing transaction.
- [x] Instrument real-model harness with call/context/character counts and nullable token usage; compare controlled reports.
- [x] Model-owned semantic extraction replaces verb routing and host clause extraction; retain schema validation, literal name/amount grounding and database checks.
- [x] Account opening defaults to zero; initial debt creates no transaction rows. Use a canonical steps envelope for single and multiple actions.
- [x] Resolve all-transfer amounts from locked live balances inside Tx, after earlier steps.
- [x] Add seeded English/Chinese natural-language evaluations, exact user examples, negation and clarification checks.
- [ ] Local-model semantic regressions pass across Edge and Firefox; valid-looking incorrect actions remain failures.

### Semantic MLP validation (2026-10-11)

- [x] Compile, 147/147 real-PGlite tests and both production builds passed.
- [x] Fixed-output Responses UI verification passed 6/6; singleton objects and arrays supported.
- [x] Real Qwen bilingual evaluation seed 20261012 completed: Edge 21/46 and Firefox 21/46; the exact chase singleton opening passed in both.
- [ ] Semantic acceptance remains blocked by wrong names/types, negation, omitted steps and malformed output; schema-valid wrong writes count as failures.
- Local evaluation evidence: `.artifacts/ai/semantic-report.md` (ignored artifacts, regenerate with the harness).

### Intent recovery (2026-10-14)

- [x] Separate read-only preparation from explicit, atomic Save; no inference at commit.
- [x] Editable previews, visible defaults/debt, dependent all-balance estimates and readable receipts.
- [x] Private in-memory draft baselines; relevant state/permission checks in Tx; stale previews require refreshed review.
- [x] Prevent concurrent/repeated saves; cancel/rollback; friendly errors with collapsed diagnostics; remove cooldown.
- [x] Isolate PWA/extension Vite caches from model harnesses.
- [x] Compile, 149 tests and both builds pass; fixed-output UI checks pass 16/16 in PWA and 10/10 in installed Firefox extension.
- [x] Harness scores exact operation sequence/core parameters separately from save correctness; frozen 100-case bilingual holdout excludes prompt examples.
- [ ] Local-model recovery acceptance: 95% on 46 regression cases, three repeats per browser, all critical cases; 90% on holdout and no executable negative/hypothetical plans. Feature remains experimental on failure.

- Recovery verification complete: Edge regression 28/138, Firefox regression 35/138; bilingual holdout Edge 46/100, Firefox 44/100. All gates failed; feature remains experimental. Preparation writes: 0 across 476 cases. Executable no-action drafts: Edge holdout 1, Firefox holdout 3. Whole completed repetitions were retained after source verification; interrupted partial runs were excluded. Firefox's optional post-evaluation screenshot failed after all 100 holdout cases completed; the original error and full case data are retained. Evidence: `.artifacts/ai/recovery-report.md`.
