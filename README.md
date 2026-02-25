# Reusable Waitlist Template (Astro + Hono + Cloudflare D1)

Static-first waitlist template for side projects:

- `Astro` renders a mostly static marketing page.
- `Hono` handles `/api/waitlist` on a Cloudflare Worker.
- `Cloudflare D1` stores emails and metadata.
- Built-in rate limit: **10 submissions per UTC day per IP hash**.
- Uses `Bun`, Tailwind CSS v4, and Starwind components.

## Deploy To Cloudflare Button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/LouisDeconinck/waitlist)

Cloudflare reads `wrangler.jsonc` and `package.json` to provision resources and run build/deploy scripts.

## Project Structure

- `src/pages/index.astro`: waitlist landing page.
- `src/components/waitlist/WaitlistForm.astro`: reusable signup UI + client submission logic.
- `src/worker.ts`: Hono API and static asset routing.
- `migrations/*.sql`: ordered D1 schema migrations.
- `src/config/waitlist.ts`: template copy/config values per project.
- `wrangler.jsonc`: Worker + D1 bindings.

## Setup

1. Install dependencies:

```bash
bun install
```

2. Configure local env variables:

```bash
cp .dev.vars.example .dev.vars
```

3. Create/apply local D1 migrations:

```bash
bun run db:migrate:local
```

4. Build static site and run Worker locally:

```bash
bun run dev:full
```

If you only want to iterate on UI quickly, use:

```bash
bun run dev
```

## Reusing This Template For New Projects

1. Update copy/settings in `src/config/waitlist.ts`.
2. Set `name` in `wrangler.jsonc` and choose a new `database_name`.
3. Keep the D1 binding name as `DB` so deploy scripts still work.
4. Commit and publish to a public repo.
5. Add the deploy button URL in your README.

## API Contract

`POST /api/waitlist`

Example JSON body:

```json
{
  "email": "you@example.com",
  "qualifier": "repair_shop_owner",
  "useCase": "Centralize diagnostics and customer approvals.",
  "source": "https://example.com/",
  "landingPath": "/",
  "viewport": "1440x900",
  "utmSource": "twitter",
  "utmMedium": "social",
  "utmCampaign": "launch",
  "additionalFields": {
    "teamSize": "3-10"
  },
  "metadata": {
    "referrer": "https://x.com/",
    "screen": "1728x1117",
    "languages": ["en-US", "fr-BE"]
  }
}
```

Response shape:

```json
{
  "ok": true,
  "message": "You are on the waitlist."
}
```

## Commands

- `bun run dev`: Astro UI dev server.
- `bun run dev:full`: build static assets and run Worker locally.
- `bun run build`: static production build.
- `bun run check`: Astro + TypeScript checks.
- `bun run db:migrate:local`: apply migrations to local D1.
- `bun run db:migrate:remote`: apply migrations to remote D1.
- `bun run deploy`: remote migration + `wrangler deploy` (Wrangler runs `astro build` via `wrangler.jsonc`).
