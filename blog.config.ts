/**
 * BLOG CONFIG — the single file every fork edits to become its own blog.
 *
 * Change this + prompts/*.md + the design tokens in
 * apps/site/src/styles/theme.css, then run `pnpm provision`.
 */
import type { BlogConfig } from "./packages/shared/src/types";

export const config: BlogConfig = {
  /* ---- Identity (used in <head>, JSON-LD, RSS, OG tags) ---------------- */
  name: "Blog Flow",
  tagline: "Practical guides and honest insights, published weekly",
  description:
    "In-depth guides, honest reviews and practical insights, written and fact-checked from primary sources.",
  // Production origin — update after you attach your domain to the site worker.
  siteUrl: "https://blog-flow.example.com",
  locale: "en",
  twitterHandle: "@yourhandle",
  organization: {
    name: "Blog Flow",
    sameAs: [
      "https://twitter.com/yourhandle",
      "https://www.youtube.com/@yourhandle",
    ],
  },
  author: {
    // Displayed as the byline for pipeline-generated posts. For E-E-A-T,
    // make this a real, named editor who reviews drafts before publishing.
    name: "Alex Doe",
    url: "/about/",
  },

  /* ---- Niche: what the pipeline researches ----------------------------- */
  niche: {
    // One sentence the LLM uses to stay on-topic. Be specific.
    topic:
      "practical productivity systems, tools and habits for knowledge workers",
    // Who the articles are for — shapes tone and depth.
    audience: "busy professionals who want actionable, evidence-based advice",
    // Categories the pipeline may assign. First one is the default.
    categories: ["guides", "reviews", "insights", "news"],
    // Backbone of discovery: RSS/Atom feeds of trustworthy sources.
    // The pipeline reads these every run. 5-15 quality feeds beat 50 noisy ones.
    seedFeeds: [
      "https://hnrss.org/frontpage",
      // "https://example-industry-blog.com/feed.xml",
    ],
    // Domains to never use as sources (competitors, content farms).
    blockedDomains: ["pinterest.com", "quora.com", "reddit.com"],
  },

  /* ---- Pipeline behavior ------------------------------------------------ */
  pipeline: {
    // false (default) = pipeline writes drafts; you approve them in the
    // admin UI. true = publish automatically when factCheck passes.
    // Keep false until you trust the output quality for your niche.
    autoPublish: false,
    // Discard articles scoring below this in the fact-check pass (0-100).
    minFactCheckScore: 75,
    // Skip a topic if cosine similarity to an existing post exceeds this.
    similarityThreshold: 0.88,
    // How many sources to gather per article (3-6 is the sweet spot).
    maxSources: 5,
    // Target article length in words.
    targetWords: 1400,
    // NOTE: the cron schedule itself lives in apps/pipeline/wrangler.jsonc
    // ("triggers.crons") because wrangler needs it statically.
  },

  /* ---- Models (Workers AI) ---------------------------------------------- */
  models: {
    // Heavy lifting: synthesis, article writing, fact-checking.
    writer: "@cf/openai/gpt-oss-120b",
    // Cheap mechanical work: topic triage, titles, meta descriptions.
    utility: "@cf/openai/gpt-oss-20b",
    // Embeddings for topic dedup + related posts (768 dims — must match
    // the Vectorize index created by scripts/provision.sh).
    embedding: "@cf/baai/bge-base-en-v1.5",
  },
};

export default config;
