"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DataTable } from "@/components/DataTable";
import { seoFetch } from "@/lib/seoClient";
import type { CrawlIssue, CrawlPage, CrawlResult, CrawlStatus, BrokenLink, SeoBundle } from "@/lib/seo/types";
import { CopyButton } from "@/components/CopyButton";
import { buildIssuesReport, buildSingleIssueReport } from "@/lib/seo/aiReport";
import { Card, ErrorNote, Mini, Notice, Pill, RunButton, UrlLink, col, num } from "./common";
import { diffAudits } from "@/lib/seo/diff";

type CrawlResponse = { status: CrawlStatus; crawl?: CrawlResult | null };

export function AuditPanel({
  bundle,
  siteUrl,
  crawl,
  status,
  onFinished,
}: {
  bundle: SeoBundle;
  siteUrl: string | null;
  crawl: CrawlResult | null;
  status: CrawlStatus;
  onFinished: () => void;
}) {
  const [live, setLive] = useState<CrawlStatus>(status);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const poll = useCallback(() => {
    stopPolling();
    timer.current = setInterval(async () => {
      try {
        const r = await seoFetch<CrawlResponse>("/api/seo/crawl");
        setLive(r.status);
        if (r.status.state !== "running") {
          stopPolling();
          onFinished();
        }
      } catch (e) {
        stopPolling();
        setError(e instanceof Error ? e.message : "Lost contact with the crawl");
      }
    }, 1500);
  }, [onFinished]);

  useEffect(() => {
    // The bundle may be stale if you switched tabs mid-crawl — re-check.
    seoFetch<CrawlResponse>("/api/seo/crawl")
      .then((r) => {
        setLive(r.status);
        if (r.status.state === "running") poll();
      })
      .catch(() => {});
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    setError(null);
    try {
      const r = await seoFetch<CrawlResponse>("/api/seo/crawl", {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      });
      setLive(r.status);
      poll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the crawl");
    }
  }

  async function stop() {
    await seoFetch("/api/seo/crawl", { method: "POST", body: JSON.stringify({ action: "stop" }) }).catch(() => {});
  }

  const running = live.state === "running";
  const errors = crawl?.issues.filter((i) => i.severity === "error").reduce((n, i) => n + i.urls.length, 0) ?? 0;
  const warnings = crawl?.issues.filter((i) => i.severity === "warning").reduce((n, i) => n + i.urls.length, 0) ?? 0;
  const notices = crawl?.issues.filter((i) => i.severity === "notice").reduce((n, i) => n + i.urls.length, 0) ?? 0;

  const hist = bundle.history?.audits ?? [];
  const since = hist.length >= 2 ? diffAudits(hist[hist.length - 2], hist[hist.length - 1]) : null;

  const issue = crawl?.issues.find((i) => i.code === selected) ?? null;
  const pagesByUrl = new Map((crawl?.pages ?? []).map((p) => [p.url, p]));

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Site audit"
        subtitle={
          siteUrl
            ? `Crawls ${siteUrl} from your machine — up to ${crawl?.maxPages ?? "150"} pages. Checks titles, descriptions, headings, links, redirects, canonicals, sitemap and robots.`
            : "No site configured."
        }
        action={
          <div className="flex gap-2">
            {running && <RunButton onClick={stop}>Stop</RunButton>}
            <RunButton onClick={start} busy={running} disabled={!siteUrl}>
              {running ? `Crawling… ${live.crawled} pages` : crawl ? "Re-run audit" : "Run site audit"}
            </RunButton>
          </div>
        }
      >
        {!siteUrl && (
          <Notice>
            Set <code className="font-mono text-xs">SEO_SITE_URL</code> in <code className="font-mono text-xs">.env.local</code> (e.g.{" "}
            <code className="font-mono text-xs">https://northbooks.ca</code>) and restart.
          </Notice>
        )}
        {running && (
          <p className="truncate text-xs text-muted">
            {live.crawled} crawled · {live.queued} queued · {live.current}
          </p>
        )}
        {(error || live.error) && <ErrorNote>{error ?? live.error}</ErrorNote>}
        {!crawl && !running && siteUrl && (
          <p className="text-sm text-muted">No audit yet — click “Run site audit”. It takes about a minute for a small site.</p>
        )}

        {crawl && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              <Mini
                label="Health score"
                value={crawl.score}
                tone={crawl.score >= 85 ? "good" : crawl.score >= 60 ? "warn" : "bad"}
                sub={`of 100`}
              />
              <Mini label="Pages crawled" value={crawl.pagesCrawled} sub={crawl.truncated ? "hit page limit" : "complete"} />
              <Mini label="Errors" value={errors} tone={errors ? "bad" : "good"} sub="page-level" />
              <Mini label="Warnings" value={warnings} tone={warnings ? "warn" : "good"} />
              <Mini label="Notices" value={notices} />
              <Mini
                label="Sitemap"
                value={crawl.sitemapUrlCount}
                sub={crawl.sitemapUrlCount ? "URLs listed" : "none found"}
                tone={crawl.sitemapUrlCount ? undefined : "warn"}
              />
            </div>
            <p className="mt-3 text-xs text-muted">
              Crawled {new Date(crawl.finishedAt).toLocaleString()} in {crawl.durationSeconds}s · robots.txt{" "}
              {crawl.robots.found ? "found" : "not found"}
              {crawl.robots.blocksEverything && " — it blocks all crawlers!"}
              {crawl.skippedByRobots.length > 0 && ` · ${crawl.skippedByRobots.length} URLs skipped (blocked by robots.txt)`}
            </p>
            {since && (
              <p className="mt-1 text-xs">
                Since the previous audit ({since.prevAt.slice(0, 10)}):{" "}
                <span className={since.scoreDelta >= 0 ? "text-success" : "text-danger"}>score {since.scoreDelta >= 0 ? "+" : ""}{since.scoreDelta}</span>
                {" · "}<span className={since.newCount ? "text-warning" : "text-muted"}>{since.newCount} newly affected URLs</span>
                {" · "}<span className="text-success">{since.fixedCount} fixed</span>
                <span className="text-muted"> — details on the History tab</span>
              </p>
            )}
            {crawl.imageStats && (
              <p className="mt-1 text-xs text-muted">
                Images: measured {crawl.imageStats.checked}, {crawl.imageStats.heavy} over {Math.round(crawl.imageStats.limitBytes / 1000)} KB · {(crawl.imageStats.totalBytes / 1_000_000).toFixed(1)} MB total
              </p>
            )}
          </>
        )}
      </Card>

      {crawl?.security && (
        <Card
          title="Security & HTTPS"
          subtitle={`Read from ${crawl.security.checkedUrl}. These headers are normally set once for the whole site (Vercel/Next config or your host).`}
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            <li className="flex items-start gap-2 text-sm">
              <Pill tone={crawl.security.https ? "good" : "error"}>{crawl.security.https ? "HTTPS" : "no HTTPS"}</Pill>
              <span className="text-muted">Site served over a secure connection</span>
            </li>
            <li className="flex items-start gap-2 text-sm">
              <Pill tone={crawl.security.httpRedirectsToHttps === null ? "neutral" : crawl.security.httpRedirectsToHttps ? "good" : "error"}>
                {crawl.security.httpRedirectsToHttps === null ? "unknown" : crawl.security.httpRedirectsToHttps ? "redirects" : "no redirect"}
              </Pill>
              <span className="text-muted">http:// sends visitors to https://</span>
            </li>
            {crawl.security.headers.map((h) => (
              <li key={h.name} className="flex items-start gap-2 text-sm" title={h.present ? h.value ?? "" : h.advice}>
                <Pill tone={h.present ? "good" : h.name === "permissions-policy" || h.name === "content-security-policy" ? "notice" : "warning"}>{h.present ? "set" : "missing"}</Pill>
                <span>
                  {h.label}
                  {!h.present && <span className="block text-xs text-muted">{h.advice}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {crawl && (
        <>
          <Card
            title="Issues"
            subtitle="Click an issue to list the affected pages."
            action={
              <CopyButton
                label="Copy errors & warnings for AI"
                title="Copies every error and warning with affected URLs and evidence, plus an AI prompt"
                getText={() => buildIssuesReport(bundle, { severities: ["error", "warning"] })}
              />
            }
          >
            <DataTable<CrawlIssue>
              rows={crawl.issues} viewsKey="seo-issues"
              rowKey={(r) => r.code}
              onRowClick={(r) => setSelected(r.code === selected ? null : r.code)}
              selectedKey={selected}
              initialSort={{ key: "severity", dir: "asc" }}
              emptyMessage="No issues found — nice."
              columns={[
                col<CrawlIssue>(
                  "severity",
                  "Severity",
                  (r) => ({ error: 0, warning: 1, notice: 2 })[r.severity],
                  (r) => <Pill tone={r.severity}>{r.severity}</Pill>
                ),
                col<CrawlIssue>("label", "Issue", (r) => r.label, (r) => <span className="font-medium">{r.label}</span>),
                num<CrawlIssue>("count", "Pages", (r) => r.urls.length),
                col<CrawlIssue>("description", "What it means", (r) => r.description, (r) => <span className="text-muted">{r.description}</span>, {
                  className: "min-w-[18rem] text-xs",
                }),
              ]}
            />
            {issue && (
              <div className="mt-5 border-t border-border pt-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h4 className="text-sm font-medium">
                    {issue.label} <span className="text-muted">({issue.urls.length})</span>
                  </h4>
                  <CopyButton
                    label="Copy this issue for AI"
                    getText={() => buildSingleIssueReport(bundle, issue.code)}
                  />
                </div>
                <DataTable<string>
                  rows={issue.urls}
                  rowKey={(u) => u}
                  compact
                  maxHeight={320}
                  searchText={(u) => u}
                  searchPlaceholder="Filter URLs…"
                  columns={[
                    col<string>("url", "URL", (u) => u, (u) => <UrlLink url={u} max={80} />),
                    col<string>("title", "Title", (u) => pagesByUrl.get(u)?.title ?? "", (u) => (
                      <span className="text-muted">{pagesByUrl.get(u)?.title || "—"}</span>
                    ), { className: "max-w-xs truncate" }),
                    num<string>("status", "Status", (u) => pagesByUrl.get(u)?.status ?? null, undefined, { firstDir: "asc" }),
                  ]}
                />
              </div>
            )}
          </Card>

          {crawl.brokenLinks.length > 0 && (
            <Card title="Broken links" subtitle="Links on your pages that lead to errors.">
              <DataTable<BrokenLink>
                rows={crawl.brokenLinks} viewsKey="seo-broken-links"
                rowKey={(r, i) => `${r.from}|${r.to}|${i}`}
                compact
                maxHeight={360}
                searchText={(r) => `${r.from} ${r.to} ${r.anchor}`}
                filters={[
                  { key: "type", label: "Types", getValue: (r) => (r.external ? "External" : "Internal"), options: ["Internal", "External"] },
                ]}
                columns={[
                  col<BrokenLink>("from", "Found on", (r) => r.from, (r) => <UrlLink url={r.from} />),
                  col<BrokenLink>("to", "Links to", (r) => r.to, (r) => <UrlLink url={r.to} />),
                  col<BrokenLink>("anchor", "Anchor text", (r) => r.anchor, undefined, { className: "max-w-[14rem] truncate" }),
                  num<BrokenLink>("status", "Status", (r) => r.status, (r) => <Pill tone="error">{r.status || "no response"}</Pill>, { firstDir: "asc" }),
                  col<BrokenLink>("type", "Type", (r) => (r.external ? "External" : "Internal")),
                ]}
              />
            </Card>
          )}

          <Card title="All pages" subtitle="Everything the crawler found. Sort and filter to hunt for problems.">
            <DataTable<CrawlPage>
              rows={crawl.pages} viewsKey="seo-pages"
              rowKey={(r) => r.url}
              compact
              maxHeight={520}
              searchText={(r) => `${r.url} ${r.title ?? ""}`}
              searchPlaceholder="Search URL or title…"
              filters={[
                {
                  key: "status",
                  label: "Statuses",
                  getValue: (r) => (r.status === 0 ? "Failed" : `${Math.floor(r.status / 100)}xx`),
                },
                { key: "indexable", label: "Indexability", getValue: (r) => (r.indexable ? "Indexable" : "Not indexable"), options: ["Indexable", "Not indexable"] },
              ]}
              columns={[
                col<CrawlPage>("url", "URL", (r) => r.url, (r) => <UrlLink url={r.url} />),
                num<CrawlPage>("status", "Status", (r) => r.status, (r) => (
                  <Pill tone={r.status === 200 ? "good" : r.status >= 400 || r.status === 0 ? "error" : "warning"}>{r.status || "fail"}</Pill>
                ), { firstDir: "asc" }),
                col<CrawlPage>("title", "Title", (r) => r.title, (r) => (
                  <span title={r.title ?? ""}>{r.title ? (r.title.length > 50 ? `${r.title.slice(0, 49)}…` : r.title) : <span className="text-danger">missing</span>}</span>
                )),
                num<CrawlPage>("tlen", "Title len", (r) => r.titleLength),
                num<CrawlPage>("mlen", "Meta len", (r) => r.metaLength),
                num<CrawlPage>("h1", "H1s", (r) => r.h1.length, undefined, { firstDir: "asc" }),
                num<CrawlPage>("words", "Words", (r) => r.wordCount),
                num<CrawlPage>("inlinks", "Inlinks", (r) => r.inlinks),
                num<CrawlPage>("depth", "Depth", (r) => r.depth, undefined, { firstDir: "asc" }),
                num<CrawlPage>("ms", "Resp. ms", (r) => r.responseMs),
                col<CrawlPage>("schema", "Schema", (r) => (r.schemaTypes ?? []).join(", "), (r) =>
                  r.schemaTypes?.length ? <span title={(r.schemaProblems ?? []).join("\n") || "No problems found"} className={r.schemaProblems?.length ? "text-warning" : "text-success"}>{r.schemaTypes.join(", ")}</span> : <span className="text-muted">—</span>
                ),
                num<CrawlPage>("imgkb", "Img KB", (r) => (r.imageBytes ? Math.round(r.imageBytes / 1000) : null)),
                num<CrawlPage>("issues", "Issues", (r) => r.issues.length, (r) =>
                  r.issues.length ? <span title={r.issues.join(", ")}>{r.issues.length}</span> : <span className="text-success">0</span>
                ),
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
