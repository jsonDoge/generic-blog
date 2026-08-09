import type { APIRoute } from "astro";

/**
 * Serves R2 objects at /images/<key> with immutable caching.
 * Pipeline-generated media uses content-addressed keys, so long cache
 * lifetimes are safe. For on-the-fly resizing, put Cloudflare Image
 * Resizing (or a `cf: {image: ...}` fetch) in front of this route.
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const key = params.key;
  if (!key || key.includes("..")) {
    return new Response("Bad request", { status: 400 });
  }

  const object = await locals.runtime.env.MEDIA.get(key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/octet-stream");
  }
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
};
