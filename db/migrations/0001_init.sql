-- Migration 0001: core schema.
-- Applied via `wrangler d1 migrations apply BLOG_DB` (see scripts/provision.sh).

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'guides',
  tags TEXT NOT NULL DEFAULT '[]',              -- JSON array of strings
  markdown TEXT NOT NULL,
  hero_image_key TEXT,                          -- R2 object key, nullable
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'rejected')),
  fact_check_score INTEGER,                     -- 0-100, null = not checked
  author TEXT NOT NULL DEFAULT '',
  reading_minutes INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_status_published
  ON posts (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_category
  ON posts (category, status, published_at DESC);

-- Sources gathered for an article. Raw extracted markdown is archived in R2
-- (r2_key) so fact-checks and audits can be re-run without re-fetching.
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  title TEXT,
  site TEXT,
  method TEXT NOT NULL DEFAULT 'fetch' CHECK (method IN ('fetch', 'browser')),
  r2_key TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sources_post ON sources (post_id);

-- Claim-level citations: every factual claim in a post, tied to the exact
-- source quote that supports it. Written during synthesis, verified during
-- the fact-check pass, and rendered as the article's "Sources" section.
CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  claim TEXT NOT NULL,
  source_url TEXT NOT NULL,
  quote TEXT NOT NULL DEFAULT '',
  verdict TEXT CHECK (verdict IN ('supported', 'unsupported', 'uncertain'))
);
CREATE INDEX IF NOT EXISTS idx_claims_post ON claims (post_id);

-- Topic queue: discovery proposes rows, the writing stage consumes them.
-- You can also enqueue topics manually via the admin UI.
CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  rationale TEXT,
  keywords TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'in_progress', 'done', 'skipped', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_topics_status ON topics (status, created_at);

-- One row per workflow step execution — the pipeline's flight recorder.
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  topic_id INTEGER,
  post_id INTEGER,
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_workflow ON pipeline_runs (workflow_id);
