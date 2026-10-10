# FolioDude

**A local-first personal finance tracker for people whose money is spread
across countries, currencies, stocks, airline miles, and credit card
rewards.** No server, no account required, no data leaves your device unless
you turn on sync yourself.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Why

Most finance apps assume one bank, one currency, one country. FolioDude
doesn't: it tracks cash and investment accounts, airline mileage programs, and
credit card reward points side by side, and rolls them into one net-worth view
in USD. Everything runs as a real WASM Postgres database
(`@electric-sql/pglite`) inside your browser or browser extension — your
transaction history is queried locally with zero network latency, and it's
still there offline.

- **Nothing is sent anywhere by default.** The app ships with no API keys of
  any kind; optional integrations (live FX rates, share prices, AI-assisted
  entry) only activate if you supply your own key in Settings.
- **Two native-feeling surfaces from one codebase**: a Firefox sidebar for
  desktop, a standalone PWA you add to your iPhone home screen for mobile.
- **Multi-currency, multi-account by design** — assets, liabilities, airline
  miles, and brokerage positions are first-class account types, not bolted on.

See [PLAN.md](PLAN.md) for the full architecture, the migration plan off the
original Next.js/Supabase stack, and the reasoning behind each design
decision.

## Build targets

Two build targets share one React codebase:

| Target | Form factor | Entry | Output |
| :-- | :-- | :-- | :-- |
| Firefox Desktop | Sidebar WebExtension (MV3) | `entrypoints/` | `.output/firefox-mv3/` |
| iOS Safari | Standalone PWA | `pwa/` | `.output/pwa/` |

## Getting started

```bash
npm install

npm run dev:firefox    # launches Firefox with the sidebar loaded (primary workflow)
npm run dev:pwa        # vite dev server on :5174, host-exposed for testing on a real iPhone
npm run build:firefox  # -> .output/firefox-mv3
npm run build:pwa      # -> .output/pwa
npm run build          # both
npm run zip:firefox    # signable .xpi

npm run compile        # tsc --noEmit
npm test               # vitest
```

Open the sidebar in Firefox with `Ctrl/Cmd+B`, or View → Sidebar → FolioDude.
For iOS, serve `.output/pwa` over HTTPS/LAN and use Share → Add to Home Screen.

Optional API keys (FX rates, share prices, AI-assisted entry) are entered by
the user in Settings and stored only in the local database — see PLAN.md §1
and §7. Nothing needs to be configured to run the app.

## Layout

```
entrypoints/       WXT extension entrypoints (background, sidepanel)
pwa/               PWA shell: index.html, main.tsx, manifest + icons
components/app/    AppRoot — the router shell both targets mount
components/        ui/ (primitives) and features/ (domain UI)
pages/             route components
lib/auth/          Google OAuth (PKCE, no client secret)
lib/data/          revalidation bus + useLiveQuery (client-side data layer)
lib/sync/          Drive snapshot sync, device identity, single-writer rule
lib/db/            PGlite client, migrations, session, ledger + settings helpers
lib/actions/       business logic — direct PGlite queries, no server
lib/               types, utils, data, auth
assets/globals.css single Tailwind entry, shared by both targets
```

## Project status

Phase 1 (build tooling) and Phase 2 (local database layer) are done: every
file in `lib/actions/` runs directly against PGlite inside a transaction, with
171 tests passing against a real in-memory database (not a mocked query
builder). `npm run compile` is clean across the whole project.

Phase 3 (UI) is done: `pages/*.tsx` read real data through `useLiveQuery`, and
mutations call `revalidate()` instead of reloading the document. The typecheck
quarantine is gone — `tsconfig.json` excludes only `node_modules` and `.output`.
The legacy `app/` Next.js pages have been deleted now that `pages/` reproduces
them.

One responsive layout serves every target, breaking on viewport width alone:
below `md` a bottom tab bar with safe-area insets and bottom-sheet dialogs (the
Firefox sidebar and iOS portrait), at `md`+ a left rail. Clicking the extension's
toolbar button opens the app in a full browser tab, where it renders as an
ordinary desktop site. Charts are inline SVG rather than Recharts, which cut the
dashboard chunk from 393 kB to 14 kB.

Phase 4 (Google sign-in + Drive snapshot sync) is done. Sync is optional and
off until you sign in; the app is fully usable signed-out. A snapshot of the
ledger is stored in your own Google Drive `appDataFolder`, written directly from
the client — there is no server. API keys are excluded from the snapshot.

Sign-in needs a Google OAuth client id supplied at build time, and the two
targets need different Google client *types*: set
`VITE_GOOGLE_CLIENT_ID_EXTENSION` (Desktop app type) for the extension and
`VITE_GOOGLE_CLIENT_ID_WEB` (Web application type) for the PWA. Without them the
Sync page says so and everything else works. The iOS PWA sign-in flow has not
been verified on real hardware yet.

Because sync overwrites rather than merges, exactly one device is the writer;
the others are read-only until promoted on the Sync page.

FolioDude is pre-release, so nothing here is kept for backward compatibility:
schema fixes are made in the migration that introduced them, legacy code is
deleted rather than quarantined, and a stale development database is wiped
rather than migrated. The working rules are in [PLAN.md](PLAN.md) §9 and, in
operational form for coding agents, in
[.claude/skills/foliodude-workflow/SKILL.md](.claude/skills/foliodude-workflow/SKILL.md).

Full roadmap, open risks, and design rationale for each phase live in
[PLAN.md](PLAN.md).

## Community

Bugs and feature ideas: open a [GitHub issue](https://github.com/nyaaorick/foliodude/issues).
Questions or just want to chat: [Discord](https://discord.gg/BqC4JzwT).

## License

[MIT](LICENSE) © 2026 nyaaorick
