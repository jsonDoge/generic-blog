import puppeteer from "@cloudflare/puppeteer";
import { hostnameOf } from "@blog-flow/shared";
import type { Env } from "../env";

export interface GatheredSource {
  url: string;
  title: string;
  site: string;
  method: "fetch" | "browser";
  markdown: string;
}

/** Minimal robots.txt check for the wildcard agent. Fail-open on network
 * errors, fail-closed on explicit Disallow. */
export async function allowedByRobots(url: string, userAgent: string): Promise<boolean> {
  try {
    const target = new URL(url);
    const res = await fetch(new URL("/robots.txt", target.origin), {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return true;
    const text = await res.text();
    const path = target.pathname;

    let applies = false;
    for (const raw of text.split("\n")) {
      const line = raw.split("#")[0].trim();
      if (!line) continue;
      const [keyRaw, ...rest] = line.split(":");
      const key = keyRaw.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") {
        applies = value === "*";
      } else if (applies && key === "disallow" && value) {
        if (value === "/") return false;
        if (path.startsWith(value.replace(/\*.*$/, ""))) return false;
      }
    }
    return true;
  } catch {
    return true;
  }
}

/** Convert HTML to clean markdown via the Workers AI conversion utility. */
async function htmlToMarkdown(env: Env, html: string): Promise<string> {
  const ai = env.AI as unknown as {
    toMarkdown: (
      docs: Array<{ name: string; blob: Blob }>,
    ) => Promise<Array<{ data: string }>>;
  };
  const results = await ai.toMarkdown([
    { name: "page.html", blob: new Blob([html], { type: "text/html" }) },
  ]);
  return results?.[0]?.data ?? "";
}

function titleFromHtml(html: string): string {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim().slice(0, 200) : "";
}

/** Fetch-first extraction with Browser Rendering fallback for JS-heavy pages. */
export async function extractSource(
  env: Env,
  url: string,
  userAgent: string,
): Promise<GatheredSource | null> {
  if (!(await allowedByRobots(url, userAgent))) return null;

  // 1) Plain fetch — covers most articles, costs nothing.
  let html = "";
  let title = "";
  let method: "fetch" | "browser" = "fetch";
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
    const type = res.headers.get("content-type") ?? "";
    if (res.ok && type.includes("html")) {
      html = await res.text();
      title = titleFromHtml(html);
    }
  } catch {
    // fall through to browser
  }

  let markdown = html ? await safeMarkdown(env, html) : "";

  // 2) Browser Rendering fallback when fetch got nothing usable
  //    (blocked, empty shell, or client-rendered page).
  if (markdown.length < 600) {
    try {
      const browser = await puppeteer.launch(env.BROWSER);
      try {
        const page = await browser.newPage();
        await page.setUserAgent(userAgent);
        await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
        html = await page.content();
        title = (await page.title()) || title;
        method = "browser";
      } finally {
        await browser.close();
      }
      markdown = await safeMarkdown(env, html);
    } catch {
      return null;
    }
  }

  if (markdown.length < 600) return null; // too thin to be a real source
  return {
    url,
    title: title || hostnameOf(url),
    site: hostnameOf(url),
    method,
    markdown: markdown.slice(0, 20_000),
  };
}

async function safeMarkdown(env: Env, html: string): Promise<string> {
  try {
    return (await htmlToMarkdown(env, html)).trim();
  } catch {
    // Crude fallback: strip tags. Ugly but keeps the pipeline alive if the
    // conversion utility is unavailable.
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}
