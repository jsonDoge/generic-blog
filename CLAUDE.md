# blog-flow — agent guide

Forkable SEO-first blog starter. Two Cloudflare Workers + an automated
research/writing pipeline. Each fork = one niche blog with its own resources.

## Architecture

- **apps/site** — Astro 5 (SSR, `@astrojs/cloudflare`) on a Worker.
  Reads posts from D1 at request time (no rebuilds), serves R2 media at
  `/images/<key>`, generates sitemap/RSS/robots/JSON-LD dynamically from D1.
  All look-and-feel tokens: `apps/site/src/styles/theme.css`.
- **apps/pipeline** — Worker with: cron trigger (`triggers.crons`) → starts a
  **Workflow** (`src/workflow.ts`, class `ResearchWorkflow`); `/admin` review
  UI + API (bearer `ADMIN_TOKEN`).
  Pipeline steps: discover topics (seed feeds + optional Brave search →
  `topics` table) → pick topic → Vectorize dedup → gather sources
  (fetch-first, Browser Rendering fallback, robots.txt respected, raw
  markdown archived to R2) → synthesize with claim-level citations
  (gpt-oss-120b) → grounded fact-check scored 0–100 → save to D1 as
  draft/published/rejected.
- **packages/shared** — types + re-exports `blog.config.ts` (root).
- **db/migrations** — D1 schema: posts, sources, claims, topics, pipeline_runs.
- **prompts/*.md** — LLM prompts, imported into the worker as text modules
  (wrangler Text rule). `{{PLACEHOLDER}}` slots filled by `fillTemplate()`.

## Key invariants

- `blog.config.ts` is the single per-fork config; don't scatter niche
  constants elsewhere. Prompts live only in `prompts/`.
- Posts are published by setting `status='published'` + `published_at`;
  the site shows only `status='published'`.
- Fact-check score < `pipeline.minFactCheckScore` ⇒ post saved as
  `rejected`, never published. `autoPublish:false` ⇒ everything lands as
  `draft` for human review.
- `REPLACE_*` placeholders in wrangler.jsonc files are filled by
  `scripts/provision.sh`; after provisioning, the configs contain real
  resource ids and must stay committed.
- Model I/O goes through `apps/pipeline/src/lib/ai.ts` (`runModel`
  handles gpt-oss responses-shape vs chat-shape; `extractJson` parses
  chatty output). Don't call `env.AI.run` directly from steps.

## Commands

- `pnpm install` — workspace install (pnpm monorepo)
- `pnpm dev` — site dev server (emulated bindings; run `pnpm migrate:local`
  + `pnpm seed:local` once first)
- `pnpm dev:pipeline` — pipeline locally; trigger cron with
  `curl "http://localhost:8787/__scheduled?cron=17+6+*+*+*"`
- `pnpm build` — build the Astro site (the main pre-deploy verification)
- `pnpm provision <name>` — create + wire + deploy all Cloudflare resources
  (needs wrangler auth; see SETUP.md)
- `pnpm deploy` — deploy both workers

## Provisioning a new fork (agent task)

Follow SETUP.md exactly. Summary: edit `blog.config.ts` (+ prompts/theme) →
`pnpm provision <unique-name>` → set `siteUrl` to the deployed URL →
`pnpm deploy` → trigger one run from `/admin` → verify with the SETUP.md
checklist. Ask the owner for: blog name/niche, seed feeds, custom domain,
whether to enable Brave search, and the ADMIN_TOKEN value.
