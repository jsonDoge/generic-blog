import type { APIRoute } from "astro";
import { config } from "@blog-flow/shared";

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.BLOG_DB;
  const { results } = await db
    .prepare(
      "SELECT slug, title, description, published_at FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 20",
    )
    .all<{ slug: string; title: string; description: string; published_at: string }>();

  const items = (results ?? [])
    .map((p) => {
      const url = `${config.siteUrl}/blog/${p.slug}/`;
      return `    <item>
      <title>${esc(p.title)}</title>
      <link>${url}</link>
      <guid>${url}</guid>
      <pubDate>${new Date(p.published_at).toUTCString()}</pubDate>
      <description>${esc(p.description)}</description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(config.name)}</title>
    <link>${config.siteUrl}/</link>
    <description>${esc(config.description)}</description>
    <language>${config.locale}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${config.siteUrl}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=600",
    },
  });
};
