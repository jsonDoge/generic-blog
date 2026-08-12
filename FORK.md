# Starting a new blog from this starter

Do these in order. Details, troubleshooting and verification: [SETUP.md](SETUP.md).

## 1. Fork

```bash
git clone <your-fork-url> my-blog && cd my-blog
pnpm install
```

## 2. Make it yours (3 files)

1. **`blog.config.ts`** — set:
   - `name`, `tagline`, `description`, `siteUrl` (placeholder for now), socials, author
   - `niche.topic` + `niche.audience` (one specific sentence each — the pipeline lives off these)
   - `niche.seedFeeds` — 5–15 RSS feeds of good sources in your niche (**replace the HN placeholder**)
   - `niche.categories`
2. **`apps/site/src/styles/theme.css`** — colors/fonts/radii for your theme (tech, beauty, fiction…)
3. **`prompts/*.md`** — only if the default voice/rubric doesn't fit your niche

Also replace `apps/site/public/assets/images/` placeholders (at minimum add a real `og-default.png`, 1200×630).

## 3. Provision Cloudflare (once)

Requires: Workers Paid plan ($5/mo) on the account.

```bash
npx wrangler login
pnpm provision my-blog-name        # unique prefix per blog
```

Prompts for `ADMIN_TOKEN` (pick a long random string; it guards /admin)
and optionally `BRAVE_API_KEY` (web-search discovery — recommended).

## 4. Point it at itself

```bash
# set siteUrl in blog.config.ts to the deployed site URL (or custom domain)
pnpm deploy
git add -A && git commit -m "provision my-blog-name"   # wrangler configs now hold your resource ids — keep them committed
```

## 5. First article

1. Open `https://my-blog-name-pipeline.<your-subdomain>.workers.dev/admin`, paste `ADMIN_TOKEN`.
2. Click **Run pipeline now** (takes a few minutes — watch "Recent pipeline steps").
3. **Preview** the draft (article + every claim with its source quote) → **Publish**.
4. It's live at `/blog/<slug>/` immediately.

## 6. Automate

- Cron cadence: `triggers.crons` in `apps/pipeline/wrangler.jsonc` (default: daily 06:17 UTC), then `pnpm deploy`.
- Once you trust the output: `pipeline.autoPublish: true` in `blog.config.ts`.
- CI: add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` GitHub secrets → pushes to main deploy.
- Submit `https://<site>/sitemap.xml` in Google Search Console.

That's it: config → provision → run → approve.
