import { config } from "@blog-flow/shared";
import type { Env } from "./env";

/**
 * Minimal review console at /admin.
 * Auth: Bearer ADMIN_TOKEN on every /admin/api/* call (the HTML shell itself
 * is public but useless without the token). For team use, put Cloudflare
 * Access in front of this worker as a second layer.
 */
export async function handleAdmin(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/admin" || path === "/admin/") {
    return new Response(ADMIN_HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (!path.startsWith("/admin/api/")) return json({ error: "not found" }, 404);

  const auth = req.headers.get("Authorization") ?? "";
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const db = env.BLOG_DB;

  // GET /admin/api/overview
  if (path === "/admin/api/overview" && req.method === "GET") {
    const [drafts, topics, runs] = await Promise.all([
      db.prepare(
        "SELECT id, slug, title, description, category, status, fact_check_score, created_at FROM posts WHERE status != 'published' ORDER BY id DESC LIMIT 30",
      ).all(),
      db.prepare(
        "SELECT id, title, keywords, status, created_at FROM topics ORDER BY id DESC LIMIT 30",
      ).all(),
      db.prepare(
        "SELECT workflow_id, step, status, error, finished_at FROM pipeline_runs ORDER BY id DESC LIMIT 40",
      ).all(),
    ]);
    const published = await db
      .prepare("SELECT COUNT(*) AS n FROM posts WHERE status = 'published'")
      .first<{ n: number }>();
    return json({
      drafts: drafts.results,
      topics: topics.results,
      runs: runs.results,
      publishedCount: published?.n ?? 0,
    });
  }

  // GET /admin/api/posts/:id  (full markdown + claims for review)
  let m = path.match(/^\/admin\/api\/posts\/(\d+)$/);
  if (m && req.method === "GET") {
    const post = await db.prepare("SELECT * FROM posts WHERE id = ?").bind(m[1]).first();
    if (!post) return json({ error: "not found" }, 404);
    const claims = await db
      .prepare("SELECT claim, source_url, quote, verdict FROM claims WHERE post_id = ?")
      .bind(m[1]).all();
    return json({ post, claims: claims.results });
  }

  // POST /admin/api/posts/:id/publish | reject
  m = path.match(/^\/admin\/api\/posts\/(\d+)\/(publish|reject)$/);
  if (m && req.method === "POST") {
    const status = m[2] === "publish" ? "published" : "rejected";
    await db.prepare(
      `UPDATE posts SET status = ?, published_at = CASE WHEN ? = 'published' THEN datetime('now') ELSE published_at END, updated_at = datetime('now') WHERE id = ?`,
    ).bind(status, status, m[1]).run();
    return json({ ok: true, status });
  }

  // DELETE /admin/api/posts/:id
  m = path.match(/^\/admin\/api\/posts\/(\d+)$/);
  if (m && req.method === "DELETE") {
    await db.prepare("DELETE FROM posts WHERE id = ?").bind(m[1]).run();
    return json({ ok: true });
  }

  // POST /admin/api/topics {title, keywords?}
  if (path === "/admin/api/topics" && req.method === "POST") {
    const body = (await req.json()) as { title?: string; keywords?: string };
    if (!body.title) return json({ error: "title required" }, 400);
    await db.prepare(
      "INSERT INTO topics (title, keywords, rationale) VALUES (?, ?, 'manually queued')",
    ).bind(body.title, body.keywords ?? null).run();
    return json({ ok: true });
  }

  // POST /admin/api/run {topicId?}  -> start a workflow instance now
  if (path === "/admin/api/run" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { topicId?: number };
    const instance = await env.RESEARCH_WORKFLOW.create({
      params: body.topicId ? { topicId: body.topicId } : {},
    });
    return json({ ok: true, instanceId: instance.id });
  }

  return json({ error: "not found" }, 404);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${config.name} — Pipeline Admin</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0 auto; max-width: 68rem; padding: 1.5rem; line-height: 1.5; }
  h1 { font-size: 1.3rem; } h2 { font-size: 1.05rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #8884; vertical-align: top; }
  button { cursor: pointer; padding: 0.3rem 0.7rem; border-radius: 6px; border: 1px solid #8886; background: transparent; color: inherit; }
  button.primary { background: #3b5bdb; border-color: #3b5bdb; color: #fff; }
  input { padding: 0.4rem 0.6rem; border-radius: 6px; border: 1px solid #8886; background: transparent; color: inherit; }
  .row { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
  .pill { font-size: 0.75rem; padding: 0.1rem 0.5rem; border-radius: 99px; border: 1px solid #8886; }
  pre { white-space: pre-wrap; background: #8881; padding: 1rem; border-radius: 8px; max-height: 24rem; overflow: auto; font-size: 0.8rem; }
  #status { color: #888; font-size: 0.85rem; }
</style>
</head>
<body>
<h1>${config.name} — pipeline admin</h1>
<div class="row">
  <input id="token" type="password" placeholder="Admin token" size="28">
  <button class="primary" onclick="saveToken()">Connect</button>
  <button onclick="runNow()">▶ Run pipeline now</button>
  <span id="status"></span>
</div>

<h2>Drafts &amp; rejected (<span id="published-count">…</span> published)</h2>
<table id="drafts"><thead><tr><th>Title</th><th>Score</th><th>Status</th><th>Actions</th></tr></thead><tbody></tbody></table>
<div id="preview"></div>

<h2>Topic queue</h2>
<div class="row" style="margin-bottom:0.6rem">
  <input id="new-topic" placeholder="Add topic title" size="40">
  <input id="new-keywords" placeholder="keywords (optional)" size="24">
  <button onclick="addTopic()">Queue topic</button>
</div>
<table id="topics"><thead><tr><th>Topic</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody></tbody></table>

<h2>Recent pipeline steps</h2>
<table id="runs"><thead><tr><th>Workflow</th><th>Step</th><th>Status</th><th>Detail</th><th>When</th></tr></thead><tbody></tbody></table>

<script>
const $ = (s) => document.querySelector(s);
let TOKEN = localStorage.getItem("admin_token") || "";
if (TOKEN) $("#token").value = TOKEN;

function saveToken() {
  TOKEN = $("#token").value.trim();
  localStorage.setItem("admin_token", TOKEN);
  refresh();
}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
function esc(s) { const d = document.createElement("span"); d.textContent = String(s ?? ""); return d.innerHTML; }

async function refresh() {
  if (!TOKEN) { $("#status").textContent = "enter your admin token"; return; }
  try {
    const o = await api("/admin/api/overview");
    $("#status").textContent = "connected";
    $("#published-count").textContent = o.publishedCount;
    $("#drafts tbody").innerHTML = o.drafts.map(p =>
      '<tr><td>' + esc(p.title) + '<br><small>' + esc(p.description) + '</small></td>' +
      '<td>' + esc(p.fact_check_score ?? "—") + '</td>' +
      '<td><span class="pill">' + esc(p.status) + '</span></td>' +
      '<td class="row">' +
        '<button onclick="preview(' + p.id + ')">Preview</button>' +
        '<button class="primary" onclick="act(' + p.id + ', \\'publish\\')">Publish</button>' +
        '<button onclick="act(' + p.id + ', \\'reject\\')">Reject</button>' +
        '<button onclick="del(' + p.id + ')">Delete</button>' +
      '</td></tr>').join("") || '<tr><td colspan="4">No drafts.</td></tr>';
    $("#topics tbody").innerHTML = o.topics.map(t =>
      '<tr><td>' + esc(t.title) + '</td><td><span class="pill">' + esc(t.status) + '</span></td>' +
      '<td>' + esc(t.created_at) + '</td>' +
      '<td>' + (t.status === "queued" ? '<button onclick="runTopic(' + t.id + ')">Run this</button>' : '') + '</td></tr>'
    ).join("") || '<tr><td colspan="4">No topics.</td></tr>';
    $("#runs tbody").innerHTML = o.runs.map(r =>
      '<tr><td><small>' + esc(r.workflow_id.slice(0, 8)) + '</small></td><td>' + esc(r.step) + '</td>' +
      '<td><span class="pill">' + esc(r.status) + '</span></td>' +
      '<td><small>' + esc(r.error ?? "") + '</small></td><td><small>' + esc(r.finished_at ?? "") + '</small></td></tr>'
    ).join("") || '<tr><td colspan="5">No runs yet.</td></tr>';
  } catch (e) {
    $("#status").textContent = "error: " + e.message;
  }
}
async function preview(id) {
  const d = await api("/admin/api/posts/" + id);
  $("#preview").innerHTML = "<h2>Preview: " + esc(d.post.title) + "</h2><pre>" + esc(d.post.markdown) +
    "</pre><h2>Claims</h2><pre>" + esc(JSON.stringify(d.claims, null, 2)) + "</pre>";
  $("#preview").scrollIntoView({ behavior: "smooth" });
}
async function act(id, action) { await api("/admin/api/posts/" + id + "/" + action, { method: "POST" }); refresh(); }
async function del(id) { if (confirm("Delete post " + id + "?")) { await api("/admin/api/posts/" + id, { method: "DELETE" }); refresh(); } }
async function addTopic() {
  const title = $("#new-topic").value.trim();
  if (!title) return;
  await api("/admin/api/topics", { method: "POST", body: JSON.stringify({ title, keywords: $("#new-keywords").value.trim() || undefined }) });
  $("#new-topic").value = ""; $("#new-keywords").value = "";
  refresh();
}
async function runNow() { const r = await api("/admin/api/run", { method: "POST", body: "{}" }); $("#status").textContent = "started workflow " + r.instanceId; setTimeout(refresh, 3000); }
async function runTopic(id) { const r = await api("/admin/api/run", { method: "POST", body: JSON.stringify({ topicId: id }) }); $("#status").textContent = "started workflow " + r.instanceId; setTimeout(refresh, 3000); }

refresh();
setInterval(refresh, 20000);
</script>
</body>
</html>`;
