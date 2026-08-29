# Development Progress

> Last updated: 2026-03-16

## Current Phase

**Phase 1 — Local MVP** (in progress)

## Completed

### Scaffold Setup (2026-03-15)

- [x] Next.js project initialized (App Router, TypeScript, Tailwind CSS, ESLint)
  - Next.js 16.1.6, React 19.2.3, Tailwind v4
  - No `src/` directory — `app/`, `components/`, `lib/` at project root
- [x] shadcn/ui initialized (style: base-nova, RSC: true, icon: lucide)
  - `components/ui/button.tsx` generated as seed component
  - `components.json` configured with `@/*` alias
- [x] Core dependencies installed
  - `@supabase/ssr` ^0.9.0
  - `@supabase/supabase-js` ^2.99.1
  - `zod` ^4.3.6
- [x] Directory structure created per `AGENTS.md` spec
  - `components/features/{dashboard,accounts,transactions,rewards}/` — empty `index.ts` placeholders
  - `lib/actions/` — empty `index.ts` placeholder
  - `lib/utils/` — empty `index.ts` placeholder (shadcn also generated `lib/utils.ts` for `cn()`)
  - `docs/architecture/` — `.gitkeep`
- [x] Supabase client helpers created
  - `lib/supabase/client.ts` — `createBrowserClient` via `@supabase/ssr`
  - `lib/supabase/server.ts` — `createServerClient` via `@supabase/ssr`, cookie API uses **only** `getAll`/`setAll`
- [x] Type skeleton files created (empty exports, to be filled later)
  - `lib/types/database.ts` — raw Supabase DB types
  - `lib/types/rewards.ts` — RewardRule, SpendStats, RewardBalance
  - `lib/types/accounts.ts` — Account ViewModels
  - `lib/types/transactions.ts` — Transaction ViewModels
- [x] `.env.local` template created (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- [x] Node.js v20.20.1 installed via nvm (`.zshrc` configured)

### Database Schema & Types (2026-03-15)

- [x] `supabase/migrations/001_init.sql` — accounts + transactions tables, ENUM types, indexes, `updated_at` trigger, RLS policies
- [x] `lib/types/database.ts` — `Json`, `Database` namespace (`Row`/`Insert`/`Update` per table), `AccountRow`/`TransactionRow` convenience aliases
- [x] `docs/architecture/accounts.md` — Account management MVP architecture (types, Server Actions, component tree, key decisions)

### Accounts Action Foundation (2026-03-15)

- [x] `lib/types/accounts.ts` — added minimal `AccountType` enum and `Account` interface for MVP account flows
- [x] `lib/actions/account-read-actions.ts` — implemented session validation via `supabase.auth.getUser()`, user-scoped account query, and type-priority sorting (`ASSET` → `LIABILITY` → `SHARE`)

### Type Definitions (2026-03-15)

- [x] `lib/types/accounts.ts` — full `Account` interface (all DB fields), `AccountType` enum (ASSET | LIABILITY | SHARE), `AccountWithStats`, `CreateAccountInput`, `UpdateAccountInput`
- [x] `lib/types/transactions.ts` — `TransactionType` enum, `Transaction` interface, `CreateTransactionInput`
- [x] `lib/types/rewards.ts` — `RewardRule` (with cap fields), `RewardBalances`, `SpendStats`, `RewardResult`

### Google OAuth & Auth (2026-03-15)

- [x] `lib/supabase/middleware.ts` — `updateSession(request)` using `createServerClient` with request/response cookie pattern (`getAll`/`setAll` only)
- [x] `middleware.ts` (project root) — protects `/dashboard`, `/accounts`, `/transactions`, `/rewards`; redirects unauthenticated to `/login`, authenticated `/login` to `/dashboard`
- [x] `app/(auth)/login/page.tsx` — Google OAuth button (shadcn Button), `signInWithOAuth` with `redirectTo: /auth/callback`
- [x] `app/auth/callback/route.ts` — GET handler exchanges `code` for session via `exchangeCodeForSession`, redirects to `/dashboard` or `/login`
- [x] `lib/actions/auth-actions.ts` — Server Actions handle Google OAuth sign-in and sign-out redirects via Supabase auth

### Accounts CRUD & UI (2026-03-15)

- [x] `lib/actions/createAccount.ts`, `deleteAccount.ts` — Server Actions with auth, `ActionResult<T>`, `revalidatePath`
- [x] `app/(dashboard)/accounts/page.tsx` — account list, CreateAccountDialog, sign out
- [x] `components/features/accounts/account-list.tsx`, `account-card.tsx`, `create-account-dialog.tsx`
- [x] shadcn components: button, card, dialog, input, label, select, progress, badge, dropdown-menu, textarea

### Rewards Engine & createTransaction (2026-03-15)

- [x] `lib/utils/rewards-engine.ts` — pure `calculateReward()` (findRule, getSpend, cap logic)
- [x] `lib/actions/createTransaction.ts` — sequential expense creation without RPC (`INSERT` expense, `UPDATE` balance, optional `INSERT` reward + JSONB overwrite)
- [x] `lib/actions/createTransaction.ts` — Zod validation, Decimal.js arithmetic, `calculateReward()` call
- [x] REWARD_EARN memo stores `ref:<expense_id>` for traceability

### Rewards Simplification & Airline Miles (2026-03-16)

- [x] Added `AIRLINE_MILES` account type with airline program enum and miles balance rules
- [x] Reward balances simplified to single `reward_currency` + `reward_balance` per liability account
- [x] Miles in/out flows: transfer points to miles, manual transfer in, redeem flight with tax expense
- [x] Mileage account details show miles, valuation rate, and history for mileage transactions
- [x] Transfer points to miles supports combining up to 3 cards with same reward currency

### Mileage Transfer Rates (2026-03-16)

- [x] Airline mileage accounts store `transfer_rates` map (reward currency -> miles)
- [x] Mileage detail card includes Edit Rates dialog
- [x] Transfers use account-specific rates; missing/zero rate blocks redemption

### Account Detail & Transaction UI (2026-03-15)

- [x] `app/(dashboard)/accounts/[id]/page.tsx` — account detail with balance, credit utilization, reward balances, reward rules summary, transaction list
- [x] `lib/actions/account-read-actions.ts`, `updateRewardRule.ts`
- [x] `lib/types/transactions.ts` — `TransactionWithReward` interface
- [x] `components/features/transactions/transaction-list.tsx`, `transaction-item.tsx`, `create-transaction-dialog.tsx` — expense list with merged reward badge, add-transaction form
- [x] `components/features/rewards/rule-edit-dialog.tsx` — edit reward rule (multiplier, currency, cap, fallback) per category
- [x] AccountCard wrapped in Link to `/accounts/[id]`

## Not Yet Done

- [ ] `docs/SUPABASE_SCHEMA.md` (authoritative DDL reference)
- [ ] `docs/decisions.md` (ADR log)
- [ ] Phase 2 — Cloud deploy (Supabase Cloud, Vercel)
- [ ] Phase 3 — Auto-pay

## Known Issues

- None at this stage.

## Docs Snapshot (2026-03-19)

- [x] Copied the authoritative `AGENTS.md` into `docs/AGENTS.md` so the guidance now lives alongside other architecture notes.
- [x] Enabled Cloudflare Origin TLS docs and README entries (Full strict, baked-in certs, dual 80/443 ports) to match the live configuration, reducing future drift.
