import {
  TrendingUp,
  Users,
  Target,
  MousePointerClick,
  Clock,
  Repeat,
} from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { ChannelChart } from "@/components/marketing/ChannelChart";
import { SessionsTrendChart } from "@/components/marketing/SessionsTrendChart";
import { SearchConsoleTrendChart } from "@/components/marketing/SearchConsoleTrendChart";
import { RankedTable } from "@/components/marketing/RankedTable";
import { BarList } from "@/components/marketing/BarList";
import { CopyButton } from "@/components/CopyButton";
import type { MarketingMetrics } from "@/lib/marketing";

function SetupNotice({ what, envVars }: { what: string; envVars: string[] }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface p-5 text-sm text-muted">
      <p className="mb-2">
        <span className="font-medium text-text">{what}</span> isn&apos;t
        connected yet.
      </p>
      <p className="mb-2">Set these in .env.local to enable it:</p>
      <ul className="list-disc space-y-0.5 pl-5 font-mono text-xs">
        {envVars.map((v) => (
          <li key={v}>{v}</li>
        ))}
      </ul>
      <p className="mt-2">
        See <code className="font-mono text-xs">docs/marketing-setup.md</code>{" "}
        for the full walkthrough.
      </p>
    </div>
  );
}

function formatSeconds(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.round(totalSeconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

const DEVICE_LABELS: Record<string, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  tablet: "Tablet",
};

export function MarketingSection({
  marketing,
  error,
}: {
  marketing: MarketingMetrics | null;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="rounded-2xl border border-danger/30 bg-danger/10 p-5 text-sm text-danger">
        <p className="font-medium">Couldn&apos;t load marketing data</p>
        <p className="mt-1">{error}</p>
        <CopyButton getText={() => error} label="Copy error" className="mt-2" />
        <p className="mt-2 text-xs opacity-80">
          Check the terminal running `npm run dev` for the full error —
          this is almost always a Google API auth issue (private key
          formatting, or the service account not having access yet).
        </p>
      </div>
    );
  }

  if (!marketing) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5 text-sm text-muted">
        Loading marketing data…
      </div>
    );
  }

  const { ga4, searchConsole } = marketing;

  const newReturningTotal = ga4.newVsReturning.new + ga4.newVsReturning.returning;
  const newPct =
    newReturningTotal > 0
      ? Math.round((ga4.newVsReturning.new / newReturningTotal) * 100)
      : null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-medium text-muted">Last 30 days</h2>

      {!ga4.configured ? (
        <SetupNotice
          what="Google Analytics 4"
          envVars={[
            "GOOGLE_SERVICE_ACCOUNT_EMAIL",
            "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
            "GA4_PROPERTY_ID",
          ]}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Sessions"
              value={ga4.sessions.toLocaleString()}
              sub={`${ga4.totalUsers.toLocaleString()} total users`}
              icon={TrendingUp}
            />
            <StatCard
              label="New users"
              value={ga4.newUsers.toLocaleString()}
              sub="Last 30 days"
              icon={Users}
            />
            <StatCard
              label="Key events"
              value={ga4.conversions.toLocaleString()}
              sub="Configured conversions in GA4"
              icon={Target}
            />
            <StatCard
              label="Engagement rate"
              value={`${Math.round(ga4.engagementRate * 100)}%`}
              sub="Share of sessions with meaningful activity"
              icon={MousePointerClick}
            />
            <StatCard
              label="Avg. engagement time"
              value={formatSeconds(ga4.avgEngagementSeconds)}
              sub="Per session"
              icon={Clock}
            />
            <StatCard
              label="New vs. returning"
              value={newPct !== null ? `${newPct}% new` : "—"}
              sub={
                newReturningTotal > 0
                  ? `${ga4.newVsReturning.new.toLocaleString()} new, ${ga4.newVsReturning.returning.toLocaleString()} returning`
                  : "No session data yet"
              }
              icon={Repeat}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
              <h3 className="mb-4 text-sm font-medium">Sessions over time</h3>
              <SessionsTrendChart data={ga4.dailySessions} />
            </div>
            <div className="rounded-2xl border border-border bg-surface p-5">
              <h3 className="mb-4 text-sm font-medium">Traffic by channel</h3>
              <ChannelChart data={ga4.byChannel} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
              <h3 className="mb-4 text-sm font-medium">Top landing pages</h3>
              <BarList
                items={ga4.topLandingPages.map((p) => ({
                  label: p.page,
                  value: p.sessions,
                }))}
                valueLabel="sessions"
              />
            </div>
            <div className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5">
              <div>
                <h3 className="mb-3 text-sm font-medium">Device</h3>
                <BarList
                  items={ga4.byDevice.map((d) => ({
                    label: DEVICE_LABELS[d.device] ?? d.device,
                    value: d.sessions,
                  }))}
                  valueLabel="sessions"
                />
              </div>
              <div>
                <h3 className="mb-3 text-sm font-medium">Country</h3>
                <BarList
                  items={ga4.byCountry.map((c) => ({
                    label: c.country,
                    value: c.sessions,
                  }))}
                  valueLabel="sessions"
                />
              </div>
            </div>
          </div>
        </>
      )}

      {!searchConsole.configured ? (
        <SetupNotice
          what="Search Console"
          envVars={[
            "GOOGLE_SERVICE_ACCOUNT_EMAIL",
            "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
            "SEARCH_CONSOLE_SITE_URL",
          ]}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-medium">Search Console — clicks &amp; impressions</h3>
                <div className="flex items-center gap-4 text-xs text-muted">
                  <span className="flex items-center gap-1">
                    <MousePointerClick size={12} />
                    {searchConsole.clicks.toLocaleString()} clicks
                  </span>
                  <span>{searchConsole.impressions.toLocaleString()} impressions</span>
                  <span>{(searchConsole.ctr * 100).toFixed(1)}% CTR</span>
                  <span>Avg. position {searchConsole.position.toFixed(1)}</span>
                </div>
              </div>
              <SearchConsoleTrendChart data={searchConsole.dailyTrend} />
            </div>
            <div className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5">
              <div>
                <h3 className="mb-3 text-sm font-medium">Device</h3>
                <BarList
                  items={searchConsole.byDevice.map((d) => ({
                    label: DEVICE_LABELS[d.device.toLowerCase()] ?? d.device,
                    value: d.clicks,
                    sub: `${d.impressions.toLocaleString()} impr.`,
                  }))}
                  valueLabel="clicks"
                />
              </div>
              <div>
                <h3 className="mb-3 text-sm font-medium">Country</h3>
                <BarList
                  items={searchConsole.byCountry.map((c) => ({
                    label: c.country,
                    value: c.clicks,
                    sub: `${c.impressions.toLocaleString()} impr.`,
                  }))}
                  valueLabel="clicks"
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5">
            <h3 className="mb-4 text-sm font-medium">Top queries</h3>
            <RankedTable
              rows={searchConsole.topQueries.map((q) => ({
                label: q.query,
                clicks: q.clicks,
                impressions: q.impressions,
                ctr: q.ctr,
                position: q.position,
              }))}
              labelHeader="Query"
              emptyMessage="No query data in this window yet."
            />
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5">
            <h3 className="mb-4 text-sm font-medium">Top pages</h3>
            <RankedTable
              rows={searchConsole.topPages.map((p) => ({
                label: p.page,
                clicks: p.clicks,
                impressions: p.impressions,
                ctr: p.ctr,
                position: p.position,
              }))}
              labelHeader="Page"
              emptyMessage="No page data in this window yet."
            />
          </div>
        </>
      )}
    </div>
  );
}
