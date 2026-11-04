import "server-only";
import { brandTerms } from "./seo/config";
import { kvGet, kvSet } from "./adminStore";
import type { Mention, MentionsResult } from "./adminTypes";

// Free sources only: Hacker News (Algolia), Reddit's public search JSON,
// and any Google Alerts RSS feeds you configure (GOOGLE_ALERTS_RSS).

const UA = "NorthBooksDashboard/1.0 (personal admin tool)";
const g = globalThis as unknown as { __mentions?: { at: number; res: Omit<MentionsResult, "items"> & { items: Omit<Mention, "isNew">[] } } };

export function mentionTerms(): string[] {
  const env = process.env.MENTION_TERMS?.split(",").map((s) => s.trim()).filter(Boolean);
  return env?.length ? env : brandTerms().filter((t) => t.length > 3);
}

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const strip = (s: string) => decode(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

type Item = Omit<Mention, "isNew">;

export async function fromHackerNews(term: string): Promise<Item[]> {
  const since = Math.floor(Date.now() / 1000) - 60 * 86_400;
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(`"${term}"`)}&tags=(story,comment)&numericFilters=created_at_i>${since}&hitsPerPage=30`;
  const j = (await getJson(url)) as { hits?: Record<string, unknown>[] };
  return (j.hits ?? []).map((h) => {
    const id = String(h.objectID);
    const isComment = h.comment_text !== undefined && h.comment_text !== null;
    return {
      id: `hn:${id}`,
      source: "hackernews" as const,
      title: String(h.title ?? h.story_title ?? "(comment)"),
      url: `https://news.ycombinator.com/item?id=${id}`,
      author: (h.author as string) ?? null,
      date: String(h.created_at ?? new Date().toISOString()),
      snippet: isComment ? strip(String(h.comment_text)).slice(0, 280) : null,
      context: isComment ? "comment" : `${h.points ?? 0} points`,
    };
  });
}

export async function fromReddit(term: string): Promise<Item[]> {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(`"${term}"`)}&sort=new&t=month&limit=30`;
  const j = (await getJson(url)) as { data?: { children?: { data: Record<string, unknown> }[] } };
  return (j.data?.children ?? []).map(({ data: d }) => ({
    id: `reddit:${d.id}`,
    source: "reddit" as const,
    title: String(d.title ?? ""),
    url: `https://www.reddit.com${d.permalink}`,
    author: (d.author as string) ?? null,
    date: new Date(Number(d.created_utc) * 1000).toISOString(),
    snippet: d.selftext ? String(d.selftext).replace(/\s+/g, " ").slice(0, 280) : null,
    context: `r/${d.subreddit}`,
  }));
}

/** Parses Google Alerts (Atom) and plain RSS. */
export function parseFeed(xml: string, feedName: string): Item[] {
  const out: Item[] = [];
  const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/g) ?? xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? [];
  for (const e of entries) {
    const tag = (t: string) => e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? "";
    let link = e.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? strip(tag("link"));
    // Google Alerts wraps the real URL in a redirect.
    try { const u = new URL(decode(link)); if (u.hostname.endsWith("google.com") && u.searchParams.get("url")) link = u.searchParams.get("url")!; else link = u.toString(); } catch { /* keep */ }
    const title = strip(tag("title"));
    if (!title || !link) continue;
    out.push({
      id: `alert:${tag("id") || link}`,
      source: "alerts",
      title,
      url: link,
      author: null,
      date: strip(tag("published") || tag("updated") || tag("pubDate")) ? new Date(strip(tag("published") || tag("updated") || tag("pubDate"))).toISOString() : new Date().toISOString(),
      snippet: strip(tag("content") || tag("description")).slice(0, 280) || null,
      context: feedName,
    });
  }
  return out;
}

async function fromFeed(url: string, i: number): Promise<Item[]> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text(), `Google Alert ${i + 1}`);
}

async function collect(): Promise<NonNullable<typeof g.__mentions>["res"]> {
  const terms = mentionTerms();
  const sources: MentionsResult["sources"] = [];
  const all = new Map<string, Item>();
  const run = async (name: string, jobs: Promise<Item[]>[]) => {
    const rs = await Promise.allSettled(jobs);
    let n = 0; let err: string | null = null;
    for (const r of rs) {
      if (r.status === "fulfilled") for (const it of r.value) { if (!all.has(it.id)) { all.set(it.id, it); n++; } }
      else err = r.reason instanceof Error ? r.reason.message : String(r.reason);
    }
    sources.push({ name, ok: !err || n > 0, count: n, error: err });
  };
  await run("Hacker News", terms.map(fromHackerNews));
  await run("Reddit", terms.map(fromReddit));
  const feeds = (process.env.GOOGLE_ALERTS_RSS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (feeds.length) await run("Google Alerts", feeds.map(fromFeed));
  const items = [...all.values()].sort((a, b) => b.date.localeCompare(a.date));
  return { terms, fetchedAt: new Date().toISOString(), items, sources };
}

export async function getMentions(force = false): Promise<MentionsResult> {
  if (force || !g.__mentions || Date.now() - g.__mentions.at > 30 * 60_000) {
    g.__mentions = { at: Date.now(), res: await collect() };
  }
  const seen = new Set(await kvGet<string[]>("mentions_seen", []));
  const first = seen.size === 0;
  const res = g.__mentions.res;
  // On the very first run everything is "new"; after that only unseen items.
  return { ...res, items: res.items.map((it) => ({ ...it, isNew: first || !seen.has(it.id) })) };
}

export async function markMentionsSeen(ids: string[]): Promise<void> {
  const seen = new Set(await kvGet<string[]>("mentions_seen", []));
  ids.forEach((i) => seen.add(i));
  await kvSet("mentions_seen", [...seen].slice(-2000));
}
