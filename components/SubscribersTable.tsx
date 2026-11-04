"use client";

import { AlertCircle, AlertTriangle, CalendarClock, Moon } from "lucide-react";
import { CRM_STAGES } from "@/lib/adminTypes";
import { useCrm } from "@/components/crm/CrmContext";
import { OutreachMenu } from "@/components/crm/OutreachMenu";
import type { SubscriberRow, ActivationStage } from "@/lib/metrics";
import { DataTable, type Column, type FilterDef } from "@/components/DataTable";

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

const ACTIVATION_LABELS: Record<ActivationStage, string> = {
  not_started: "Not started",
  set_up: "Set up",
  building: "Building",
  activated: "Activated",
};

const ACTIVATION_ORDER: Record<ActivationStage, number> = {
  not_started: 0,
  set_up: 1,
  building: 2,
  activated: 3,
};

const ACTIVATION_STYLES: Record<ActivationStage, string> = {
  not_started: "bg-warning/10 text-warning",
  set_up: "bg-accent/10 text-accent",
  building: "bg-success/10 text-success",
  activated: "bg-success/20 text-success",
};

function ActivationBadge({ stage }: { stage: ActivationStage }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ACTIVATION_STYLES[stage]}`}
    >
      {ACTIVATION_LABELS[stage]}
    </span>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return <span className="text-xs text-muted">—</span>;
  }
  const styles: Record<string, string> = {
    active: "bg-success/10 text-success",
    trialing: "bg-accent/10 text-accent",
    canceled: "bg-danger/10 text-danger",
    past_due: "bg-warning/10 text-warning",
  };
  const style = styles[status] ?? "bg-surface-2 text-muted";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {status}
    </span>
  );
}

function riskLabel(r: SubscriberRow): string {
  if (r.atRisk) return "At risk (paid)";
  if (r.inactiveFree) return "Inactive free";
  return "OK";
}

const lastLoginTime = (r: SubscriberRow) =>
  r.lastLoginAt ? new Date(r.lastLoginAt).getTime() : null;

export function SubscribersTable({
  rows,
  loginCountsAvailable,
  attributionAvailable,
  usageAvailable = false,
}: {
  rows: SubscriberRow[];
  loginCountsAvailable: boolean;
  attributionAvailable: boolean;
  usageAvailable?: boolean;
}) {
  const crm = useCrm();
  const todayStr = new Date().toISOString().slice(0, 10);
  const stageLabel = (r: SubscriberRow) => CRM_STAGES.find((s) => s.id === crm.stageOf(r).stage)?.label ?? "";
  const followUp = (r: SubscriberRow) => crm.contacts.get(r.id)?.followUpOn ?? null;
  const columns: Column<SubscriberRow>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (r) => r.fullName?.toLowerCase(),
      copy: (r) => r.fullName,
      cell: (r) => (
        <span className="flex items-center gap-1.5">
          {r.atRisk && (
            <span title={r.atRiskReason ?? "At risk"}>
              <AlertTriangle
                size={13}
                className="shrink-0 text-warning"
                aria-label={r.atRiskReason ?? "At risk"}
              />
            </span>
          )}
          {!r.atRisk && r.inactiveFree && (
            <span title={`Inactive free user: ${r.inactiveFreeReason ?? ""}`}>
              <Moon
                size={13}
                className="shrink-0 text-muted"
                aria-label="Inactive free user"
              />
            </span>
          )}
          {r.fullName || <span className="text-muted">—</span>}
        </span>
      ),
    },
    {
      key: "company",
      header: "Company",
      sortValue: (r) => r.companyNames.join(", ").toLowerCase(),
      copy: (r) => r.companyNames.join(", "),
      cell: (r) =>
        r.companyNames.length > 0 ? (
          <span title={r.companyNames.join(", ")}>
            {truncate(r.companyNames.join(", "), 25)}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "email",
      header: "Email",
      sortValue: (r) => r.email?.toLowerCase(),
      copy: (r) => r.email,
      cell: (r) => <span className="text-muted">{r.email || "—"}</span>,
    },
    {
      key: "plan",
      header: "Plan",
      sortValue: (r) => r.plan?.toLowerCase(),
      copy: (r) => r.plan,
      cell: (r) => (
        <span className="capitalize">
          {r.plan || <span className="text-muted">—</span>}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (r) => r.status,
      copy: (r) =>
        r.renewalOverdueDays !== null ? `${r.status} (renewal ${r.renewalOverdueDays}d overdue)` : r.status,
      cell: (r) => (
        <>
          <StatusBadge status={r.status} />
          {r.renewalOverdueDays !== null && (
            <span
              className="ml-1.5 inline-flex align-middle"
              title={`Renewal overdue: the billing period ended ${r.renewalOverdueDays} day${r.renewalOverdueDays === 1 ? "" : "s"} ago, but the status is still "${r.status}". Could be a stale date or a failed payment — check your billing provider.`}
            >
              <AlertCircle
                size={14}
                className="text-warning"
                aria-label="Renewal overdue"
              />
            </span>
          )}
        </>
      ),
    },
    {
      key: "setup",
      header: "Setup",
      sortValue: (r) => ACTIVATION_ORDER[r.activationStage],
      copy: (r) => ACTIVATION_LABELS[r.activationStage],
      firstDir: "desc",
      cell: (r) => <ActivationBadge stage={r.activationStage} />,
    },
    {
      key: "joined",
      header: "Joined",
      sortValue: (r) => new Date(r.joinedAt).getTime(),
      copy: (r) => r.joinedAt.slice(0, 10),
      firstDir: "desc",
      cell: (r) => (
        <span className="text-muted">
          {new Date(r.joinedAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "age",
      header: "Age",
      // Same data as Joined, but sorted by number of days.
      sortValue: (r) => daysSince(r.joinedAt),
      firstDir: "desc",
      cell: (r) => <span className="text-muted">{daysSince(r.joinedAt)}d</span>,
    },
    {
      key: "lead",
      header: (
        <>
          Lead source
          {!attributionAvailable && (
            <span
              className="ml-1 cursor-help font-normal text-muted"
              title="Couldn't read the attribution columns from profiles"
            >
              (setup needed)
            </span>
          )}
        </>
      ),
      sortValue: (r) =>
        r.leadSource === "Not captured" ? null : r.leadSource.toLowerCase(),
      copy: (r) =>
        [r.leadSource, r.signupCampaign && `campaign: ${r.signupCampaign}`, r.signupContent && `content: ${r.signupContent}`]
          .filter(Boolean)
          .join(" · "),
      cell: (r) => (
        <span
          title={
            [
              r.signupSource && `utm_source: ${r.signupSource}`,
              r.signupMedium && `utm_medium: ${r.signupMedium}`,
              r.signupCampaign && `utm_campaign: ${r.signupCampaign}`,
              r.signupContent && `utm_content: ${r.signupContent}`,
              r.signupTerm && `utm_term: ${r.signupTerm}`,
              r.firstTouchSource && `first touch: ${r.firstTouchSource}`,
              r.signupTouchSource && `signup touch: ${r.signupTouchSource}`,
              r.signupReferrer && `referrer: ${r.signupReferrer}`,
            ]
              .filter(Boolean)
              .join("\n") || "No attribution recorded for this user"
          }
        >
          {r.leadSource !== "Not captured" ? (
            <>
              {r.leadSource}
              {r.signupCampaign && (
                <span className="ml-1 text-xs text-muted">
                  · {r.signupCampaign}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted">Not captured</span>
          )}
        </span>
      ),
    },
    {
      key: "invoices",
      header: (
        <>
          Invoices
          {!usageAvailable && (
            <span className="ml-1 cursor-help font-normal text-muted" title="Run sql/crm_data.sql in the Supabase SQL editor to enable this">
              (setup needed)
            </span>
          )}
        </>
      ),
      sortValue: (r) => r.usage?.invoices ?? null,
      copy: (r) => r.usage?.invoices ?? "",
      firstDir: "desc",
      cell: (r) =>
        r.usage ? (
          <span className={r.usage.invoices ? "" : "text-muted"} title={`${r.usage.invoicesSent} sent · ${r.usage.invoicesPaid} paid · ${r.usage.clients} clients · ${r.usage.expenses} expenses`}>
            {r.usage.invoices}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "stage",
      header: "Stage",
      sortValue: (r) => stageLabel(r),
      copy: (r) => stageLabel(r),
      cell: (r) => <span className="text-muted">{stageLabel(r)}</span>,
    },
    {
      key: "followUp",
      header: "Follow-up",
      sortValue: (r) => followUp(r),
      copy: (r) => followUp(r),
      firstDir: "asc",
      cell: (r) => {
        const f = followUp(r);
        if (!f) return <span className="text-muted">—</span>;
        const due = f <= todayStr;
        return (
          <span className={`inline-flex items-center gap-1 ${due ? "text-warning" : "text-muted"}`} title={due ? "Follow-up is due" : "Scheduled follow-up"}>
            <CalendarClock size={13} /> {f}
          </span>
        );
      },
    },
    {
      key: "reach",
      header: "",
      cell: (r) => (r.atRisk || r.inactiveFree || r.helcimFailed || crm.contacts.get(r.id)?.followUpOn ? <OutreachMenu row={r} compact /> : null),
    },
    {
      key: "lastLogin",
      header: "Last login",
      // Never-logged-in users sort to the bottom in either direction.
      sortValue: lastLoginTime,
      copy: (r) => r.lastLoginAt?.slice(0, 16).replace("T", " ") ?? "never",
      firstDir: "desc",
      cell: (r) =>
        r.lastLoginAt ? (
          timeAgo(r.lastLoginAt)
        ) : (
          <span className="text-warning">Never</span>
        ),
    },
    {
      key: "logins",
      header: (
        <>
          Logins
          {!loginCountsAvailable && (
            <span
              className="ml-1 cursor-help font-normal text-muted"
              title="Run sql/login_counts.sql in the Supabase SQL editor to enable this"
            >
              (setup needed)
            </span>
          )}
        </>
      ),
      sortValue: (r) => r.loginCount,
      firstDir: "desc",
      cell: (r) => (
        <span className="text-muted">
          {r.loginCount === null ? "—" : r.loginCount}
        </span>
      ),
    },
  ];

  const filters: FilterDef<SubscriberRow>[] = [
    { key: "plan", label: "Plans", getValue: (r) => r.plan ?? "No plan" },
    { key: "status", label: "Statuses", getValue: (r) => r.status ?? "No subscription" },
    {
      key: "setup",
      label: "Setup stages",
      getValue: (r) => ACTIVATION_LABELS[r.activationStage],
      options: Object.values(ACTIVATION_LABELS),
    },
    {
      key: "lead",
      label: "Lead sources",
      getValue: (r) => r.leadSource,
    },
    {
      key: "risk",
      label: "Risk",
      getValue: riskLabel,
      options: ["At risk (paid)", "Inactive free", "OK"],
    },
    {
      key: "renewal",
      label: "Renewals",
      getValue: (r) =>
        r.renewalOverdueDays !== null ? "Overdue" : "Not overdue",
      options: ["Overdue", "Not overdue"],
    },
    { key: "stage", label: "Pipeline stages", getValue: stageLabel, options: CRM_STAGES.map((s) => s.label) },
    {
      key: "followup",
      label: "Follow-ups",
      getValue: (r) => { const f = followUp(r); return !f ? "None" : f <= todayStr ? "Due / overdue" : "Scheduled"; },
      options: ["Due / overdue", "Scheduled", "None"],
    },
    {
      key: "activated",
      label: "Activation",
      getValue: (r) => (r.activated === null ? null : r.activated ? "Activated" : "Not activated"),
      options: ["Activated", "Not activated"],
    },
    {
      key: "login",
      label: "Login state",
      getValue: (r) => (r.lastLoginAt ? "Has logged in" : "Never logged in"),
      options: ["Has logged in", "Never logged in"],
    },
  ];

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <DataTable
        title="Subscribers"
        rows={rows} viewsKey="subscribers"
        columns={columns}
        rowKey={(r) => r.id}
        filters={filters}
        initialSort={{ key: "joined", dir: "desc" }}
        searchPlaceholder="Search name, email, company…"
        searchText={(r) =>
          [r.fullName, r.email, ...r.companyNames, r.plan, r.leadSource]
            .filter(Boolean)
            .join(" ")
        }
        onRowClick={(r) => crm.open(r.id)}
        emptyMessage="No subscribers yet."
      />
    </div>
  );
}
