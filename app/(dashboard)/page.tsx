"use client";

import {
  Users,
  DollarSign,
  TrendingDown,
  Building2,
  AlertTriangle,
  Percent,
  CheckCircle2,
  Zap,
} from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { TrendChart } from "@/components/TrendChart";
import { PlanChart } from "@/components/PlanChart";
import { ActivityFeed } from "@/components/ActivityFeed";
import { useDashboard } from "@/lib/DashboardContext";
import { useDateRange } from "@/lib/DateRangeContext";

export default function OverviewPage() {
  const { metrics } = useDashboard();
  const { within, range } = useDateRange();
  // The layout already shows a loading/error state until metrics exists.
  if (!metrics) return null;

  return (
    <>
      {metrics.mrrGoal && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">MRR goal</span>
            <span className="text-muted">
              ${(metrics.mrrActual ?? metrics.mrr).toLocaleString()} of ${metrics.mrrGoal.toLocaleString()}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.min(100, Math.round(((metrics.mrrActual ?? metrics.mrr) / metrics.mrrGoal) * 100))}%` }}
            />
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active subscribers"
          value={String(metrics.subscribers.total)}
          sub={`${metrics.paidSubscribers} paid · ${metrics.freeUsers} free · ${metrics.totalUsers} signups`}
          icon={Users}
        />
        <StatCard
          label={metrics.mrrActual !== null ? "MRR (Helcim)" : "Estimated MRR"}
          value={`$${(metrics.mrrActual ?? metrics.mrr).toLocaleString()}`}
          sub={
            metrics.mrrActual !== null
              ? `Estimate from plans: $${metrics.mrr.toLocaleString()}${metrics.helcim.failedPaymentCount ? ` · ${metrics.helcim.failedPaymentCount} failed payment(s)` : ""}`
              : metrics.pricingConfirmed
                ? "Pro $9 · Pro Plus $15"
                : "PLAN_PRICES invalid — using defaults"
          }
          icon={DollarSign}
        />
        <StatCard
          label="Cancellations (30d)"
          value={String(metrics.cancellations.last30Days)}
          sub="Approximate — no cancel timestamp in DB"
          icon={TrendingDown}
        />
        <StatCard
          label="Business set up"
          value={
            metrics.totalUsers > 0
              ? `${Math.round((metrics.setUpCount / metrics.totalUsers) * 100)}%`
              : "—"
          }
          sub={`${metrics.setUpCount} of ${metrics.totalUsers} signups`}
          icon={CheckCircle2}
        />
        <StatCard
          label="Activated"
          value={metrics.adoption ? `${Math.round((metrics.adoption.activated / (metrics.adoption.users || 1)) * 100)}%` : "—"}
          sub={metrics.adoption ? `${metrics.adoption.activated} of ${metrics.adoption.users} recorded an invoice, expense or bank statement` : "Run sql/crm_data.sql to measure"}
          icon={Zap}
        />
        <StatCard
          label="Companies created"
          value={String(metrics.totalCompanies)}
          sub={`${metrics.avgCompaniesPerUser.toFixed(1)} avg per user`}
          icon={Building2}
        />
        <StatCard
          value={String(metrics.atRiskCount)}
          label="At-risk subscribers"
          sub={`Paid, but gone quiet · ${metrics.inactiveFreeCount} inactive free`}
          icon={AlertTriangle}
        />
        <StatCard
          label="Trial → paid"
          value={
            metrics.trialConversion.everTrialed > 0
              ? `${Math.round(metrics.trialConversion.rate * 100)}%`
              : "—"
          }
          sub={
            metrics.trialConversion.everTrialed > 0
              ? `${metrics.trialConversion.converted} of ${metrics.trialConversion.everTrialed} converted`
              : "No trials yet"
          }
          icon={Percent}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium">Signups vs. cancellations ({range.isAll ? "30d" : `${range.label.toLowerCase()}, within the last 30d`})</h2>
            <span className="text-xs text-muted">
              {metrics.signups.last7Days} signups in last 7 days
            </span>
          </div>
          <TrendChart
            signups={metrics.signups.series.filter((d) => within(d.date))}
            cancellations={metrics.cancellations.series.filter((d) => within(d.date))}
          />
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-4 text-sm font-medium">Plan distribution (active)</h2>
          <PlanChart byPlan={metrics.subscribers.byPlan} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium">Recent activity</h2>
          <ActivityFeed items={metrics.recentActivity} />
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-2 text-sm font-medium">Renewing in next 7 days</h2>
          {metrics.upcomingRenewals.length === 0 ? (
            <p className="text-sm text-muted">Nothing renewing soon.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {metrics.upcomingRenewals.map((r, i) => (
                <li key={i} className="flex items-center justify-between py-3">
                  <div className="flex flex-col">
                    <span className="text-sm">{r.maskedUser}</span>
                    <span className="text-xs text-muted">{r.plan}</span>
                  </div>
                  <span className="text-xs text-muted">
                    {new Date(r.date).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
