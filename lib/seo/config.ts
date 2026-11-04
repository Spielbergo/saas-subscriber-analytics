// Where the SEO tools point. Server-side only (reads env vars).

export function seoSiteUrl(): string | null {
  const explicit = process.env.SEO_SITE_URL?.trim();
  if (explicit) return explicit.startsWith("http") ? explicit : `https://${explicit}`;
  const sc = process.env.SEARCH_CONSOLE_SITE_URL?.trim();
  if (!sc) return null;
  if (sc.startsWith("sc-domain:")) return `https://${sc.slice("sc-domain:".length)}`;
  return sc;
}

export function brandTerms(): string[] {
  return (process.env.SEO_BRAND_TERMS ?? "northbooks,north books")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const CRAWL_MAX_PAGES = Math.max(
  1,
  Math.min(1000, Number(process.env.SEO_CRAWL_MAX_PAGES) || 150)
);
