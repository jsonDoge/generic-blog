/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

interface Env {
  BLOG_DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
}

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
