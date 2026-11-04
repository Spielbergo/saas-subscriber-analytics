"use client";

import { useState } from "react";
import { DataTable } from "@/components/DataTable";
import { seoFetch } from "@/lib/seoClient";
import type { BacklinkData, BacklinkSample, BacklinkTarget } from "@/lib/seo/types";
import { Card, ErrorNote, Mini, Notice, RunButton, UrlLink, col, num } from "./common";

export function BacklinksPanel({ data, onChange }: { data: BacklinkData; onChange: (d: BacklinkData) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const r = await seoFetch<{ backlinks: BacklinkData }>("/api/seo/backlinks", { method: "POST", body: JSON.stringify({}) });
      onChange(r.backlinks);
      if (r.backlinks.error) setError(r.backlinks.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backlink refresh failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data.configured) {
    return (
      <Notice>
        <p className="mb-2">
          <span className="font-medium text-text">Backlinks</span> come from Bing Webmaster Tools — the only free source with real inbound-link data (Google has no API for it).
        </p>
        <ol className="list-decimal space-y-0.5 pl-5">
          <li>Add and verify your site at bing.com/webmasters (you can import it from Search Console in one click).</li>
          <li>Settings → API access → generate an API key.</li>
          <li>
            Put it in <code className="font-mono text-xs">.env.local</code> as <code className="font-mono text-xs">BING_WEBMASTER_API_KEY=…</code> and restart.
          </li>
        </ol>
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Backlinks (via Bing)"
        subtitle="Only counts links Bing has found, so it's a floor — expect far fewer than Ahrefs or Semrush show. Referring domains below come from a sample of links to your top pages."
        action={<RunButton onClick={refresh} busy={busy}>{busy ? "Fetching…" : data.fetchedAt ? "Refresh" : "Fetch backlinks"}</RunButton>}
      >
        {error && <ErrorNote>{error}</ErrorNote>}
        {!data.fetchedAt && !busy && <p className="text-sm text-muted">Click “Fetch backlinks” to pull your latest data.</p>}
        {data.fetchedAt && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Inbound links" value={data.totalLinks.toLocaleString()} />
            <Mini label="Linked pages" value={data.targets.length} />
            <Mini label="Referring domains (sample)" value={data.referringDomains.length} />
            <Mini label="Last fetched" value={new Date(data.fetchedAt).toLocaleDateString()} />
          </div>
        )}
      </Card>

      {data.fetchedAt && (
        <>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Your most-linked pages">
              <DataTable<BacklinkTarget>
                rows={data.targets}
                rowKey={(r) => r.url}
                compact
                maxHeight={360}
                searchText={(r) => r.url}
                initialSort={{ key: "count", dir: "desc" }}
                columns={[
                  col<BacklinkTarget>("url", "Page", (r) => r.url, (r) => <UrlLink url={r.url} max={50} />),
                  num<BacklinkTarget>("count", "Links", (r) => r.count),
                ]}
              />
            </Card>
            <Card title="Referring domains" subtitle="From the sampled links.">
              <DataTable<{ domain: string; links: number }>
                rows={data.referringDomains}
                rowKey={(r) => r.domain}
                compact
                maxHeight={360}
                searchText={(r) => r.domain}
                initialSort={{ key: "links", dir: "desc" }}
                columns={[
                  col<{ domain: string; links: number }>("domain", "Domain", (r) => r.domain),
                  num<{ domain: string; links: number }>("links", "Links", (r) => r.links),
                ]}
              />
            </Card>
          </div>
          <Card title="Sample of inbound links">
            <DataTable<BacklinkSample>
              rows={data.samples} viewsKey="seo-backlink-samples"
              rowKey={(r, i) => `${r.source}|${r.target}|${i}`}
              compact
              maxHeight={400}
              searchText={(r) => `${r.source} ${r.target} ${r.anchor ?? ""}`}
              columns={[
                col<BacklinkSample>("source", "Linking page", (r) => r.source, (r) => <UrlLink url={r.source} max={55} />),
                col<BacklinkSample>("anchor", "Anchor text", (r) => r.anchor),
                col<BacklinkSample>("target", "Points to", (r) => r.target, (r) => <UrlLink url={r.target} max={40} />),
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
