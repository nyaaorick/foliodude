---
name: foliodude-workflow
description: Essential project conventions for changes to the pre-release FolioDude codebase.
---

# FolioDude essentials

- **Stay in scope.** Follow the requested phase; report unrelated defects without fixing them. Do not spawn subagents unless asked.
- **Pre-release: no compatibility baggage.** Fix schemas in their original migrations, update callers, and delete code made obsolete by the change. Stale development data does not require a compatibility path.
- **Fail clearly.** Let errors surface; do not hide failed reads or invent defaults. Leave uncertain financial fields empty.
- **Protect ledger writes.** Use `adjustBalance` / `adjustRewardBalance` with signed deltas, `insertTransaction`, and `normalizeMemo`. Writes take a `Tx` from `db.transaction()`. Throw inside transactions to roll back; convert errors to `ActionResult` only at the exported boundary. Database CHECK constraints own balance validation.
- **Verify the real risk.** Keep tests focused on data integrity and use real in-memory PGlite for database tests. Check UI changes in the browser, and report only results actually observed.
