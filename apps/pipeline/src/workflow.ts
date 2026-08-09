import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { config, slugify, readingMinutes, hostnameOf } from "@blog-flow/shared";
import type { Env } from "./env";
import { runModel, extractJson, embed, fillTemplate } from "./lib/ai";
import { fetchAllFeeds, type FeedItem } from "./lib/feeds";
import { braveSearch } from "./lib/search";
import { extractSource, type GatheredSource } from "./lib/sources";
import discoveryPrompt from "../../../prompts/discovery.md";
import synthesisPrompt from "../../../prompts/synthesis.md";
import factCheckPrompt from "../../../prompts/fact-check.md";

export interface ResearchParams {
  /** Run a specific queued topic (from the admin UI) instead of the oldest. */
  topicId?: number;
}

interface TopicRow {
  id: number;
  title: string;
  rationale: string | null;
  keywords: string | null;
}

interface Draft {
  title: string;
  description: string;
  category: string;
  tags: string[];
  markdown: string;
  claims: Array<{ claim: string; source_url: string; quote: string }>;
}

interface FactCheck {
  score: number;
  verdicts: Array<{ claim: string; verdict: string; note: string }>;
  problems: string[];
  revised_markdown: string | null;
}

const UA = `BlogFlowBot/1.0 (+${config.siteUrl})`;

export class ResearchWorkflow extends WorkflowEntrypoint<Env, ResearchParams> {
  async run(event: WorkflowEvent<ResearchParams>, step: WorkflowStep) {
    const env = this.env;
    const wfId = event.instanceId;
    const log = (stepName: string, status: string, extra: Record<string, unknown> = {}) =>
      recordRun(env, wfId, stepName, status, extra);

    /* ---- 1. Discovery: keep the topic queue fed --------------------------- */
    await step.do("discover-topics", { retries: { limit: 2, delay: "30 seconds", backoff: "exponential" }, timeout: "5 minutes" }, async () => {
      const queued = await env.BLOG_DB.prepare(
        "SELECT COUNT(*) AS n FROM topics WHERE status = 'queued'",
      ).first<{ n: number }>();
      if ((queued?.n ?? 0) >= 3) return { discovered: 0, reason: "queue full enough" };

      const feedItems = await fetchAllFeeds(config.niche.seedFeeds, UA);
      const searchResults = await braveSearch(
        `${config.niche.topic} news`,
        env.BRAVE_API_KEY,
      );
      const candidates = [
        ...feedItems.map((f) => `- [feed:${f.feed}] ${f.title} — ${f.summary} (${f.url})`),
        ...searchResults.map((s) => `- [search] ${s.title} — ${s.description} (${s.url})`),
      ]
        .slice(0, 80)
        .join("\n");
      if (!candidates) return { discovered: 0, reason: "no candidate material" };

      const { results: recent } = await env.BLOG_DB.prepare(
        "SELECT title FROM posts ORDER BY id DESC LIMIT 30",
      ).all<{ title: string }>();
      const { results: recentTopics } = await env.BLOG_DB.prepare(
        "SELECT title FROM topics ORDER BY id DESC LIMIT 30",
      ).all<{ title: string }>();
      const existing = [...(recent ?? []), ...(recentTopics ?? [])]
        .map((r) => `- ${r.title}`)
        .join("\n") || "(none yet)";

      const raw = await runModel(env, config.models.utility, {
        prompt: fillTemplate(discoveryPrompt, {
          TOPIC: config.niche.topic,
          AUDIENCE: config.niche.audience,
          MAX_TOPICS: "5",
          EXISTING_TITLES: existing,
          CANDIDATES: candidates,
        }),
      });
      const parsed = extractJson<{ topics: Array<{ title: string; rationale: string; keywords: string }> }>(raw);

      let inserted = 0;
      for (const t of (parsed.topics ?? []).slice(0, 5)) {
        if (!t.title) continue;
        await env.BLOG_DB.prepare(
          "INSERT INTO topics (title, rationale, keywords) VALUES (?, ?, ?)",
        ).bind(t.title, t.rationale ?? null, t.keywords ?? null).run();
        inserted++;
      }
      await log("discover-topics", "succeeded", { inserted });
      return { discovered: inserted };
    });

    /* ---- 2. Pick a topic --------------------------------------------------- */
    const topic = await step.do("pick-topic", async (): Promise<TopicRow | null> => {
      const row = event.payload.topicId
        ? await env.BLOG_DB.prepare(
            "SELECT id, title, rationale, keywords FROM topics WHERE id = ? AND status = 'queued'",
          ).bind(event.payload.topicId).first<TopicRow>()
        : await env.BLOG_DB.prepare(
            "SELECT id, title, rationale, keywords FROM topics WHERE status = 'queued' ORDER BY created_at LIMIT 1",
          ).first<TopicRow>();
      if (!row) return null;
      await env.BLOG_DB.prepare("UPDATE topics SET status = 'in_progress' WHERE id = ?")
        .bind(row.id).run();
      await log("pick-topic", "succeeded", { topicId: row.id, title: row.title });
      return row;
    });
    if (!topic) {
      await log("pick-topic", "succeeded", { note: "no queued topics; run ends" });
      return { outcome: "no-topic" };
    }

    /* ---- 3. Dedup against existing posts (Vectorize) ----------------------- */
    const dup = await step.do("dedup-check", async () => {
      try {
        const vector = await embed(env, config.models.embedding, `${topic.title} ${topic.keywords ?? ""}`);
        const matches = await env.TOPIC_INDEX.query(vector, { topK: 1 });
        const top = matches.matches?.[0];
        if (top && top.score >= config.pipeline.similarityThreshold) {
          await env.BLOG_DB.prepare("UPDATE topics SET status = 'skipped' WHERE id = ?")
            .bind(topic.id).run();
          await log("dedup-check", "succeeded", { skipped: true, match: top.id, score: top.score });
          return { skip: true };
        }
      } catch (e) {
        // Vectorize being unavailable should not stop publication.
        await log("dedup-check", "succeeded", { warning: String(e) });
      }
      return { skip: false };
    });
    if (dup.skip) return { outcome: "duplicate-topic", topicId: topic.id };

    /* ---- 4. Gather sources ------------------------------------------------- */
    const sources = await step.do("gather-sources", { retries: { limit: 2, delay: "1 minute", backoff: "exponential" }, timeout: "10 minutes" }, async () => {
      const query = topic.keywords || topic.title;
      const [feedItems, searchResults] = await Promise.all([
        fetchAllFeeds(config.niche.seedFeeds, UA),
        braveSearch(query, env.BRAVE_API_KEY, 10),
      ]);

      const keywords = query.toLowerCase().split(/[,\s]+/).filter((w) => w.length > 3);
      const scored: Array<{ url: string; score: number }> = [];
      const seen = new Set<string>();
      const consider = (url: string, text: string, bonus: number) => {
        if (!url || seen.has(url)) return;
        const host = hostnameOf(url);
        if (config.niche.blockedDomains.some((d) => host.endsWith(d))) return;
        seen.add(url);
        const t = text.toLowerCase();
        const hits = keywords.filter((k) => t.includes(k)).length;
        scored.push({ url, score: hits + bonus });
      };
      // Search results get a relevance bonus — they matched the query already.
      for (const s of searchResults) consider(s.url, `${s.title} ${s.description}`, 3);
      for (const f of feedItems as FeedItem[]) consider(f.url, `${f.title} ${f.summary}`, 0);

      const ranked = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
      const gathered: GatheredSource[] = [];
      for (const cand of ranked.slice(0, config.pipeline.maxSources * 3)) {
        if (gathered.length >= config.pipeline.maxSources) break;
        const src = await extractSource(env, cand.url, UA);
        if (src) gathered.push(src);
      }

      if (gathered.length < 2) {
        throw new Error(`Only ${gathered.length} usable sources for "${topic.title}" — need at least 2`);
      }

      // Archive raw source markdown to R2 for auditability + re-checks.
      const withKeys = [];
      for (let i = 0; i < gathered.length; i++) {
        const key = `sources/${wfId}/${i}-${hostnameOf(gathered[i].url).replace(/[^a-z0-9.-]/gi, "_")}.md`;
        await env.MEDIA.put(key, gathered[i].markdown, {
          httpMetadata: { contentType: "text/markdown" },
        });
        withKeys.push({ ...gathered[i], r2_key: key, markdown: gathered[i].markdown.slice(0, 10_000) });
      }
      await log("gather-sources", "succeeded", { count: withKeys.length });
      return withKeys;
    });

    /* ---- 5. Synthesize + write --------------------------------------------- */
    const draft = await step.do("synthesize", { retries: { limit: 2, delay: "30 seconds", backoff: "exponential" }, timeout: "10 minutes" }, async () => {
      const sourceBlocks = sources
        .map((s, i) => `### SOURCE ${i + 1}: ${s.title}\nURL: ${s.url}\n\n${s.markdown}`)
        .join("\n\n---\n\n");
      const raw = await runModel(env, config.models.writer, {
        prompt: fillTemplate(synthesisPrompt, {
          TOPIC: config.niche.topic,
          AUDIENCE: config.niche.audience,
          ARTICLE_TOPIC: topic.title,
          SOURCE_COUNT: String(sources.length),
          TARGET_WORDS: String(config.pipeline.targetWords),
          CATEGORIES: config.niche.categories.join(", "),
          SOURCES: sourceBlocks,
        }),
      });
      const parsed = extractJson<Draft>(raw);
      if (!parsed.title || !parsed.markdown || !Array.isArray(parsed.claims)) {
        throw new Error("Synthesis output missing required fields");
      }
      await log("synthesize", "succeeded", {
        title: parsed.title,
        words: parsed.markdown.split(/\s+/).length,
        claims: parsed.claims.length,
      });
      return parsed;
    });

    /* ---- 6. Fact-check ------------------------------------------------------ */
    const check = await step.do("fact-check", { retries: { limit: 2, delay: "30 seconds", backoff: "exponential" }, timeout: "10 minutes" }, async () => {
      const raw = await runModel(env, config.models.writer, {
        prompt: fillTemplate(factCheckPrompt, {
          MIN_SCORE: String(config.pipeline.minFactCheckScore),
          ARTICLE: draft.markdown,
          CLAIMS: JSON.stringify(draft.claims, null, 2),
          SOURCES: sources
            .map((s) => `### ${s.url}\n${s.markdown.slice(0, 6000)}`)
            .join("\n\n---\n\n"),
        }),
      });
      const parsed = extractJson<FactCheck>(raw);
      if (typeof parsed.score !== "number") throw new Error("Fact-check output missing score");
      await log("fact-check", "succeeded", { score: parsed.score, problems: parsed.problems?.length ?? 0 });
      return parsed;
    });

    /* ---- 7. Save to D1 (+ Vectorize + link sources) ------------------------- */
    const result = await step.do("save", async () => {
      const passed = check.score >= config.pipeline.minFactCheckScore;
      const markdown = (passed && check.revised_markdown) || draft.markdown;
      const status = !passed
        ? "rejected"
        : config.pipeline.autoPublish
          ? "published"
          : "draft";

      let slug = slugify(draft.title);
      const clash = await env.BLOG_DB.prepare("SELECT 1 FROM posts WHERE slug = ?")
        .bind(slug).first();
      if (clash) slug = `${slug}-${wfId.slice(0, 6)}`;

      const now = new Date().toISOString();
      const insert = await env.BLOG_DB.prepare(
        `INSERT INTO posts (slug, title, description, category, tags, markdown, status, fact_check_score, author, reading_minutes, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      ).bind(
        slug,
        draft.title,
        draft.description ?? "",
        config.niche.categories.includes(draft.category) ? draft.category : config.niche.categories[0],
        JSON.stringify(draft.tags ?? []),
        markdown,
        status,
        check.score,
        config.author.name,
        readingMinutes(markdown),
        status === "published" ? now : null,
      ).first<{ id: number }>();
      const postId = insert!.id;

      const verdictByClaim = new Map(
        (check.verdicts ?? []).map((v) => [v.claim, v.verdict]),
      );
      for (const c of draft.claims) {
        const verdict = verdictByClaim.get(c.claim);
        await env.BLOG_DB.prepare(
          "INSERT INTO claims (post_id, claim, source_url, quote, verdict) VALUES (?, ?, ?, ?, ?)",
        ).bind(
          postId,
          c.claim,
          c.source_url,
          c.quote ?? "",
          ["supported", "unsupported", "uncertain"].includes(verdict ?? "") ? verdict : null,
        ).run();
      }
      for (const s of sources) {
        await env.BLOG_DB.prepare(
          "INSERT INTO sources (post_id, url, title, site, method, r2_key) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(postId, s.url, s.title, s.site, s.method, s.r2_key).run();
      }

      try {
        const vector = await embed(env, config.models.embedding, `${draft.title} ${draft.description}`);
        await env.TOPIC_INDEX.upsert([
          { id: `post-${postId}`, values: vector, metadata: { slug, title: draft.title } },
        ]);
      } catch {
        // non-fatal
      }

      await env.BLOG_DB.prepare("UPDATE topics SET status = ? WHERE id = ?")
        .bind(passed ? "done" : "failed", topic.id).run();
      await log("save", "succeeded", { postId, slug, status, score: check.score });
      return { postId, slug, status, score: check.score };
    });

    return { outcome: "completed", ...result, topicId: topic.id };
  }
}

async function recordRun(
  env: Env,
  workflowId: string,
  stepName: string,
  status: string,
  extra: Record<string, unknown>,
) {
  try {
    await env.BLOG_DB.prepare(
      "INSERT INTO pipeline_runs (workflow_id, step, status, error, finished_at) VALUES (?, ?, ?, ?, datetime('now'))",
    ).bind(
      workflowId,
      stepName,
      status === "failed" ? "failed" : "succeeded",
      Object.keys(extra).length ? JSON.stringify(extra).slice(0, 2000) : null,
    ).run();
  } catch {
    // the flight recorder must never crash the plane
  }
}
