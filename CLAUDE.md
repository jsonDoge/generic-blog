# blog-flow — agent guide

Forkable SEO-first blog starter. Two Cloudflare Workers + an automated
research/writing pipeline. Each fork = one niche blog with its own resources.

## Architecture

- **apps/site** — Astro 5 (SSR, `@astrojs/cloudflare`) on a Worker.
  Reads posts from D1 at request time (no rebuilds), serves R2 media at
  `/images/<key>` (immutable cache), generates sitemap/RSS/robots/JSON-LD
  dynamically from D1. Pages set `s-maxage` + `stale-while-revalidate`
  headers for edge caching — there is no purge machinery by design.
  All look-and-feel tokens: `apps/site/src/styles/theme.css`.
- **apps/pipeline** — Worker with: cron trigger (`triggers.crons`) → starts a
  **Workflow** (`src/workflow.ts`, class `ResearchWorkflow`); `/admin` review
  UI + API (bearer `ADMIN_TOKEN`).
  Pipeline steps: discover topics (seed feeds + optional Brave search →
  `topics` table) → pick topic → Vectorize dedup → gather sources
  (fetch-first, Browser Rendering fallback, robots.txt respected, raw
  markdown archived to R2 under `sources/<workflow-id>/`) → synthesize with
  claim-level citations (gpt-oss-120b) → grounded fact-check scored 0–100 →
  save to D1 as draft/published/rejected.
- **packages/shared** — types + re-exports the root `blog.config.ts`.
- **db/migrations** — D1 schema: posts, sources, claims, topics, pipeline_runs.
- **prompts/*.md** — LLM prompts, imported into the worker as text modules
  (wrangler `rules: [{type: "Text"}]`). `{{PLACEHOLDER}}` slots filled by
  `fillTemplate()`.

## Key invariants

- `blog.config.ts` is the single per-fork config; don't scatter niche
  constants elsewhere. Prompts live only in `prompts/`.
- Posts are published by setting `status='published'` + `published_at`;
  the site shows only `status='published'`.
- Fact-check score < `pipeline.minFactCheckScore` ⇒ post saved as
  `rejected`, never published. `autoPublish:false` ⇒ everything lands as
  `draft` for human review in `/admin`.
- Placeholders in wrangler.jsonc (`replace-db-name`, `REPLACE_DB_ID`,
  `replace-r2-bucket`, `replace-vectorize-index`, `replace-workflow-name`)
  are filled by `scripts/provision.sh`; after provisioning the configs hold
  real resource ids and MUST stay committed (ids are not secrets).
- Model I/O goes through `apps/pipeline/src/lib/ai.ts` (`runModel` handles
  gpt-oss responses-shape vs chat-shape; `extractJson` parses chatty
  output). Don't call `env.AI.run` directly from steps.
- The Vectorize index must be 768 dims / cosine — matched to
  `@cf/baai/bge-base-en-v1.5` in blog.config.ts. Change both together.
- Vectorize and the pipeline_runs flight recorder are non-fatal by design:
  their failures are swallowed so a run still completes.

## Verified against live Cloudflare APIs (2026-08, real account)

Confirmed by direct REST calls — do NOT "fix" these on suspicion; check the
admin panel's step log for the actual error first:

- **`@cf/openai/gpt-oss-120b`** accepts `{instructions, input}` and returns
  Responses format: `result.output[]` = `[{type:"reasoning", ...},
  {type:"message", content:[{type:"output_text", text}]}]`. The existing
  `runModel`/`extractText`/`extractJson` were run against the recorded live
  payload (both binding-shaped and REST-enveloped) and extract correctly —
  reasoning items skipped, message text returned.
- **`AI.toMarkdown`** (REST `/accounts/{id}/ai/tomarkdown`, multipart
  `files=`) returns `result: [{name, mimeType, format, tokens, data}]` with
  clean markdown in `data` (nav/footer/script stripped, headings/lists/bold
  kept). Matches what `htmlToMarkdown()` in `lib/sources.ts` expects.
- Untested residual: the *worker-binding* call signature
  `env.AI.toMarkdown([{name, blob}])` can only be exercised in a deployed /
  `wrangler dev` worker; `safeMarkdown()` falls back to regex tag-stripping
  if it throws, so a mismatch degrades quality but doesn't kill runs.

## Gotchas learned the hard way

- **`wrangler --persist-to X` writes to `X/v3/...`** (appends `/v3` itself).
  That's why root `migrate:local`/`seed:local` use
  `--persist-to apps/site/.wrangler/state` — it lands in
  `apps/site/.wrangler/state/v3`, exactly where Astro's `platformProxy`
  reads. Getting this wrong ⇒ "no such table: posts" in `pnpm dev`.
- **Wrangler validates resource-name formats even on `--dry-run`** — bucket/
  index/workflow placeholders must be lowercase-hyphen shaped (hence
  `replace-r2-bucket`, not `REPLACE_R2_BUCKET`).
- **pnpm 11 blocks postinstall scripts by default**: `allowBuilds` for
  esbuild/sharp/workerd is set to `true` in `pnpm-workspace.yaml`; without it
  workerd doesn't install and wrangler breaks.
- The Astro build warns about a `SESSION` KV binding — benign; sessions are
  unused. The site worker entry is `dist/_worker.js/index.js`.
- `.gitignore` has `!.env.example` because the `.env.*` pattern would
  otherwise swallow it.
- The admin HTML lives in a template literal (`src/admin.ts`); its inline
  `<script>` deliberately uses string concatenation (not nested backticks)
  and `\\'` escapes — preserve that style when editing.
- `db/seed.sql` is not idempotent (UNIQUE slug) — second local seed run
  fails harmlessly.

## Credentials & secrets model

- **Local/CI** (`.env`, git-ignored; template `.env.example`):
  `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`) — wrangler and
  `provision.sh` read that exact name; scopes: Workers Scripts, D1, R2,
  Vectorize, Workers AI (Edit). A Workers-AI-Read-only token suffices for
  REST model testing but NOT for provisioning.
- **Worker runtime** (`wrangler secret put`, or `apps/pipeline/.dev.vars`
  locally; template `.dev.vars.example`): `ADMIN_TOKEN` (required, guards
  /admin), `BRAVE_API_KEY` (optional, enables search discovery; without it
  discovery is feed-only).
- Workers Paid plan ($5/mo/account) required for Browser Rendering +
  Workflows. Workers AI/D1/R2 have usable free tiers.

## Commands

- `pnpm install` — workspace install (pnpm monorepo)
- `pnpm dev` — site dev server (emulated bindings; run `pnpm migrate:local`
  + `pnpm seed:local` once first)
- `pnpm dev:pipeline` — pipeline locally; fire the cron with
  `curl "http://localhost:8787/__scheduled?cron=17+6+*+*+*"`.
  Note: AI/Browser/Vectorize hit real Cloudflare services even in local dev.
- `pnpm build` — build the Astro site (main pre-deploy verification)
- `cd apps/pipeline && npx wrangler deploy --dry-run --outdir <tmp>` —
  verifies pipeline bundling + config without deploying
- `pnpm provision <name>` — create + wire + deploy all Cloudflare resources
- `pnpm deploy` — deploy both workers

## Provisioning a new fork (agent task)

Follow FORK.md (short) / SETUP.md (full runbook). Summary: edit
`blog.config.ts` (+ prompts/theme, swap the HN placeholder seed feed for
real niche feeds) → `pnpm provision <unique-name>` → set `siteUrl` to the
deployed URL → `pnpm deploy` → trigger one run from `/admin`, review the
draft → verify with the SETUP.md checklist. Ask the owner for: blog
name/niche, seed feeds, custom domain, whether to enable Brave search, and
the ADMIN_TOKEN value.
