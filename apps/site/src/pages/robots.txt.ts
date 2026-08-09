import type { APIRoute } from "astro";
import { config } from "@blog-flow/shared";

export const GET: APIRoute = () => {
  const body = `User-agent: *
Allow: /

Sitemap: ${config.siteUrl}/sitemap.xml
`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400",
    },
  });
};
