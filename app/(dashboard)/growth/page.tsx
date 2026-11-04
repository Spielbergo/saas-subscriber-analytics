"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Trash2, RefreshCw } from "lucide-react";
import { useDashboard } from "@/lib/DashboardContext";
import { useDateRange } from "@/lib/DateRangeContext";
import { seoFetch } from "@/lib/seoClient";
import { DataTable } from "@/components/DataTable";
import { CopyButton } from "@/components/CopyButton";
import { TRACKED_EVENTS, buildTrackingRows } from "@/lib/tracking";
import { Card, ErrorNote, Notice, Pill, RunButton, col, num, pct } from "@/components/seo/common";
import { CAMPAIGN_DIMS, buildFunnel, buildUtmUrl, campaignTable, postResults, slug, type CampaignDim, type CampaignRow, type PostResult } from "@/lib/growth";
import type { Mention, MentionsResult, Post } from "@/lib/adminTypes";

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);

// ---------------- Funnel ----------------
function Funnel() {
  const { metrics, marketing } = useDashboard();
  const { within, range } = useDateRange();
  const [localWin, setWin] = useState<number | null>(30);
  // A global range (anything but "All") wins over the local selector.
  const win = range.isAll ? localWin : null;
  const visitors = marketing?.ga4?.configured ? marketing.ga4.totalUsers : null;
  const steps = useMemo(() => (metrics ? buildFunnel(range.isAll ? metrics.subscriberList : metrics.subscriberList.filter((r) => within(r.joinedAt)), win, visitors) : []), [metrics, win, visitors, within, range.isAll]);
  if (!metrics) return null;
  const max = Math.max(1, ...steps.map((s) => s.count ?? 0));
  const text = () =>
    `Funnel (${!range.isAll ? `signups in ${range.label.toLowerCase()}` : win ? `signups in last ${win}d` : "all signups"}):\n` +
    steps.map((s) => `- ${s.label}: ${s.count ?? "n/a"}${s.ofPrev !== null ? ` (${pct(s.ofPrev)} of previous step)` : ""}${s.ofFirst !== null ? ` [${pct(s.ofFirst)} of first]` : ""}`).join("\n");
  return (
    <Card
      title="Funnel"
      subtitle="Visitors come from GA4; every later step is counted from Supabase for people who signed up in the window."
      action={
        <div className="flex items-center gap-2">
          {range.isAll ? <select value={localWin ?? 0} onChange={(e) => setWin(Number(e.target.value) || null)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
            <option value={30}>Signed up in last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={0}>All time</option>
          </select> : <span className="text-xs text-muted">Signed up: {range.label.toLowerCase()}</span>}
          <CopyButton label="Copy" getText={text} />
        </div>
      }
    >
      <ul className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={s.label}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">{s.label}</span>
              <span className="text-muted">
                {s.count === null ? <span title={s.note}>n/a</span> : s.count.toLocaleString()}
                {s.ofPrev !== null && i > 0 && <span className="ml-2 text-xs">{pct(s.ofPrev)} of previous{s.ofPrev < 0.5 ? " · big drop" : ""}</span>}
              </span>
            </div>
            <div className="mt-1 h-3 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${((s.count ?? 0) / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {win !== 30 && <p className="mt-3 text-xs text-muted">Visitors only show for the 30-day window (GA4 data is pulled for 30 days).</p>}
    </Card>
  );
}

// ---------------- Tracking check ----------------
const STATUS_TONE: Record<string, string> = { ok: "good", not_firing: "error", undercount: "warning", overcount: "warning", no_data: "neutral", unknown: "neutral" };
const STATUS_LABEL: Record<string, string> = { ok: "OK", not_firing: "Not firing", undercount: "Undercounting", overcount: "Overcounting", no_data: "No activity", unknown: "Unknown" };

function TrackingCheck() {
  const { metrics, marketing } = useDashboard();
  const rows = useMemo(() => (metrics ? buildTrackingRows(metrics.eventTruth, marketing?.ga4 ?? null) : []), [metrics, marketing]);
  if (!metrics) return null;
  const ga = marketing?.ga4;
  const pii = ga?.configured ? ga.piiUrlHits : null;
  const text = () =>
    "GA4 conversion-event check (last 30 days):\n" +
    rows.map((r) => `- ${r.event}: GA4 ${r.ga4 ?? "n/a"} vs ${r.backendLabel} ${r.backend ?? "n/a"} → ${STATUS_LABEL[r.status]}. ${r.note}`).join("\n") +
    (pii !== null ? `\nPage URLs containing an email-like "@": ${pii} page views${ga?.piiUrlSamples.length ? ` (e.g. ${ga.piiUrlSamples.join(", ")})` : ""}` : "");
  return (
    <Card
      title="Tracking check"
      subtitle="Are the GA4 conversion events firing, and do they match reality? GA4's count is compared with the real count from Supabase and Helcim for the last 30 days."
      action={<CopyButton label="Copy" getText={text} />}
    >
      {!ga?.configured && <Notice>Connect GA4 (<code className="font-mono text-xs">GA4_PROPERTY_ID</code> + the Google service account) to compare.</Notice>}
      <DataTable<ReturnType<typeof buildTrackingRows>[number]>
        rows={rows}
        rowKey={(r) => r.event}
        compact
        csvName="tracking-check"
        columns={[
          col("event", "GA4 event", (r) => r.event, (r) => <code className="font-mono text-xs">{r.event}</code>),
          num("ga4", "In GA4", (r) => r.ga4),
          num("backend", "In your data", (r) => r.backend, (r) => <span title={r.backendLabel}>{r.backend ?? "—"} <span className="text-xs text-muted">· {r.backendLabel}</span></span>),
          num("ratio", "Match", (r) => r.ratio, (r) => <span className="text-muted">{r.ratio === null ? "—" : pct(r.ratio, 0)}</span>),
          col("status", "Status", (r) => STATUS_LABEL[r.status], (r) => <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>),
          col("note", "What it means", (r) => r.note, (r) => <span className="text-xs text-muted">{r.note}</span>, { className: "min-w-[18rem]" }),
        ]}
      />
      {pii !== null && (
        <p className={`mt-3 text-sm ${pii > 0 ? "text-danger" : "text-success"}`}>
          {pii > 0
            ? `Privacy problem: ${pii} page view${pii === 1 ? "" : "s"} in GA4 have an email-like “@” in the URL${ga?.piiUrlSamples.length ? ` (e.g. ${ga.piiUrlSamples.join(", ")})` : ""}. Remove emails from URLs/query strings (and ask Google to delete that data) — sending personal information to GA4 breaks its terms.`
            : "No email-like values found in page URLs (good)."}
        </p>
      )}
      <p className="mt-3 text-xs text-muted">
        Events being checked: {TRACKED_EVENTS.map((e) => e.name).join(", ")}. See <code className="font-mono">docs/ga4-events.md</code> for the code to send them. Browser events normally lose up to ~30% to ad blockers; server-side events (first invoice, subscription) should match closely.
      </p>
    </Card>
  );
}

// ---------------- Campaign ROI ----------------
function Campaigns() {
  const { metrics } = useDashboard();
  const { within } = useDateRange();
  const [dim, setDim] = useState<CampaignDim>("signupCampaign");
  const rows = useMemo(() => (metrics ? campaignTable(metrics.subscriberList.filter((r) => within(r.joinedAt)), dim, metrics.planPricing) : []), [metrics, dim, within]);
  if (!metrics) return null;
  const text = () =>
    `Campaign performance by ${dim}:\nkey | signups | set up | building | paid | MRR\n` +
    rows.map((r) => `${r.key} | ${r.signups} | ${pct(r.setUpRate, 0)} | ${pct(r.buildingRate, 0)} | ${pct(r.paidRate, 0)} | ${money(r.mrr)}`).join("\n");
  return (
    <Card
      title="Campaign ROI"
      subtitle="Which posts bring people who actually set up, build and pay — not just sign up. “(none)” = no attribution captured."
      action={
        <div className="flex items-center gap-2">
          <select value={dim} onChange={(e) => setDim(e.target.value as CampaignDim)} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm">
            {CAMPAIGN_DIMS.map((d) => <option key={d.id} value={d.id}>By {d.label}</option>)}
          </select>
          <CopyButton label="Copy" getText={text} />
        </div>
      }
    >
      <DataTable<CampaignRow>
        rows={rows} viewsKey="growth-campaigns"
        rowKey={(r) => r.key}
        compact
        searchText={(r) => r.key}
        initialSort={{ key: "signups", dir: "desc" }}
        columns={[
          col<CampaignRow>("key", "Value", (r) => r.key),
          num<CampaignRow>("signups", "Signups", (r) => r.signups),
          num<CampaignRow>("setUp", "Set up", (r) => r.setUpRate, (r) => <span className="text-muted">{r.setUp} · {pct(r.setUpRate, 0)}</span>),
          num<CampaignRow>("building", "Building", (r) => r.buildingRate, (r) => <span className="text-muted">{r.building} · {pct(r.buildingRate, 0)}</span>),
          num<CampaignRow>("activated", "Activated", (r) => r.activatedRate, (r) => <span className={r.activated ? "text-success" : "text-muted"} title="Created an invoice, tracked an expense or uploaded a bank statement">{r.activated} · {pct(r.activatedRate, 0)}</span>),
          num<CampaignRow>("loggedIn", "Ever logged in", (r) => r.loggedIn),
          num<CampaignRow>("paid", "Paid", (r) => r.paidRate, (r) => <span className={r.paid ? "text-success" : "text-muted"}>{r.paid} · {pct(r.paidRate, 0)}</span>),
          num<CampaignRow>("mrr", "MRR", (r) => r.mrr, (r) => money(r.mrr)),
          col<CampaignRow>("first", "First", (r) => r.firstSignup, (r) => <span className="text-muted">{r.firstSignup}</span>, { firstDir: "desc" }),
          col<CampaignRow>("last", "Latest", (r) => r.lastSignup, (r) => <span className="text-muted">{r.lastSignup}</span>, { firstDir: "desc" }),
        ]}
      />
      <p className="mt-3 text-xs text-muted">Small numbers swing wildly — a 100% rate on 2 signups means little.</p>
    </Card>
  );
}

// ---------------- UTM builder + post log ----------------
const PLATFORMS: Record<string, { source: string; medium: string }> = {
  Reddit: { source: "reddit", medium: "social" },
  "Hacker News": { source: "hackernews", medium: "social" },
  LinkedIn: { source: "linkedin", medium: "social" },
  "X / Twitter": { source: "twitter", medium: "social" },
  Facebook: { source: "facebook", medium: "social" },
  "Facebook group": { source: "facebook", medium: "community" },
  Instagram: { source: "instagram", medium: "social" },
  YouTube: { source: "youtube", medium: "video" },
  Newsletter: { source: "newsletter", medium: "email" },
  Email: { source: "email", medium: "email" },
  Other: { source: "", medium: "" },
};

function Links() {
  const { metrics } = useDashboard();
  const [posts, setPosts] = useState<Post[]>([]);
  const [durable, setDurable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [site, setSite] = useState("");
  const [platform, setPlatform] = useState("Reddit");
  const [source, setSource] = useState("reddit");
  const [medium, setMedium] = useState("social");
  const [campaign, setCampaign] = useState("");
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [postedOn, setPostedOn] = useState(today());
  const [annotate, setAnnotate] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await seoFetch<{ posts: Post[]; durable: boolean; siteUrl: string | null }>("/api/posts");
      setPosts(r.posts);
      setDurable(r.durable);
      setSite((cur) => cur || r.siteUrl || "");
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load posts"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const url = useMemo(() => (site && source && medium && campaign ? buildUtmUrl(site, { source, medium, campaign, content }) : null), [site, source, medium, campaign, content]);
  const { within: inRangeDay } = useDateRange();
  const results = useMemo(() => (metrics ? postResults(posts.filter((p) => inRangeDay(p.postedOn)), metrics.subscriberList, metrics.planPricing) : []), [posts, metrics, inRangeDay]);

  function pick(p: string) {
    setPlatform(p);
    const d = PLATFORMS[p];
    if (d.source) { setSource(d.source); setMedium(d.medium); }
  }
  async function save() {
    if (!url) return;
    try {
      await seoFetch("/api/posts", { method: "POST", body: JSON.stringify({ postedOn, platform, title, url, utmSource: slug(source), utmMedium: slug(medium), utmCampaign: slug(campaign), utmContent: slug(content), notes, annotate }) });
      setTitle(""); setNotes(""); setContent("");
      load();
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save"); }
  }
  async function del(id: string) {
    await seoFetch("/api/posts", { method: "DELETE", body: JSON.stringify({ id }) }).catch(() => {});
    load();
  }

  const input = "rounded-lg border border-border bg-surface px-3 py-1.5 text-sm";
  const campaigns = useMemo(() => [...new Set(posts.map((p) => p.utmCampaign).filter(Boolean))] as string[], [posts]);

  return (
    <>
      <Card title="UTM link builder" subtitle="Consistent, lower-case, underscore-separated tags so attribution in Supabase and GA4 lines up.">
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-muted">Landing page URL<input className={`${input} mt-1 w-full`} value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://northbooks.ca" /></label>
          <label className="text-xs text-muted">Platform
            <select className={`${input} mt-1 w-full`} value={platform} onChange={(e) => pick(e.target.value)}>{Object.keys(PLATFORMS).map((p) => <option key={p}>{p}</option>)}</select>
          </label>
          <label className="text-xs text-muted">utm_source<input className={`${input} mt-1 w-full`} value={source} onChange={(e) => setSource(e.target.value)} /></label>
          <label className="text-xs text-muted">utm_medium<input className={`${input} mt-1 w-full`} value={medium} onChange={(e) => setMedium(e.target.value)} /></label>
          <label className="text-xs text-muted">utm_campaign (the theme)
            <input className={`${input} mt-1 w-full`} value={campaign} onChange={(e) => setCampaign(e.target.value)} list="campaigns" placeholder="e.g. tax_season_2027" />
            <datalist id="campaigns">{campaigns.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="text-xs text-muted">utm_content (this specific post)<input className={`${input} mt-1 w-full`} value={content} onChange={(e) => setContent(e.target.value)} placeholder="e.g. r_smallbusiness_hst_tips" /></label>
        </div>
        <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
          {url ? (
            <div className="flex items-start justify-between gap-3">
              <code className="min-w-0 break-all font-mono text-xs">{url}</code>
              <CopyButton label="Copy link" getText={() => url} />
            </div>
          ) : <p className="text-xs text-muted">Fill in the URL, source, medium and campaign to generate a link.</p>}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-muted">Posted on<input type="date" className={`${input} mt-1 w-full`} value={postedOn} onChange={(e) => setPostedOn(e.target.value)} /></label>
          <label className="text-xs text-muted lg:col-span-2">Title / what you posted<input className={`${input} mt-1 w-full`} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="text-xs text-muted">Notes<input className={`${input} mt-1 w-full`} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <RunButton onClick={save} disabled={!url}>Log this post</RunButton>
          <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={annotate} onChange={(e) => setAnnotate(e.target.checked)} /> Also mark it on the trend charts</label>
        </div>
      </Card>

      <Card title="Post log & results" subtitle="Signups are matched to each post by utm_campaign (plus utm_content when the post has one).">
        {!durable && <Notice>Posts are saved to a local file. Run <code className="font-mono text-xs">sql/admin_tables.sql</code> in Supabase to keep them permanently.</Notice>}
        <div className="mt-3">
          <DataTable<PostResult>
            rows={results} viewsKey="growth-posts"
            rowKey={(r) => r.id}
            compact
            searchText={(r) => `${r.title ?? ""} ${r.platform ?? ""} ${r.utmCampaign ?? ""} ${r.utmContent ?? ""}`}
            filters={[{ key: "platform", label: "Platforms", getValue: (r) => r.platform ?? "Other" }]}
            initialSort={{ key: "date", dir: "desc" }}
            emptyMessage="No posts logged yet."
            columns={[
              col<PostResult>("date", "Posted", (r) => r.postedOn, (r) => <span className="text-muted">{r.postedOn}</span>, { firstDir: "desc" }),
              col<PostResult>("platform", "Platform", (r) => r.platform ?? ""),
              col<PostResult>("title", "Post", (r) => r.title ?? "", (r) => (
                <span className="flex items-center gap-1.5">{r.title || <span className="text-muted">—</span>}{r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-muted hover:text-text" aria-label="Open link"><ExternalLink size={12} /></a>}</span>
              )),
              col<PostResult>("tags", "campaign / content", (r) => `${r.utmCampaign ?? ""} ${r.utmContent ?? ""}`, (r) => <span className="text-xs text-muted">{r.utmCampaign ?? "—"}{r.utmContent ? ` / ${r.utmContent}` : ""}</span>),
              num<PostResult>("signups", "Signups", (r) => r.signups, (r) => <span title={`matched by ${r.matchedBy}`}>{r.signups}</span>),
              num<PostResult>("s7", "First 7d", (r) => r.signups7d),
              num<PostResult>("setup", "Set up", (r) => r.setUp),
              num<PostResult>("paid", "Paid", (r) => r.paid, (r) => <span className={r.paid ? "text-success" : "text-muted"}>{r.paid}</span>),
              num<PostResult>("mrr", "MRR", (r) => r.mrr, (r) => money(r.mrr)),
              { key: "del", header: "", sortValue: () => null, cell: (r) => <button onClick={() => del(r.id)} aria-label="Delete post" className="text-muted hover:text-danger"><Trash2 size={13} /></button> },
            ]}
          />
        </div>
      </Card>
    </>
  );
}

// ---------------- Mentions ----------------
function Mentions() {
  const { within: inRangeDay } = useDateRange();
  const [data, setData] = useState<MentionsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    try {
      setData(await seoFetch<MentionsResult>(`/api/mentions${refresh ? "?refresh=1" : ""}`));
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load mentions"); }
    setBusy(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function markSeen() {
    if (!data) return;
    await seoFetch("/api/mentions", { method: "POST", body: JSON.stringify({ ids: data.items.map((i) => i.id) }) }).catch(() => {});
    load();
  }
  const fresh = data?.items.filter((i) => i.isNew).length ?? 0;

  return (
    <Card
      title={<>Brand mentions {fresh > 0 && <Pill tone="good">{fresh} new</Pill>}</>}
      subtitle={data ? `Searching ${data.terms.map((t) => `“${t}”`).join(", ")} on Hacker News and Reddit${data.sources.some((s) => s.name === "Google Alerts") ? " + your Google Alerts feeds" : ""} — last 30–60 days.` : "Free sources only."}
      action={
        <div className="flex gap-2">
          {fresh > 0 && <RunButton onClick={markSeen}>Mark all seen</RunButton>}
          <RunButton onClick={() => load(true)} busy={busy}><RefreshCw size={13} /> Check now</RunButton>
        </div>
      }
    >
      {error && <ErrorNote>{error}</ErrorNote>}
      {data && (
        <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {data.sources.map((s) => (
            <span key={s.name} className={s.ok ? "" : "text-warning"} title={s.error ?? ""}>
              {s.name}: {s.ok ? `${s.count} found` : `unavailable (${s.error})`}
            </span>
          ))}
        </p>
      )}
      {data && !data.sources.some((s) => s.name === "Google Alerts") && (
        <p className="mb-3 text-xs text-muted">
          Tip: create a Google Alert for your brand at google.com/alerts, choose “Deliver to: RSS feed”, and put the feed URL in <code className="font-mono">GOOGLE_ALERTS_RSS</code> to also catch blogs and news.
        </p>
      )}
      <DataTable<Mention>
        rows={(data?.items ?? []).filter((i) => inRangeDay(i.date))} viewsKey="growth-mentions"
        rowKey={(r) => r.id}
        compact
        maxHeight={440}
        searchText={(r) => `${r.title} ${r.snippet ?? ""} ${r.context ?? ""}`}
        filters={[{ key: "source", label: "Sources", getValue: (r) => ({ hackernews: "Hacker News", reddit: "Reddit", alerts: "Google Alerts" })[r.source] }]}
        initialSort={{ key: "date", dir: "desc" }}
        emptyMessage={data ? "No mentions found." : "Loading…"}
        columns={[
          col<Mention>("date", "Date", (r) => r.date, (r) => <span className="text-muted">{r.date.slice(0, 10)}</span>, { firstDir: "desc" }),
          col<Mention>("src", "Source", (r) => r.source, (r) => <Pill>{r.source === "hackernews" ? "HN" : r.source === "reddit" ? "Reddit" : "Alert"}</Pill>),
          col<Mention>("title", "Mention", (r) => r.title, (r) => (
            <div className="max-w-xl">
              <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">{r.isNew && <span className="mr-1.5 text-accent">●</span>}{r.title}</a>
              {r.snippet && <p className="truncate text-xs text-muted">{r.snippet}</p>}
            </div>
          )),
          col<Mention>("ctx", "Where", (r) => r.context ?? "", (r) => <span className="text-xs text-muted">{r.context}</span>),
          col<Mention>("by", "By", (r) => r.author ?? "", (r) => <span className="text-xs text-muted">{r.author ?? "—"}</span>),
        ]}
      />
    </Card>
  );
}

export default function GrowthPage() {
  const { metrics } = useDashboard();
  if (!metrics) return null;
  return (
    <div className="flex flex-col gap-6">
      <Funnel />
      <TrackingCheck />
      <Campaigns />
      <Links />
      <Mentions />
    </div>
  );
}
