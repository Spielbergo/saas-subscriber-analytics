import type { KeywordIdea } from "./types";

const MODIFIERS = ["how to", "what is", "best", "free", "online", "for small business", "vs", "alternative", "software", "app", "template", "near me", "canada"];
const QUESTION = /^(how|what|why|when|where|which|can|do|does|is|are|should)\b/i;

async function suggest(q: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(q)}`,
      { signal: AbortSignal.timeout(8000), headers: { "user-agent": "Mozilla/5.0" } }
    );
    if (!res.ok) return [];
    const json = (await res.json()) as [string, string[]];
    return Array.isArray(json?.[1]) ? json[1] : [];
  } catch {
    return [];
  }
}

/**
 * Free keyword ideas from Google's public autocomplete endpoint (the
 * same suggestions you see while typing in the search box). There's no
 * search-volume or difficulty data — that needs paid datasets.
 */
export async function keywordIdeas(seed: string): Promise<KeywordIdea[]> {
  const base = seed.trim().toLowerCase().slice(0, 80);
  if (!base) return [];

  const queries = [
    base,
    ...MODIFIERS.map((m) => (["how to", "what is", "best"].includes(m) ? `${m} ${base}` : `${base} ${m}`)),
    ...Array.from("abcdefghijklmnopqrstuvwxyz").map((c) => `${base} ${c}`),
  ];

  const found = new Map<string, KeywordIdea>();
  let i = 0;
  const worker = async () => {
    while (i < queries.length) {
      const q = queries[i++];
      for (const s of await suggest(q)) {
        const k = s.trim().toLowerCase();
        if (!k || k === base || found.has(k)) continue;
        const kind: KeywordIdea["kind"] = QUESTION.test(k)
          ? "question"
          : /\b(vs|versus|alternative|alternatives|compare|comparison)\b/.test(k)
            ? "comparison"
            : k.startsWith(base) && k.length > base.length
              ? "modifier"
              : "suggestion";
        found.set(k, { keyword: k, kind });
      }
    }
  };
  await Promise.all(Array.from({ length: 5 }, () => worker()));
  return Array.from(found.values()).sort((a, b) => a.keyword.localeCompare(b.keyword)).slice(0, 300);
}
