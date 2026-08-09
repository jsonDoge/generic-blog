# Blog Flow — self-writing, SEO-first blog starter for Cloudflare

Fork this repo → run one script → get a niche blog that **researches, writes,
fact-checks and publishes its own articles** on a schedule, served entirely
from Cloudflare's edge.

```
Cloudflare Cron ──▶ Workflow (durable, per-step retries)
                     ├─ discover topics    (seed RSS feeds + optional Brave search)
                     ├─ pick topic         (D1 topic queue)
                     ├─ dedup check        (Vectorize embeddings vs existing posts)
                     ├─ gather sources     (fetch-first → Browser Rendering fallback,
                     │                      robots.txt respected, raw md archived to R2)
                     ├─ synthesize + write (gpt-oss-120b, claim-level citations)
                     ├─ fact-check         (claims verified against source text, 0-100)
                     └─ save               (D1: draft → human approve → published)
                                                    │
                    Astro SSR worker ◀──────────────┘
                    (reads D1 per request — publish is instant, no rebuilds)
```

## Stack

| Piece | Tech |
|---|---|
| Site | Astro 5 SSR on a Cloudflare Worker (`@astrojs/cloudflare`) |
| Content DB | Cloudflare D1 (posts, claims, sources, topics, run logs) |
| Media + source archive | Cloudflare R2, served at `/images/<key>` |
| Pipeline | Worker + Cron Trigger + **Cloudflare Workflows** |
| Page fetching | fetch-first, **Browser Rendering** (puppeteer) fallback |
| Writing & fact-check | **Workers AI** `gpt-oss-120b` (+ `gpt-oss-20b` utility) |
| Dedup / related posts | Workers AI embeddings + **Vectorize** |
| Review | `/admin` console on the pipeline worker (bearer token + optional CF Access) |

## Quick start

```bash
pnpm install
# edit blog.config.ts  (niche, seed feeds, identity)
npx wrangler login
pnpm provision my-blog-name     # creates D1/R2/Vectorize/Workflow, deploys both workers
```

Then open `/admin` on the pipeline worker, hit **Run pipeline now**, review
the draft, publish. Full runbook with verification checklist: **[SETUP.md](SETUP.md)**.

Requires the Workers Paid plan ($5/mo — Browser Rendering + Workflows).

## What a fork customizes

1. **`blog.config.ts`** — identity, niche topic/audience, seed feeds,
   categories, auto-publish policy, fact-check threshold, models.
2. **`prompts/*.md`** — the pipeline's editorial voice: discovery triage,
   synthesis style rules, fact-check rubric.
3. **`apps/site/src/styles/theme.css`** — all design tokens (colors, fonts,
   radii); the layout adapts to any niche without touching components.
4. **`apps/site/public/assets/images/`** — logo, OG image, cover placeholders.

## Content quality by construction

- Every factual claim is stored with the **exact source URL and quote** that
  supports it (`claims` table) and verified against the archived source text —
  not the model's memory. Low scores are rejected automatically.
- Articles **synthesize across 2+ independent sources**; single-source
  re-reporting is rejected at the discovery stage by prompt rule.
- Published pages render a visible **Sources** section and `citation` JSON-LD.
- Default is **human-in-the-loop**: drafts wait in `/admin` for approval.
  `autoPublish` exists, but earn trust in your niche before flipping it.
- Scraping is polite: robots.txt respected, honest bot UA, blocked-domain list.

## SEO built in

Semantic layouts with one H1, breadcrumbs, TOC anchors; canonical +
OG/Twitter meta on every page; JSON-LD (`WebSite`, `Organization`,
`BlogPosting` with citations, `BreadcrumbList`, `CollectionPage`,
`AboutPage`); dynamic `sitemap.xml`, RSS and `robots.txt` generated from D1;
edge caching with `stale-while-revalidate`; immutable-cached R2 media;
system-font, zero-external-request pages.

## Repo map

```
blog.config.ts            ★ per-fork config
prompts/                  ★ per-fork editorial prompts
apps/site/                Astro SSR worker (pages, layouts, styles, SEO endpoints)
apps/pipeline/            cron + ResearchWorkflow + /admin console
packages/shared/          shared types + config re-export
db/migrations/            D1 schema   ·  db/seed.sql local dev seed
scripts/provision.sh      one-shot Cloudflare provisioning
SETUP.md                  full runbook  ·  CLAUDE.md agent guide
```

## Local development

```bash
pnpm migrate:local && pnpm seed:local   # emulated D1 with a sample post
pnpm dev                                # site on localhost:4321
pnpm dev:pipeline                       # pipeline worker; fire the cron with:
curl "http://localhost:8787/__scheduled?cron=17+6+*+*+*"
```

Note: Browser Rendering, Workers AI and Vectorize run against real Cloudflare
services even in `wrangler dev` — local pipeline runs incur (small) usage.
