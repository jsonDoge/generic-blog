# Starting a new blog from this starter

Do these in order. Details, troubleshooting and verification: [SETUP.md](SETUP.md).
Written for whoever runs the fork — human or agent. Field notes from a real
provisioning run are marked ⚠.

## 0. Account prerequisites (one-time, dashboard — needs a human)

- **Workers Paid plan** ($5/mo) on the account (Workflows + Browser Rendering).
- **R2 enabled**: dashboard → R2 Object Storage → click through the enable
  flow. ⚠ Until this is done every R2 API call fails with error `10042`
  ("Please enable R2 through the Cloudflare Dashboard") — it looks like a
  token-permission problem but isn't.
- **API token** in `.env` (template: `.env.example`) under the exact name
  `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`) — wrangler and
  `provision.sh` read only that name. Account-level **Edit** scopes needed:
  Workers Scripts, D1, R2, Vectorize, Workers AI. ⚠ Verify before
  provisioning with read probes: `npx wrangler d1 list`,
  `npx wrangler r2 bucket list`, `npx wrangler vectorize list` — each fails
  fast if a scope is missing. Load the env with `set -a; source .env; set +a`.
- **Privacy check**: the account's workers.dev subdomain defaults to a slug of
  the account name — often the owner's real name — and appears in every
  `*.workers.dev` URL. If that matters, change it BEFORE anything is public:
  dashboard (Workers & Pages → "Your subdomain" → Change), or via API —
  `DELETE /accounts/{id}/workers/subdomain` then `PUT` with
  `{"subdomain":"<neutral-name>"}` (⚠ a plain PUT alone fails with code
  10036; delete first). `workers_dev: false` in a wrangler.jsonc takes a
  worker's URL fully offline meanwhile.

## 1. Fork

```bash
git clone <your-fork-url> my-blog && cd my-blog
pnpm install
```

## 2. Make it yours (3 files)

1. **`blog.config.ts`** — set:
   - `name`, `tagline`, `description`, `siteUrl` (placeholder for now), author
   - `niche.topic` + `niche.audience` (one specific sentence each — the pipeline lives off these)
   - `niche.seedFeeds` — 5–15 RSS feeds of good sources in your niche
     (**replace the placeholder feed**). ⚠ Fetch every feed URL first and
     confirm it's a live RSS/Atom document with recent items — guessed feed
     URLs are often 404s, and dead feeds silently starve discovery.
   - `niche.categories`
   - `models.cover` — text-to-image model for post cover art (or remove it to
     skip covers). House art style lives in `prompts/cover-image.md`; keep
     that template's "no text, no letters" tail — image models garble text.
2. **`apps/site/src/styles/theme.css`** — colors/fonts/radii for your theme.
3. **`prompts/*.md`** — only if the default voice/rubric doesn't fit.

Also replace `apps/site/public/assets/images/` placeholders (at minimum a real
`og-default.png`, 1200×630 — brand name + tagline on a plain background works).

Niche-picking notes (any niche): favor news-driven topics with fact-checkable
primary sources and an active RSS ecosystem — that's the shape this pipeline
is built for; freshness and entity-specific queries are also what informational
sites still win at in the AI-Overviews era. Avoid YMYL (health/finance) unless
a credentialed human reviews posts. If the byline is a pen name, keep the
/about page honest about it (no invented credentials or photos).

## 3. Provision Cloudflare (once)

```bash
pnpm provision my-blog-name        # unique prefix per blog
```

Every resource is created as `<name>-*` (db, media, topics, research, site,
pipeline) so several blogs can share one account without collisions.

- Interactive shells are prompted for `ADMIN_TOKEN` (guards /admin) and
  optionally `BRAVE_API_KEY` (web-search discovery — recommended for news).
- ⚠ Non-interactive shells (agents): the script *skips* the secret prompts.
  Set them yourself afterwards, and mirror them into git-ignored
  `apps/pipeline/.dev.vars` so they aren't lost:
  ```bash
  printf '%s' "$TOKEN" | npx wrangler secret put ADMIN_TOKEN --config apps/pipeline/wrangler.jsonc
  ```
- ⚠ Renaming a fork later is effectively re-provisioning: the script fills
  placeholders one-way. Before any content exists it's cheap —
  `git restore apps/*/wrangler.jsonc`, delete the old resources
  (`wrangler delete --name <w>`, `d1 delete`, `r2 bucket delete`,
  `vectorize delete`), re-run provision, re-set secrets.

## 4. Point it at itself

```bash
# set siteUrl in blog.config.ts to the deployed site URL (or custom domain)
pnpm deploy
git add -A && git commit -m "provision my-blog-name"   # configs now hold resource ids — keep committed
```

Custom domain (recommended — buy via Cloudflare Registrar so the DNS zone is
auto-created; registrar purchases are dashboard-only, no API):
1. Set `siteUrl` to `https://yourdomain.com`.
2. In `apps/site/wrangler.jsonc`:
   `"workers_dev": false, "routes": [{"pattern": "yourdomain.com", "custom_domain": true}, {"pattern": "www.yourdomain.com", "custom_domain": true}]`
3. `pnpm deploy` — DNS + certs are automatic; www may take a minute to serve.
   The pipeline worker keeps its workers.dev URL for /admin.

## 5. First article

Via the admin UI (`https://<name>-pipeline.<subdomain>.workers.dev/admin`,
paste `ADMIN_TOKEN`, "Run pipeline now") — or headless, no UI needed:

```bash
npx wrangler workflows trigger <name>-research --config apps/pipeline/wrangler.jsonc
npx wrangler workflows instances describe <name>-research latest --config apps/pipeline/wrangler.jsonc
```

Review the draft, then publish. Headless editorial loop over D1 directly:

```bash
npx wrangler d1 execute <name>-db --remote --json --command \
  "SELECT id,slug,title,fact_check_score FROM posts WHERE status='draft'"
# read markdown + claims (with verdicts), judge accuracy/on-topic/quality, then:
npx wrangler d1 execute <name>-db --remote --command \
  "UPDATE posts SET status='published', published_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=<id>"
```

Verify after publishing: homepage 200, post page renders (no stray citation
markup), `/sitemap.xml` and `/feed.xml` (not /rss.xml) list it, `og:image` and
the hero point at the cover (`hero_image_key`; the cover step is non-fatal, so
backfill via the Workers AI REST API + `wrangler r2 object put` if null).
⚠ Pages are edge-cached (`s-maxage`, no purge by design) — a stale list page
self-heals within minutes; don't chase it.

## 6. Automate

- Cron cadence: `triggers.crons` in `apps/pipeline/wrangler.jsonc`
  (default: daily 06:17 UTC), then `pnpm deploy`.
- Once you trust the output: `pipeline.autoPublish: true` in `blog.config.ts`.
- Agent-run editorial (replaces human review if the owner delegates it): keep
  `autoPublish: false` and run a scheduled headless session ~1h after the
  pipeline cron with a standing instruction file — see `ops/editorial.md`
  (review → publish/reject → debug → journal) and `ops/scheduler.mjs`
  (node-cron wrapper; overlap guard + hard timeout; `--now` for an immediate
  pass). Adapt names/paths; the mechanism is niche-independent.
- CI: add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` GitHub secrets →
  pushes to main deploy.
- Submit `https://<site>/sitemap.xml` in Google Search Console (needs the
  owner's Google account).

## Debugging a bad run (field-tested order)

1. `wrangler workflows instances describe <name>-research latest` — find the
   failing step and its real error before touching code (CLAUDE.md documents
   verified model I/O contracts — don't "fix" those on suspicion).
2. Flight recorder: `SELECT * FROM pipeline_runs ORDER BY started_at DESC` in
   D1. Vectorize + flight-recorder failures are swallowed by design; a run
   completes without them.
3. A stuck instance retries for a long time — `wrangler workflows instances
   terminate <name>-research <id>`, fix, redeploy, re-trigger. Clean up any
   half-saved post rows (posts/claims/sources) and requeue the topic
   (`UPDATE topics SET status='queued' WHERE id=<n>`).
4. Fact-check scores that contradict the per-claim verdicts usually mean the
   rubric is being applied too harshly, not that the article is bad — read the
   itemized `problems` before rejecting good work.

That's it: config → provision → run → review → automate.
