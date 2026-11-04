"use client";

import { useMemo } from "react";
import { CopyButton } from "@/components/CopyButton";
import { internalLinkSuggestions, type LinkSuggestion } from "@/lib/seo/internalLinks";
import type { SeoBundle } from "@/lib/seo/types";
import { Card, Notice, UrlLink } from "./common";

const path = (u: string) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };

export function InternalLinksPanel({ bundle }: { bundle: SeoBundle }) {
  const { items, reason } = useMemo(
    () => internalLinkSuggestions(bundle.crawl, bundle.opportunities, bundle.opportunities.brand.terms),
    [bundle.crawl, bundle.opportunities]
  );
  const text = () =>
    "# Internal link suggestions (pages with search impressions but few internal links)\n" +
    items.map((s) => `\n## ${path(s.target)} — ${s.impressions} impressions, ${s.inlinks} internal links\nTop queries: ${s.queries.join("; ")}\nAdd a link (anchor idea: “${s.topQuery}”) from:\n${s.sources.map((x) => `- ${path(x.url)} (${x.title ?? "untitled"}; shares: ${x.matched.join(", ")})`).join("\n")}`).join("\n");

  return (
    <Card
      title="Internal link suggestions"
      subtitle="Pages Google already shows but that few of your own pages link to. For each one, these are related, well-linked pages that don't link to it yet — add a natural link using the query as anchor text."
      action={items.length > 0 ? <CopyButton label="Copy for AI" getText={text} /> : undefined}
    >
      {reason && <Notice>{reason}</Notice>}
      <ul className="flex flex-col gap-4">
        {items.map((s: LinkSuggestion) => (
          <li key={s.target} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <UrlLink url={s.target} max={70} />
                {s.title && <p className="truncate text-xs text-muted">{s.title}</p>}
              </div>
              <p className="text-xs text-muted">{s.impressions.toLocaleString()} impressions · {s.clicks} clicks · <span className="text-warning">{s.inlinks} internal link{s.inlinks === 1 ? "" : "s"}</span></p>
            </div>
            <p className="mt-2 text-xs text-muted">Ranks for: {s.queries.join(" · ")}</p>
            <p className="mt-3 text-xs font-medium">Link to it from (suggested anchor: “{s.topQuery}”):</p>
            <ul className="mt-1 space-y-1 text-sm">
              {s.sources.map((x) => (
                <li key={x.url} className="flex flex-wrap items-baseline gap-x-2">
                  <UrlLink url={x.url} max={60} />
                  <span className="text-xs text-muted">{x.title ?? ""} · {x.inlinks} inlinks · shares “{x.matched.join(", ")}”</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Card>
  );
}
