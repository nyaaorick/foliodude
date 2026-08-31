---
name: foliodude-workflow
description: Working rules for the FolioDude repo — pre-release means no backward compatibility, delete legacy rather than quarantine it, fail fast, minimal tests, tight token economy, and launch the app for the user to see after every phase. Load before making any change to this codebase.
---

# FolioDude working rules

These override general habits. They exist because FolioDude is **pre-release**:
nothing has shipped, there is no installed base, and there are no users whose
data or workflow a change could break.

## 1. No backward compatibility. None.

Nothing has shipped, so nothing is owed compatibility.

- **Schema defects are fixed in the migration that introduced them**, not in a
  new corrective migration. A `004_fix_003.sql` for a bug in `003` is a file
  that exists only to apologise for another file. Edit the source.
- **A stale development database is not a constraint.** If a change means the
  local `idb://foliodude` store has to be wiped, wipe it. Never design around
  it, never add a compatibility path for it, and don't raise it as a caveat —
  it is understood and accepted.
- No deprecation shims, no aliases kept "just in case", no dual code paths for
  an old and new shape. Change the callers.
- The append-only rule in `lib/db/migrate.ts` starts applying at first release.
  Until then the migration files are just the schema's source.

## 2. Delete legacy; do not quarantine it

Historical baggage is a cost paid every time someone reads the repo.

- **Delete dead code on sight** rather than excluding it from typecheck, hiding
  it behind a flag, or keeping it "as reference". Git history is the reference.
- A `tsconfig.json` exclude list, a `// TODO: remove in phase N`, or a file kept
  for comparison are all forms of the same debt. Clear them as part of the work
  that made them dead.
- **Refactor aggressively.** When a change reveals that the surrounding design
  is wrong, fix the design rather than threading the change through it. Prefer
  one coherent rewrite over an accreted patch.
- When a fix reveals a defect elsewhere, say so — but do not fix it unless it
  is in scope (see §5).

## 3. Fail fast

- Let errors throw. Do not catch-and-continue, do not substitute a default for a
  failed read, do not swallow.
- **No defensive guards for states that cannot happen.** A check for an
  impossible condition is dead code that implies the impossible is possible.
  Guards for states that *can* happen — a missing browser API, absent
  `localStorage` in Node — are not defensive, they are handling a real case.
- Prefer an error that names the actual problem over one that surfaces
  somewhere confusing. A constraint that fires with an unrelated name is a bug
  in the constraint.
- A wrong value is worse than a missing one, especially in a ledger. When
  confidence is low, leave the field empty and say so.

## 4. Minimal tests

- **One focused test per unit**, not a matrix. Prefer a single test that
  exercises the real risk over five that restate the same guarantee.
- Test what could **silently corrupt or lose data** — snapshot round-trips,
  destructive deletes, constraint interactions. That is where tests earn their
  keep.
- Do not test what the typechecker already proves, and do not write tests for
  rendering or layout.
- Tests run against a real in-memory PGlite (`lib/db/testing.ts`), never a
  mocked query builder — the CHECK constraints must actually execute.
- Derive assertions from source data (`MIGRATIONS.map(...)`) rather than
  hard-coding lists that then need editing on every change.

## 5. Scope and token economy

- **Stay inside the requested phase.** Report out-of-scope problems in the
  final message; do not fix them uninvited.
- Read what the task needs and no more. Do not re-read files already in
  context, do not survey the codebase for background, do not spawn subagents
  unless explicitly asked.
- Batch independent tool calls into one block.
- **Measure before claiming a tradeoff.** "Recharts is too heavy" became a real
  decision only after building it both ways and comparing chunk sizes. Assert
  numbers you have actually observed.
- Report faithfully: if something is untested on real hardware, say that
  plainly rather than implying it works.

## 6. Show the user the app after every phase

A phase is not done at "typecheck passes and tests are green" — those prove the
code compiles and the logic holds, not that a human looking at the app would see
it work. Before reporting a phase complete, launch it:

- **Extension**: `npm run dev:firefox` in the background. This runs `wxt -b
  firefox`, which opens a **real, separate Firefox instance** on the user's own
  display — a throwaway profile distinct from their regular browser — with the
  extension loaded and the sidebar open. On the user's own machine this window
  is genuinely visible to them; do not tear it down as cleanup, and do not
  attempt to screenshot it yourself unless a screenshot tool is confirmed
  available — the point is that the user looks at their own screen.
- **PWA**: `npm run dev:pwa` in the background, then say the local URL
  (`http://localhost:5174`) so the user can open it themselves.
- Leave the process running and tell the user what it is and where to look
  (e.g. "the sidebar in the new Firefox window"), rather than just stating that
  the build succeeded.
- This is in addition to, not instead of, the typecheck/test/build verification
  the rest of this document already requires — showing the app catches what
  those cannot (layout, rendering, interaction), and they catch what a glance at
  the UI cannot (logic, edge cases, regressions).
