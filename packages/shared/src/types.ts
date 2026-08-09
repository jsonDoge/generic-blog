/** Shared types for blog.config.ts, the site, and the pipeline. */

export interface BlogConfig {
  name: string;
  tagline: string;
  description: string;
  siteUrl: string;
  locale: string;
  twitterHandle?: string;
  organization: { name: string; sameAs: string[] };
  author: { name: string; url: string };
  niche: {
    topic: string;
    audience: string;
    categories: string[];
    seedFeeds: string[];
    blockedDomains: string[];
  };
  pipeline: {
    autoPublish: boolean;
    minFactCheckScore: number;
    similarityThreshold: number;
    maxSources: number;
    targetWords: number;
  };
  models: {
    writer: string;
    utility: string;
    embedding: string;
  };
}

export type PostStatus = "draft" | "published" | "rejected";

/** Row shape of the `posts` table (JSON columns already parsed). */
export interface Post {
  id: number;
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  markdown: string;
  hero_image_key: string | null;
  status: PostStatus;
  fact_check_score: number | null;
  author: string;
  reading_minutes: number;
  created_at: string;
  published_at: string | null;
  updated_at: string;
}

export interface PostSource {
  id: number;
  post_id: number | null;
  url: string;
  title: string | null;
  site: string | null;
  method: "fetch" | "browser";
  r2_key: string | null;
  fetched_at: string;
}

export interface Claim {
  id: number;
  post_id: number;
  claim: string;
  source_url: string;
  quote: string;
  verdict: "supported" | "unsupported" | "uncertain" | null;
}

export interface Topic {
  id: number;
  title: string;
  rationale: string | null;
  keywords: string | null;
  status: "queued" | "in_progress" | "done" | "skipped" | "failed";
  created_at: string;
}

export interface PipelineRun {
  id: number;
  workflow_id: string;
  topic_id: number | null;
  post_id: number | null;
  step: string;
  status: "running" | "succeeded" | "failed";
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

/** Estimate reading time from markdown. */
export function readingMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

/** URL-safe slug from a title. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/-$/, "");
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
