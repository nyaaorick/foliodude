# AI intent module

All AI-owned application code, protocol/registry, providers, runtime, UI, tests,
evaluation fixtures and documentation live here. Lab and the shared API-key
section assemble this module. Shared ledger actions, PGlite/SQL, secret storage,
sync permissions and general UI remain in their existing modules.

```text
ui/intent-entry → application/intent-draft-actions
  prepare → protocol/mlp → providers/text-client
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

Planning uses one Responses request. Save and refresh use none. Drafts are private
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
| `npm run ai:results -- --baseline --verification FILE` | Frozen four-suite report plus actual application verification |
| `npm run ai:diagnose` | Offline classification of all 476 frozen baseline records; writes a new diagnostic report |
| `npm run ai:diagnose -- REPORT...` | Diagnose new reports using the same categories |
| `npm run ai:report -- summary REPORT` | Recompute full-coverage acceptance; failed gates return nonzero |
| `npm run ai:report -- retain REPORT --runs 1,3 --output NEW` | Retain whole complete repetitions with unchanged current source hashes; preserve originals and error provenance |
| `npm run ai:report -- merge REPORTS... --output NEW` | Merge compatible whole repetitions with matching model/fixtures/core sources |
| `node features/ai/eval/compare.mjs BEFORE AFTER` | Same browser/model/fixtures/repeat-count comparison, including plan versus ledger scores |

Export one comparable frozen report with `ai:report -- summary
features/ai/eval/fixtures/baseline.json --select edge/regression --output NEW`.
Failed historical gates intentionally return nonzero while still writing the report.
Diagnostic smoke exits successfully only when its selected cases pass; its
`acceptance.passed` remains false because coverage is incomplete.

Real-model acceptance is **95% regression**, all critical cases, at least three
complete repetitions; **90% holdout**, with no executable negative/hypothetical
drafts. The evaluator additionally rejects validation-blocked no-action proposals.
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
reports remain untouched in `.artifacts/ai/`. `observed-format.json` replays eight
actual regression outputs; it deliberately preserves rejection rather than silently
repairing invalid model output. Holdout wording is never used in production prompts
or prompt tuning. Successful raw outputs were not captured by the original harness;
normalized actions must not be described as their raw text.

Reports, screenshots, generated logs, profiles and model caches stay in ignored
`.artifacts/ai/`; model weights do not belong in this source directory. Runtime
adapter source stays owned by the pinned dependency under `node_modules`.

## Findings and proposals

Recognition gates remain failed and the UI remains Experimental. Read the
[failure audit and prioritized experiments](docs/audit.md),
[usage details](docs/usage.md), [migration plan](docs/plan.md) and
[historical checkpoints](docs/history.md).
