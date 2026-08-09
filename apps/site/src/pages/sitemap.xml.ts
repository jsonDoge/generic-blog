import type { APIRoute } from "astro";
import { config } from "@blog-flow/shared";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.BLOG_DB;
  const { results } = await db
    .prepare(
      "SELECT slug, category, published_at, updated_at FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 5000",
    )
    .all<{ slug: string; category: string; published_at: string; updated_at: string }>();

  const posts = results ?? [];
  const categories = [...new Set(posts.map((p) => p.category))].filter((c) =>
    config.niche.categories.includes(c),
  );
  const newest = posts[0]?.updated_at ?? new Date().toISOString();

  const urls: { loc: string; lastmod?: string }[] = [
    { loc: `${config.siteUrl}/`, lastmod: newest },
    { loc: `${config.siteUrl}/blog/`, lastmod: newest },
    { loc: `${config.siteUrl}/about/` },
    ...categories.map((c) => ({ loc: `${config.siteUrl}/category/${c}/` })),
    ...posts.map((p) => ({
      loc: `${config.siteUrl}/blog/${p.slug}/`,
      lastmod: p.updated_at ?? p.published_at,
    })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${esc(u.loc)}</loc>${
        u.lastmod ? `<lastmod>${u.lastmod.slice(0, 10)}</lastmod>` : ""
      }</url>`,
  )
  .join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=600",
    },
  });
};
