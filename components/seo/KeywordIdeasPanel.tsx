"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { seoFetch } from "@/lib/seoClient";
import type { KeywordIdea, Opportunities } from "@/lib/seo/types";
import { Card, ErrorNote, Pill, RunButton, col } from "./common";

export function KeywordIdeasPanel({ opportunities }: { opportunities: Opportunities }) {
  const [seed, setSeed] = useState("");
  const [ideas, setIdeas] = useState<KeywordIdea[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ranked = new Set(opportunities.rankedQueries);

  async function go() {
    if (seed.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const r = await seoFetch<{ ideas: KeywordIdea[] }>(`/api/seo/keywords?q=${encodeURIComponent(seed.trim())}`);
      setIdeas(r.ideas);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't fetch ideas");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Keyword ideas"
      subtitle="Free suggestions from Google autocomplete — what real people type. There's no search-volume or difficulty number (that data is paid), so use it to find topics, then check Search Console for what actually gets impressions."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        className="mb-4 flex flex-wrap gap-2"
      >
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="e.g. bookkeeping for freelancers"
            className="w-72 rounded-lg border border-border bg-bg py-1.5 pl-8 pr-3 text-sm outline-none focus:border-accent"
          />
        </div>
        <RunButton onClick={go} busy={busy} disabled={seed.trim().length < 2}>
          Get ideas
        </RunButton>
      </form>
      {error && <ErrorNote>{error}</ErrorNote>}
      {ideas && (
        <DataTable<KeywordIdea>
          rows={ideas} viewsKey="seo-keyword-ideas"
          rowKey={(r) => r.keyword}
          compact
          maxHeight={520}
          title="Ideas"
          searchText={(r) => r.keyword}
          emptyMessage="No suggestions returned — Google may have rate-limited the request. Try again shortly."
          filters={[
            { key: "kind", label: "Types", getValue: (r) => r.kind },
            { key: "ranked", label: "Ranking", getValue: (r) => (ranked.has(r.keyword) ? "You already rank" : "Not ranking yet"), options: ["You already rank", "Not ranking yet"] },
          ]}
          columns={[
            col<KeywordIdea>("keyword", "Keyword", (r) => r.keyword, (r) => <span className="font-medium">{r.keyword}</span>),
            col<KeywordIdea>("kind", "Type", (r) => r.kind, (r) => <Pill>{r.kind}</Pill>),
            col<KeywordIdea>("ranked", "In Search Console", (r) => ranked.has(r.keyword), (r) =>
              ranked.has(r.keyword) ? <Pill tone="good">already ranking</Pill> : <span className="text-muted">—</span>
            ),
          ]}
        />
      )}
    </Card>
  );
}
