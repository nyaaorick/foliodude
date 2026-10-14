# AI consolidation plan

1. Audit reports, application/provider/runtime boundaries and shared dependencies.
2. Move AI-only application, protocol, provider, runtime, UI and tests to features/ai. Preserve inference behavior. Keep shared ledger actions, SQL, secrets storage and general UI outside. Extract AI endpoint fields and queries from mixed files.
3. Version the browser UI runner and report operations; remove machine paths and fixed ledger profiles. Keep model weights/profiles/reports in ignored artifacts.
4. Freeze regression/holdout definitions, replay observed format failures offline, enforce full coverage before acceptance, and unify report scoring/merging/recovery.
5. Validate typecheck, real PGlite tests, both builds, repeat UI runs and a bounded local-model migration smoke. Publish evidence-based diagnosis and prioritized experiments; do not change production prompts/models or gates.

Thresholds: 95% regression with all critical cases; 90% holdout with no executable no-action plans. Existing accuracy failure stays Experimental. No schema/dependency/model changes, transport, publishing or merging.
