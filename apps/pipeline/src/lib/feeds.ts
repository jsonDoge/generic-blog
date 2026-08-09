import { XMLParser } from "fast-xml-parser";
import { hostnameOf } from "@blog-flow/shared";

export interface FeedItem {
  title: string;
  url: string;
  summary: string;
  published: string | null;
  feed: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

/** Fetch and parse RSS 2.0 / Atom feeds. Failures return [] — one dead feed
 * must never kill a pipeline run. */
export async function fetchFeed(feedUrl: string, userAgent: string): Promise<FeedItem[]> {
  try {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": userAgent, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const doc = parser.parse(xml);

    // RSS 2.0
    const rssItems = doc?.rss?.channel?.item;
    if (rssItems) {
      return asArray(rssItems).slice(0, 30).map((it) => ({
        title: textOf(it.title),
        url: textOf(it.link),
        summary: strip(textOf(it.description)).slice(0, 500),
        published: textOf(it.pubDate) || null,
        feed: hostnameOf(feedUrl),
      })).filter((i) => i.title && i.url);
    }

    // Atom
    const atomEntries = doc?.feed?.entry;
    if (atomEntries) {
      return asArray(atomEntries).slice(0, 30).map((it) => {
        const links = asArray(it.link);
        const alt =
          links.find((l) => l?.["@_rel"] === "alternate") ?? links[0];
        return {
          title: textOf(it.title),
          url: (alt?.["@_href"] as string) ?? "",
          summary: strip(textOf(it.summary) || textOf(it.content)).slice(0, 500),
          published: textOf(it.updated) || textOf(it.published) || null,
          feed: hostnameOf(feedUrl),
        };
      }).filter((i) => i.title && i.url);
    }
    return [];
  } catch {
    return [];
  }
}

export async function fetchAllFeeds(feeds: string[], userAgent: string): Promise<FeedItem[]> {
  const results = await Promise.all(feeds.map((f) => fetchFeed(f, userAgent)));
  return results.flat();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function asArray(v: any): any[] {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

function textOf(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object" && "#text" in v) return String(v["#text"]).trim();
  return String(v).trim();
}

function strip(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
