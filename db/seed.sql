-- Local development seed: one published sample post so the site renders.
-- Run with: pnpm seed:local   (never run against production)
INSERT INTO posts (slug, title, description, category, tags, markdown, status, fact_check_score, author, reading_minutes, published_at)
VALUES (
  'welcome-to-your-new-blog',
  'Welcome to your new blog',
  'This sample post proves the Astro + D1 rendering path works end to end. Replace it with pipeline-generated content.',
  'guides',
  '["starter","meta"]',
  '## It works

If you can read this, the site worker is rendering markdown straight from D1.

### What to do next

1. Edit `blog.config.ts` with your niche and seed feeds.
2. Run `pnpm provision` to create your Cloudflare resources.
3. Trigger the pipeline once from the admin UI and review the draft it produces.

> Delete this post from the admin UI when your first real article is live.',
  'published',
  100,
  'Alex Doe',
  1,
  datetime('now')
);
