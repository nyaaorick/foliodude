# AGENTS.md — Wealth & Card Tracking System

This file is the single source of truth for repo rules used by AI assistants.
If a rule conflicts with code, update this file to match current behavior.

## 1. Project Overview

A single-user finance dashboard for:
- Bank accounts, credit cards, and investments
- Reward points with a rule engine
- Airline mileage accounts and redemptions
- Net worth across assets and liabilities

Core model: two tables (`accounts` and `transactions`) represent all balances and flows.

## 2. Tech Stack

- Next.js App Router
- TypeScript (strict, no `any`)
- Supabase (Postgres + Auth)
- shadcn/ui + Tailwind CSS
- Decimal.js for money arithmetic

## 3. Schema Source of Truth

Authoritative DDL is in `supabase/migrations/001_init.sql`.
`docs/SUPABASE_SCHEMA.md` is planned but not yet authoritative.

## 4. Accounts Model

`account_type`: `ASSET`, `LIABILITY`, `AIRLINE_MILES`, `SHARE`.

Key fields:
- `LIABILITY`
  - `reward_currency` is optional but fixed after creation
  - `reward_balance` is a single integer for that currency
- `AIRLINE_MILES`
  - `balance` is integer miles
  - `airline_program` is required
  - `usd_per_10k_miles` is valuation only
  - `transfer_rates` is a JSON map `{ rewardCurrencyId: integer miles }`
- `SHARE`
  - `shares`, `last_price`, `cost_basis` store the position
  - `balance` stores the current market value snapshot

## 5. Transactions Model

Supported types include reward and mileage flows:
- Reward: `REWARD_EARN`, `REWARD_TRANSFER_IN`, `REWARD_REDEEM`
- Mileage: `MILEAGE_TRANSFER_IN`, `MILEAGE_MANUAL_IN`, `MILEAGE_REDEEM_FLIGHT`

Notes:
- `reward_currency` is only populated for reward transactions
- `metadata` is JSONB and used for mileage details and snapshots

## 6. Data Layer Rules

- All DB writes live in `lib/actions/*` (Server Actions).
- Components must not call Supabase directly.
- Always validate auth with `supabase.auth.getUser()`.
- Use Decimal.js for money math; never use `parseFloat` on money.
- Format currency via `Intl.NumberFormat`.

## 7. Reward Rules

- `RewardRule` has no currency field.
- Earned reward currency is determined by the account’s `reward_currency`.

## 8. UI Rules

- Do not edit `components/ui/*` directly; wrap in `components/features/*`.
- Use Tailwind utilities only; no custom CSS files.
- Any account picker must display a human-readable account label in the trigger and menu.
- Never show raw account IDs in user-facing selects, summaries, or transaction metadata when an account name is available.
- Navigation loading must use existing Next.js route loading and the existing `PendingLinkVeil` pattern on `Link` navigations.
- Do not add global loading via `fetch` interception, `window.fetch` monkeypatching, or other request-level overlays.
- Submit flows should keep loading local to the triggering control or dialog; do not stack a global page overlay on top of form submission pending states.

## 9. Development Hygiene

- Typecheck: `npx tsc --noEmit`
- Tests: `npm test`

## 10. Adding New Reward Currencies

When adding a new points system (e.g., `CHASE`, `CITI`):
1. Add it to `lib/types/rewards.ts` (`REWARD_CURRENCIES`).
2. Update defaults in `lib/data/mileage-transfer-rates.ts`.
3. The mileage transfer rates UI will auto-render new inputs.

## 11. Cloudflare + One-File Env + All-in-One Docker Image (English)

- Security is not a concern for this deployment mode (secrets may be baked into the image).
- Use a single env file at repo root:
  - `.env.local` for local dev.
  - Copy `.env.local` to `.env` for build/runtime. Do not use other env files.
  - Include both public and private vars in that single file (e.g., `NEXT_PUBLIC_SUPABASE_ANON_KEY`, service role keys, OAuth secrets).
- Dockerfile rules:
  - Copy the `.env` into both build and runtime stages. No `--build-arg` or `--env-file` flags are needed.
  - Build command: `docker build -t next-app:latest .` (no extra args).
  - Runtime: `docker run -d --name folio-frontend -p 80:80 -p 443:443 --restart always next-app:latest`.
- Cloudflare setup:
  - Host the domain on Cloudflare, enable the orange-cloud proxy.
  - Set SSL mode to “Full (strict)”.
  - Certbot on the host is not required because the Cloudflare Origin Certificate is baked into the image.
- All-in-One image:
  - The image should bundle Nginx and the app in a single container.
  - Port 80 redirects to HTTPS; port 443 terminates TLS with the baked-in Cloudflare Origin Certificate.
  - Nginx config inside the image must include:
    - `client_header_buffer_size 32k;`
    - `large_client_header_buffers 8 64k;`
  - Expose/serve both port 80 and 443 inside the container.

## 12. No-Nonsense / Fail-Fast Developer Prompt

- **Role:** Act as a Senior Software Architect specializing in Clean Code and the Fail-Fast principle.
- **Core Instruction:** Optimize code by stripping away all "defensive programming" garbage. Do not provide "safety nets" that swallow errors or waste tokens.
- **Strict Requirements:**
  - **No Silent Failures:** Never use empty catch blocks or return vague values like null, undefined, or {} just to prevent a crash. If something is wrong, let it throw an error.
  - **Eliminate "Garbage" Logic:** Remove redundant null checks or `if (data)` wrappers if the logic logically requires that data to exist. Expose exactly where the chain breaks.
  - **Precision over Robustness:** Prefer a "brittle" but honest script over a "robust" but lying one. The code should be a "surgical strike"—minimalist, readable, and direct.
  - **Expose the Root Cause:** If an API call fails or a configuration is missing, the error must be loud and clear in the console immediately.
- **Goal:** Transform "defensive/messy" code into a "naked/high-performance" implementation. If you see a potential issue, report it as a bug rather than coding around it.
