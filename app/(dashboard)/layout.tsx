"use client";

import { useState } from "react";
import { RefreshCw, LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Nav } from "@/components/Nav";
import { ExportMenu } from "@/components/ExportMenu";
import { CopyButton } from "@/components/CopyButton";
import { DashboardProvider, useDashboard } from "@/lib/DashboardContext";
import { CrmProvider } from "@/components/crm/CrmContext";
import { SubscriberDrawer } from "@/components/crm/SubscriberDrawer";
import { MonitorPing } from "@/components/MonitorPing";
import { DateRangeProvider } from "@/lib/DateRangeContext";
import { SavedViewsProvider } from "@/lib/SavedViewsContext";
import { DateRangePicker } from "@/components/DateRangePicker";

function DashboardChrome({ children }: { children: React.ReactNode }) {
  const [showHidden, setShowHidden] = useState(false);
  const { metrics, error, loading, refreshing, refresh, signOut } =
    useDashboard();

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center text-sm text-danger">
        <p className="max-w-xl break-words">{error}</p>
        <CopyButton getText={() => error} label="Copy error" />
      </div>
    );
  }

  if (loading || !metrics) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Subscriber Dashboard
          </h1>
          <p className="text-sm text-muted">
            Updated {new Date(metrics.generatedAt).toLocaleTimeString()}
            {metrics.excludedTestAccounts > 0 && (
              <>
                {" · "}
                <button onClick={() => setShowHidden((v) => !v)} className="underline decoration-dotted underline-offset-2 hover:text-text" title="Hidden by EXCLUDED_EMAILS — click to see who">
                  {metrics.excludedTestAccounts} test account{metrics.excludedTestAccounts === 1 ? "" : "s"} hidden
                </button>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
          <ExportMenu />
          <ThemeToggle />
          <button
            onClick={signOut}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-text transition-colors hover:bg-surface-2"
            aria-label="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {showHidden && metrics.excludedAccounts.length > 0 && (
        <div className="mb-4 rounded-xl border border-border bg-surface p-3 text-xs">
          <p className="mb-2 text-muted">Hidden from every number because they match <code>EXCLUDED_EMAILS</code>. If someone here is a real customer, loosen the pattern in .env.local and restart.</p>
          <ul className="flex flex-col gap-1">
            {metrics.excludedAccounts.map((a, i) => (
              <li key={i} className="flex flex-wrap gap-x-3">
                <span>{a.email ?? "(no email)"}</span>
                <span className="text-muted">joined {a.joinedAt.slice(0, 10)}</span>
                <span className="text-muted">matched <code>{a.matchedBy ?? "?"}</code></span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Nav />
      <DateRangePicker />

            <main className="mt-6 flex flex-col gap-6">{children}</main>
      <SubscriberDrawer />
      <MonitorPing />
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardProvider>
      <DateRangeProvider>
        <SavedViewsProvider>
          <CrmProvider>
            <DashboardChrome>{children}</DashboardChrome>
          </CrmProvider>
        </SavedViewsProvider>
      </DateRangeProvider>
    </DashboardProvider>
  );
}
