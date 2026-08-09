# Setup runbook — provisioning a new blog from this starter

Follow this top to bottom when standing up a fork. Works for humans and for
AI agents (see also `CLAUDE.md`).

## 0. Prerequisites

| What | Why | How |
|---|---|---|
| Node 22+ and pnpm 9+ | build tooling | `corepack enable` |
| Cloudflare account on **Workers Paid** ($5/mo) | Browser Rendering + Workflows require it | dash.cloudflare.com → Workers → Plans |
| Wrangler auth | provisioning + deploys | `npx wrangler login` (interactive) **or** export `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` |
| API token scopes (if using a token) | least privilege | Workers Scripts:Edit, D1:Edit, Workers R2 Storage:Edit, Vectorize:Edit, Workers AI:Edit |
| Optional: Brave Search API key | web-search discovery layer | brave.com/search/api (free tier exists) |

## 1. Fork & configure

1. Fork/clone this repo, then `pnpm install`.
2. Edit **`blog.config.ts`** — identity, niche topic/audience, seed feeds,
   categories, autoPublish (keep `false` at first), models.
3. Edit **`prompts/*.md`** if the niche needs a different voice or rubric.
4. Re-theme **`apps/site/src/styles/theme.css`** (colors, fonts, radii).
5. Replace placeholder images in `apps/site/public/assets/images/`
   (`og-default.png` at 1200×630 matters most — social scrapers ignore SVG).

## 2. Provision Cloudflare resources

```bash
pnpm provision my-blog-name
```

This creates (or reuses) and wires together, then deploys:
- D1 database `my-blog-name-db` + applies `db/migrations/`
- R2 bucket `my-blog-name-media`
- Vectorize index `my-blog-name-topics` (768 dims, cosine)
- Workflow `my-blog-name-research`
- Workers `my-blog-name-site` and `my-blog-name-pipeline`

It will prompt for the `ADMIN_TOKEN` secret (pick a long random string) and
optionally `BRAVE_API_KEY`.

**Then:** set `siteUrl` in `blog.config.ts` to the deployed site URL (or your
custom domain) and run `pnpm deploy` again — canonicals, JSON-LD, sitemap and
RSS all derive from it. **Commit the modified wrangler configs** (they now
contain your resource ids; they are not secrets).

## 3. First article

1. Open `https://my-blog-name-pipeline.<subdomain>.workers.dev/admin`,
   paste your ADMIN_TOKEN, click **Run pipeline now**.
2. Watch "Recent pipeline steps". A run takes a few minutes
   (discover → gather → synthesize → fact-check → save).
3. Review the draft (Preview shows the article + every claim with its
   source quote), then **Publish**.
4. The article is live immediately at `/blog/<slug>/` — the site renders
   straight from D1.

## 4. Automation & hardening

- **Cron cadence**: edit `triggers.crons` in `apps/pipeline/wrangler.jsonc`
  (default: daily 06:17 UTC = one article attempt per day), then redeploy.
- **Auto-publish**: once you trust the output for your niche, set
  `pipeline.autoPublish: true` in blog.config.ts.
- **Custom domain**: add a `routes` entry in `apps/site/wrangler.jsonc`, update
  `siteUrl`, redeploy. Redirect www→apex at the zone level.
- **Protect /admin properly**: put Cloudflare Access in front of the pipeline
  worker (Zero Trust → Access → Applications) in addition to the bearer token.
- **CI deploys**: add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` as
  GitHub secrets; `.github/workflows/deploy.yml` deploys on push to main.
- **Search Console**: verify the domain, submit `https://<site>/sitemap.xml`.

## 5. Verification checklist

- [ ] `https://<site>/` renders; `/blog/`, `/about/`, `/feed.xml`,
      `/sitemap.xml`, `/robots.txt` all 200
- [ ] A published post page passes Google's Rich Results Test
      (BlogPosting + BreadcrumbList)
- [ ] `/admin` rejects requests without the token (401)
- [ ] Pipeline run appears in `pipeline_runs` (visible in admin) with all
      steps `succeeded`
- [ ] `wrangler tail my-blog-name-pipeline` during a manual run shows no errors

## Troubleshooting

- **Workflow fails at gather-sources** — "Only N usable sources": niche seed
  feeds are too thin or topic keywords too narrow. Add feeds, or add a Brave
  key so search can fill the gap.
- **AI errors mentioning input shape**: a model id in blog.config.ts changed
  families; `runModel()` handles gpt-oss vs chat-style models — check the
  model name against Workers AI catalog.
- **Vectorize errors**: index missing or wrong dimensions — recreate with
  `--dimensions=768 --metric=cosine` (must match the embedding model).
- **Local dev**: `pnpm dev` (site) uses emulated D1 — run `pnpm migrate:local`
  and `pnpm seed:local` first. `pnpm dev:pipeline` + `curl "http://localhost:8787/__scheduled?cron=17+6+*+*+*"`
  fires the cron locally.
