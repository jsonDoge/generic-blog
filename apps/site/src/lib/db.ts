import type { Post } from "@blog-flow/shared";

/** Parse JSON columns on a raw posts row. */
function hydrate(row: Record<string, unknown>): Post {
  return {
    ...(row as unknown as Post),
    tags: safeTags(row.tags),
  };
}

function safeTags(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

const LIST_COLUMNS =
  "id, slug, title, description, category, tags, '' AS markdown, hero_image_key, status, fact_check_score, author, reading_minutes, created_at, published_at, updated_at";

export async function listPublished(
  db: D1Database,
  opts: { category?: string; limit?: number; offset?: number } = {},
): Promise<Post[]> {
  const { category, limit = 24, offset = 0 } = opts;
  const stmt = category
    ? db
        .prepare(
          `SELECT ${LIST_COLUMNS} FROM posts WHERE status = 'published' AND category = ? ORDER BY published_at DESC LIMIT ? OFFSET ?`,
        )
        .bind(category, limit, offset)
    : db
        .prepare(
          `SELECT ${LIST_COLUMNS} FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT ? OFFSET ?`,
        )
        .bind(limit, offset);
  const { results } = await stmt.all();
  return (results ?? []).map(hydrate);
}

export async function getPublishedBySlug(
  db: D1Database,
  slug: string,
): Promise<Post | null> {
  const row = await db
    .prepare("SELECT * FROM posts WHERE slug = ? AND status = 'published'")
    .bind(slug)
    .first();
  return row ? hydrate(row as Record<string, unknown>) : null;
}

export interface CitedSource {
  url: string;
  title: string | null;
  site: string | null;
}

/** Distinct sources cited by a post's verified claims (for the Sources section). */
export async function getPostSources(
  db: D1Database,
  postId: number,
): Promise<CitedSource[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT s.url, s.title, s.site
       FROM sources s WHERE s.post_id = ? ORDER BY s.id`,
    )
    .bind(postId)
    .all();
  return (results ?? []) as unknown as CitedSource[];
}
