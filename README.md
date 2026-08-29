# FinProject

Single-user finance dashboard built with:

- Next.js App Router
- TypeScript
- Supabase
- shadcn/ui + Tailwind

## Local Development

Run the app:

```bash
npm run dev
```

Useful checks:

```bash
npm test
npx tsc --noEmit
```

## No-Nonsense / Fail-Fast Developer Prompt

- **Role:** Act as a Senior Software Architect specializing in Clean Code and the Fail-Fast principle.
- **Core Instruction:** Optimize code by stripping away all "defensive programming" garbage. Do not provide "safety nets" that swallow errors or waste tokens.
- **Strict Requirements:**
  - **No Silent Failures:** Never use empty catch blocks or return vague values like null, undefined, or {} just to prevent a crash. If something is wrong, let it throw an error.
  - **Eliminate "Garbage" Logic:** Remove redundant null checks or `if (data)` wrappers if the logic logically requires that data to exist. Expose exactly where the chain breaks.
  - **Precision over Robustness:** Prefer a "brittle" but honest script over a "robust" but lying one. The code should be a "surgical strike"—minimalist, readable, and direct.
  - **Expose the Root Cause:** If an API call fails or a configuration is missing, the error must be loud and clear in the console immediately.
- **Goal:** Transform "defensive/messy" code into a "naked/high-performance" implementation. If you see a potential issue, report it as a bug rather than coding around it.

## App Container (All-in-One, Cloudflare Origin TLS)

- Single env workflow:
  - `.env.local` for local dev.
  - Copy to `.env` for build/runtime: `cp .env.local .env`
  - Both public and private vars live in that one file.
- Build (no args needed):
  ```bash
  docker --context default buildx build --platform linux/amd64 -t next-app:latest --load .
  ```
- Upload to VPS:
  ```bash
  docker --context default save next-app:latest | gzip > /tmp/next-app-amd64.tar.gz
  scp /tmp/next-app-amd64.tar.gz root@<server-ip>:/opt/finproject/
  ```
- Run on VPS (only Docker, no host Nginx/Certbot):
  ```bash
  cd /opt/finproject
  gunzip -c next-app-amd64.tar.gz | docker load
  docker rm -f folio-frontend || true
  docker run -d \
    --name folio-frontend \
    -p 80:80 \
    -p 443:443 \
    --restart always \
    next-app:latest
  ```
- Inside the image:
  - Nginx fronts the app and proxies to Next.js on 3000.
  - Header buffers are increased: `client_header_buffer_size 32k;` and `large_client_header_buffers 8 64k;`.
  - Port 80 redirects to HTTPS.
  - Port 443 uses a baked-in Cloudflare Origin Certificate and private key.
  - The baked-in `.env` is used for both build and runtime; no `--build-arg` or `--env-file`.
- Cloudflare setup:
  - Proxy (orange cloud) enabled for the domain.
  - SSL mode set to **Full (strict)**.
  - No `certbot` is required because the image already contains the Cloudflare Origin Certificate.

## Required Environment Variables

Set these in `.env` / `.env.local`:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `EXCHANGE_RATE_API_KEY`
- `FINNHUB_API_KEY`

## VPS Preparation

Debian 12 bootstrap scripts live in `ops/vps/`:

- `install-system.sh` installs Docker only.
- `install-app-cron.sh` installs the daily snapshot cron job
- `nginx/finproject.conf.example` is kept for reference but is not used by the all-in-one container

## Cron Security

`/api/cron/net-worth-snapshots` now supports a `CRON_SECRET`. In production, call it with one of:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://foliodude.it.com/api/cron/net-worth-snapshots
```

```bash
curl -H "x-cron-secret: $CRON_SECRET" https://foliodude.it.com/api/cron/net-worth-snapshots
```
