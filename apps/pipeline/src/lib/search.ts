/** Optional Brave Search discovery layer. No key -> empty results, and the
 * pipeline falls back to feed-only discovery. */
export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export async function braveSearch(
  query: string,
  apiKey: string | undefined,
  count = 8,
): Promise<SearchResult[]> {
  if (!apiKey) return [];
  try {
    const u = new URL("https://api.search.brave.com/res/v1/web/search");
    u.searchParams.set("q", query);
    u.searchParams.set("count", String(count));
    u.searchParams.set("freshness", "pm"); // past month — we want current sources
    const res = await fetch(u, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      web?: { results?: Array<{ title: string; url: string; description?: string }> };
    };
    return (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description ?? "",
    }));
  } catch {
    return [];
  }
}
