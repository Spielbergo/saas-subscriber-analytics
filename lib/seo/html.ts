// Minimal, dependency-free HTML extraction for SEO audits. Regex-based:
// good enough for the tags SEO cares about on your own pages, and keeps
// the project free of extra packages.

export type ParsedLink = { href: string; anchor: string; nofollow: boolean };

export type ParsedHtml = {
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  h2Count: number;
  canonical: string | null;
  robotsMeta: string | null;
  lang: string | null;
  hasViewport: boolean;
  hasOgTitle: boolean;
  hasOgImage: boolean;
  hasJsonLd: boolean;
  wordCount: number;
  imagesTotal: number;
  imagesMissingAlt: number;
  images: { src: string; hasDims: boolean }[]; // first 80
  mixedContent: number; // http:// subresources (img/script/iframe/stylesheet…)
  jsonLdBlocks: string[];
  links: ParsedLink[];
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  hellip: "…",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export function parseAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Drop the tag name, then read attributes.
  const body = tag.replace(/^<\s*[a-zA-Z0-9]+/, "").replace(/\/?>$/, "");
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(body))) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

export function parseHtml(rawHtml: string): ParsedHtml {
  // Cap what we parse so one enormous page can't stall the crawl.
  const html = rawHtml.length > 2_000_000 ? rawHtml.slice(0, 2_000_000) : rawHtml;

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : null;

  let metaDescription: string | null = null;
  let robotsMeta: string | null = null;
  let hasViewport = false;
  let hasOgTitle = false;
  let hasOgImage = false;
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = parseAttrs(tag);
    const name = (a.name ?? "").toLowerCase();
    const prop = (a.property ?? "").toLowerCase();
    if (name === "description" && metaDescription === null) metaDescription = (a.content ?? "").trim();
    if (name === "robots" || name === "googlebot") {
      robotsMeta = robotsMeta ? `${robotsMeta}, ${a.content ?? ""}` : a.content ?? "";
    }
    if (name === "viewport") hasViewport = true;
    if (prop === "og:title" && a.content) hasOgTitle = true;
    if (prop === "og:image" && a.content) hasOgImage = true;
  }

  let canonical: string | null = null;
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const a = parseAttrs(tag);
    if ((a.rel ?? "").toLowerCase().split(/\s+/).includes("canonical") && a.href) {
      canonical = a.href.trim();
      break;
    }
  }

  const langMatch = html.match(/<html\b[^>]*>/i);
  const lang = langMatch ? parseAttrs(langMatch[0]).lang?.trim() || null : null;

  const h1 = (html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) ?? [])
    .map(stripTags)
    .filter(Boolean);
  const h2Count = (html.match(/<h2\b/gi) ?? []).length;

  const hasJsonLd = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json/i.test(html);

  // Body text → word count (scripts/styles/comments removed first).
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  const text = (bodyMatch ? bodyMatch[1] : html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ");
  const wordCount = stripTags(text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  let imagesMissingAlt = 0;
  for (const tag of imgs) {
    const a = parseAttrs(tag);
    if (!("alt" in a)) imagesMissingAlt += 1;
  }

  const images: { src: string; hasDims: boolean }[] = [];
  for (const tag of imgs) {
    if (images.length >= 80) break;
    const a = parseAttrs(tag);
    const src = (a.src || a["data-src"] || "").trim();
    if (!src || src.startsWith("data:")) continue;
    images.push({ src, hasDims: Boolean(a.width && a.height) });
  }
  const mixedContent = (html.match(/<(?:img|script|iframe|source|video|audio|embed)\b[^>]*?\bsrc\s*=\s*["']?http:\/\//gi) ?? []).length +
    (html.match(/<link\b[^>]*?rel\s*=\s*["']?stylesheet[^>]*?href\s*=\s*["']?http:\/\//gi) ?? []).length;
  const jsonLdBlocks = Array.from(
    html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)
  ).map((m) => m[1].trim()).filter(Boolean);

  const links: ParsedLink[] = [];
  const linkSource = (bodyMatch ? bodyMatch[1] : html).replace(/<!--[\s\S]*?-->/g, " ");
  const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = aRe.exec(linkSource))) {
    const a = parseAttrs(`<a ${m[1]}>`);
    if (!a.href) continue;
    const href = a.href.trim();
    if (/^(mailto:|tel:|javascript:|sms:|data:|#)/i.test(href)) continue;
    links.push({
      href,
      anchor: stripTags(m[2]).slice(0, 120),
      nofollow: /\bnofollow\b/i.test(a.rel ?? ""),
    });
  }

  return {
    title,
    metaDescription,
    h1,
    h2Count,
    canonical,
    robotsMeta,
    lang,
    hasViewport,
    hasOgTitle,
    hasOgImage,
    hasJsonLd,
    wordCount,
    imagesTotal: imgs.length,
    imagesMissingAlt,
    images,
    mixedContent,
    jsonLdBlocks,
    links,
  };
}

// ---------- URL helpers ----------

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|msclkid|mc_|ref$|_ga)/i;

/** Resolve + normalise a URL for dedupe: drop hash and tracking params. */
export function normalizeUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    for (const key of Array.from(u.searchParams.keys())) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.hostname = u.hostname.toLowerCase();
    // "/" and "" are the same page; leave other trailing slashes alone
    // since many sites treat /about and /about/ as different URLs.
    return u.toString();
  } catch {
    return null;
  }
}

const FILE_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|mjs|json|xml|txt|zip|gz|mp4|mp3|woff2?|ttf|eot|docx?|xlsx?|pptx?)$/i;
export const looksLikeFile = (url: string) => {
  try {
    return FILE_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

/** Parse a sitemap (or sitemap index) into its <loc> values. */
export function parseSitemap(xml: string): { urls: string[]; isIndex: boolean } {
  const isIndex = /<sitemapindex\b/i.test(xml);
  const urls = Array.from(xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)).map((m) =>
    decodeEntities(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim())
  );
  return { urls, isIndex };
}

export type RobotsRules = {
  disallow: string[];
  allow: string[];
  sitemaps: string[];
  blocksEverything: boolean;
};

/** Parse robots.txt rules that apply to `agent` (falls back to `*`). */
export function parseRobots(txt: string, agent: string): RobotsRules {
  const groups: { agents: string[]; disallow: string[]; allow: string[] }[] = [];
  const sitemaps: string[] = [];
  let cur: { agents: string[]; disallow: string[]; allow: string[] } | null = null;
  let lastWasAgent = false;

  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "sitemap") {
      if (val) sitemaps.push(val);
      continue;
    }
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], disallow: [], allow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "disallow" && val) cur.disallow.push(val);
    if (key === "allow" && val) cur.allow.push(val);
  }

  const a = agent.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((x) => x !== "*" && a.includes(x)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const disallow = chosen.flatMap((g) => g.disallow);
  const allow = chosen.flatMap((g) => g.allow);
  return {
    disallow,
    allow,
    sitemaps,
    blocksEverything: disallow.includes("/") && !allow.some((p) => p === "/"),
  };
}

function ruleToRegex(rule: string): RegExp {
  const esc = rule
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\\$$/, "$");
  return new RegExp(`^${esc}`);
}

/** Longest-match wins, Allow beats Disallow on ties (Google's behaviour). */
export function isAllowedByRobots(rules: RobotsRules, pathAndQuery: string): boolean {
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const r of rules.allow) if (ruleToRegex(r).test(pathAndQuery)) bestAllow = Math.max(bestAllow, r.length);
  for (const r of rules.disallow) if (ruleToRegex(r).test(pathAndQuery)) bestDisallow = Math.max(bestDisallow, r.length);
  return bestDisallow < 0 || bestAllow >= bestDisallow;
}
