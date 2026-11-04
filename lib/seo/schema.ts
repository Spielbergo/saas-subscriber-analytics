// Pure JSON-LD validation: checks the properties Google's rich-result
// docs call out for the schema types a small SaaS site typically uses.
// It is a sanity check, not a replacement for Google's Rich Results Test.

type Json = Record<string, unknown>;

const has = (o: Json, k: string) => {
  const v = o[k];
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const typesOf = (o: Json): string[] => arr(o["@type"]).map(String);

function* nodes(v: unknown): Generator<Json> {
  if (Array.isArray(v)) { for (const x of v) yield* nodes(x); return; }
  if (v && typeof v === "object") {
    const o = v as Json;
    yield o;
    if (o["@graph"]) yield* nodes(o["@graph"]);
  }
}

function checkNode(o: Json, type: string): string[] {
  const p: string[] = [];
  const need = (...keys: string[]) => { for (const k of keys) if (!has(o, k)) p.push(`${type}: missing "${k}"`); };
  const oneOf = (...keys: string[]) => { if (!keys.some((k) => has(o, k))) p.push(`${type}: needs at least one of ${keys.map((k) => `"${k}"`).join(", ")}`); };
  switch (type) {
    case "Organization": case "Corporation": case "NGO":
      need("name"); oneOf("url", "logo"); break;
    case "WebSite":
      need("name", "url"); break;
    case "WebPage": break;
    case "Product":
      need("name"); oneOf("offers", "review", "aggregateRating");
      for (const of of arr(o.offers)) { const f = of as Json; if (f && typeof f === "object") { if (!has(f, "price") && !has(f, "lowPrice")) p.push('Product offer: missing "price"'); if (!has(f, "priceCurrency")) p.push('Product offer: missing "priceCurrency"'); } }
      break;
    case "SoftwareApplication": case "WebApplication": case "MobileApplication":
      need("name"); oneOf("offers", "aggregateRating", "review");
      if (!has(o, "applicationCategory")) p.push(`${type}: missing "applicationCategory"`);
      break;
    case "Article": case "BlogPosting": case "NewsArticle":
      need("headline", "datePublished"); oneOf("author"); oneOf("image");
      break;
    case "FAQPage": {
      const qs = arr(o.mainEntity);
      if (qs.length === 0) p.push('FAQPage: missing "mainEntity" questions');
      for (const q of qs) {
        const qq = q as Json;
        if (!qq || !has(qq, "name")) p.push("FAQPage: a Question has no name");
        else if (!qq.acceptedAnswer || !has(qq.acceptedAnswer as Json, "text")) p.push(`FAQPage: question "${String(qq.name).slice(0, 40)}" has no acceptedAnswer.text`);
      }
      break;
    }
    case "BreadcrumbList": {
      const items = arr(o.itemListElement);
      if (items.length === 0) p.push('BreadcrumbList: missing "itemListElement"');
      items.forEach((it, i) => {
        const li = it as Json;
        if (!li || !has(li, "position")) p.push(`BreadcrumbList: item ${i + 1} missing "position"`);
        if (!li || (!has(li, "name") && !(li.item && typeof li.item === "object" && has(li.item as Json, "name")))) p.push(`BreadcrumbList: item ${i + 1} missing "name"`);
      });
      break;
    }
    case "LocalBusiness": case "ProfessionalService": case "AccountingService":
      need("name", "address"); break;
    case "Review": need("author", "reviewRating"); break;
    default: break;
  }
  return p;
}

export function validateJsonLd(blocks: string[]): { types: string[]; problems: string[]; invalid: number } {
  const types = new Set<string>();
  const problems: string[] = [];
  let invalid = 0;
  for (const raw of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      invalid++;
      problems.push(`Invalid JSON in a JSON-LD block (${e instanceof Error ? e.message.slice(0, 80) : "parse error"})`);
      continue;
    }
    const roots = arr(data);
    for (const root of roots) {
      if (root && typeof root === "object" && !has(root as Json, "@context")) problems.push('JSON-LD block is missing "@context"');
    }
    for (const n of nodes(data)) {
      const ts = typesOf(n);
      for (const t of ts) {
        types.add(t);
        problems.push(...checkNode(n, t));
      }
    }
  }
  return { types: [...types], problems: [...new Set(problems)].slice(0, 12), invalid };
}
