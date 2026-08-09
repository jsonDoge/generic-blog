export interface Env {
  BLOG_DB: D1Database;
  MEDIA: R2Bucket;
  AI: Ai;
  BROWSER: Fetcher;
  TOPIC_INDEX: VectorizeIndex;
  RESEARCH_WORKFLOW: Workflow;
  /** Bearer token protecting /admin. Set with `wrangler secret put ADMIN_TOKEN`. */
  ADMIN_TOKEN: string;
  /** Optional: enables the Brave web-search discovery layer. */
  BRAVE_API_KEY?: string;
}
