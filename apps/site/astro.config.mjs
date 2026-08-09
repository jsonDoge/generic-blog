// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// SSR on a Cloudflare Worker: pages render from D1 at request time, so a
// pipeline insert is live immediately — no rebuilds. Edge caching happens
// via Cache-Control headers set per route.
export default defineConfig({
  output: "server",
  adapter: cloudflare({
    // Local `astro dev` gets real D1/R2 bindings emulated from wrangler.jsonc
    platformProxy: { enabled: true, configPath: "wrangler.jsonc" },
  }),
});
