"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Trash2 } from "lucide-react";
import { useDashboard } from "@/lib/DashboardContext";
import { CRM_STAGES } from "@/lib/adminTypes";
import type { SubscriberRow } from "@/lib/metrics";
import { CopyButton } from "@/components/CopyButton";
import { useCrm } from "./CrmContext";
import { OutreachMenu } from "./OutreachMenu";

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const d10 = (s: string | null | undefined) => (s ? s.slice(0, 10) : "");

type Ev = { at: string; text: string; tone?: "good" | "warn" | "bad" | "note"; noteId?: string };

function timeline(r: SubscriberRow, notes: { id: string; body: string; createdAt: string }[]): Ev[] {
  const ev: Ev[] = [{ at: r.joinedAt, text: `Signed up${r.signupMethod ? ` (${r.signupMethod})` : ""} · ${r.leadSource}` }];
  if (r.companyCreatedAt) ev.push({ at: r.companyCreatedAt, text: `Created first company${r.companyNames[0] ? ` “${r.companyNames[0]}”` : ""}` });
  r.subHistory.forEach((s, i) => {
    ev.push({ at: s.createdAt, text: `Subscription: ${s.plan ?? "no plan"} · ${s.status ?? "?"}`, tone: s.status === "canceled" ? "bad" : "good" });
    if (s.updatedAt && d10(s.updatedAt) !== d10(s.createdAt) && (s.status === "canceled" || i < r.subHistory.length - 1)) {
      ev.push({ at: s.updatedAt, text: `Subscription ${s.status === "canceled" ? "cancelled" : "changed"} (${s.plan ?? "?"})`, tone: s.status === "canceled" ? "bad" : undefined });
    }
  });
  if (r.usage?.firstInvoiceAt) ev.push({ at: r.usage.firstInvoiceAt, text: "Created first invoice", tone: "good" });
  if (r.usage?.lastInvoiceAt && r.usage.lastInvoiceAt !== r.usage.firstInvoiceAt) ev.push({ at: r.usage.lastInvoiceAt, text: `Created most recent invoice (${r.usage.invoices} total)` });
  if (r.lastLoginAt) ev.push({ at: r.lastLoginAt, text: "Last login" });
  for (const n of notes) ev.push({ at: n.createdAt, text: n.body, tone: "note", noteId: n.id });
  return ev.sort((a, b) => b.at.localeCompare(a.at));
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

export function SubscriberDrawer() {
  const { metrics } = useDashboard();
  const crm = useCrm();
  const row = useMemo(() => metrics?.subscriberList.find((r) => r.id === crm.openId) ?? null, [metrics, crm.openId]);
  const [note, setNote] = useState("");
  const [tagText, setTagText] = useState("");

  useEffect(() => { setNote(""); setTagText(""); }, [crm.openId]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") crm.open(null); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [crm]);

  if (!row || !metrics) return null;
  const contact = crm.contacts.get(row.id);
  const { stage, manual } = crm.stageOf(row);
  const notes = crm.notesFor(row.id);
  const tags = contact?.tags ?? [];
  const u = row.usage;

  const summary = () =>
    [
      `# ${row.fullName ?? row.email} (${row.email})`,
      `Company: ${row.companyNames.join(", ") || "none"} · Plan: ${row.plan ?? "none"} (${row.status ?? "no subscription"}) · Stage: ${stage}${manual ? " (manual)" : ""}`,
      `Joined ${d10(row.joinedAt)} via ${row.leadSource}${row.signupCampaign ? ` / campaign ${row.signupCampaign}` : ""}${row.signupContent ? ` / ${row.signupContent}` : ""}`,
      `Last login: ${row.lastLoginAt ? d10(row.lastLoginAt) : "never"} · logins: ${row.loginCount ?? "n/a"}`,
      row.atRisk ? `AT RISK: ${row.atRiskReason}` : row.inactiveFree ? `Inactive free: ${row.inactiveFreeReason}` : "",
      u ? `Usage: ${u.invoices} invoices (${u.invoicesSent} sent, ${u.invoicesPaid} paid, ${money(u.invoicedTotal)} invoiced), ${u.clients} clients, ${u.timeEntries} time entries, ${u.expenses} expenses, ${u.bankStatements} bank statements` : "Usage: not available (run sql/crm_data.sql)",
      `Products: ${row.productCount} · Projects: ${row.projectCount}`,
      row.helcimStatus ? `Helcim: ${row.helcimStatus}, ${money(row.helcimMonthly ?? 0)}/mo, next billing ${d10(row.helcimNextBilling)}${row.helcimFailed ? ", FAILED PAYMENT" : ""}` : "",
      "", "## Timeline", ...timeline(row, notes).map((e) => `- ${d10(e.at)}: ${e.text}`),
    ].filter((l) => l !== "").join("\n");

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Subscriber detail">
      <div className="absolute inset-0 bg-black/40" onClick={() => crm.open(null)} />
      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-bg p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{row.fullName || row.email || "Unnamed"}</h2>
            <p className="truncate text-sm text-muted">{row.email}{row.companyNames[0] ? ` · ${row.companyNames.join(", ")}` : ""}</p>
          </div>
          <button onClick={() => crm.open(null)} aria-label="Close" className="rounded-lg border border-border p-1.5 text-muted hover:text-text"><X size={16} /></button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <OutreachMenu row={row} />
          <CopyButton label="Copy for AI" getText={summary} />
          {row.activated !== null && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.activated ? "bg-success/10 text-success" : "bg-surface-2 text-muted"}`} title="Activated = created an invoice, tracked an expense or uploaded a bank statement">
              {row.activated ? `Activated · ${row.coreActions.join(", ")}` : "Not activated"}
            </span>
          )}
          {row.atRisk && <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning" title={row.atRiskReason ?? ""}>At risk</span>}
          {row.inactiveFree && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted" title={row.inactiveFreeReason ?? ""}>Inactive free</span>}
        </div>

        {!crm.durable && <p className="mt-3 rounded-lg border border-dashed border-border p-2 text-xs text-muted">CRM notes are saved to a local file. Run <code>sql/admin_tables.sql</code> in Supabase to keep them permanently.</p>}
        {crm.error && <p className="mt-3 text-xs text-danger">{crm.error}</p>}

        <section className="mt-5 grid grid-cols-2 gap-3">
          <label className="text-xs text-muted">Pipeline stage {!manual && <span>(auto)</span>}
            <select value={manual ? stage : ""} onChange={(e) => crm.saveContact(row.id, { stage: e.target.value || null })} className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text">
              <option value="">Auto — {CRM_STAGES.find((s) => s.id === stage)?.label}</option>
              {CRM_STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">Follow up on
            <input type="date" value={contact?.followUpOn ?? ""} onChange={(e) => crm.saveContact(row.id, { followUpOn: e.target.value || null })} className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text" />
          </label>
        </section>

        <section className="mt-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
                {t}
                <button aria-label={`Remove tag ${t}`} onClick={() => crm.saveContact(row.id, { tags: tags.filter((x) => x !== t) })}><X size={10} /></button>
              </span>
            ))}
            <input
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && tagText.trim()) { crm.saveContact(row.id, { tags: [...tags, tagText] }); setTagText(""); } }}
              placeholder="add tag + Enter"
              className="w-32 rounded-lg border border-border bg-surface px-2 py-1 text-xs"
            />
          </div>
        </section>

        <h3 className="mb-2 mt-6 text-sm font-medium">Product usage</h3>
        {u ? (
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Invoices" value={u.invoices} />
            <Stat label="Sent" value={u.invoicesSent} />
            <Stat label="Paid" value={u.invoicesPaid} />
            <Stat label="Invoiced" value={money(u.invoicedTotal)} />
            <Stat label="Clients" value={u.clients} />
            <Stat label="Time entries" value={u.timeEntries} />
            <Stat label="Expenses" value={u.expenses} />
            <Stat label="Bank statements" value={u.bankStatements} />
            <Stat label="Recurring" value={u.recurringInvoices + u.recurringExpenses} />
            <Stat label="Products" value={row.productCount} />
            <Stat label="Projects" value={row.projectCount} />
            <Stat label="Proposals" value={u.proposals} />
          </div>
        ) : (
          <p className="text-xs text-muted">Run <code>sql/crm_data.sql</code> in the Supabase SQL editor to see invoices, clients, expenses and more. Products: {row.productCount} · Projects: {row.projectCount}.</p>
        )}

        <h3 className="mb-2 mt-6 text-sm font-medium">Billing & source</h3>
        <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted">Plan</dt><dd className="capitalize">{row.plan ?? "—"} · {row.status ?? "no subscription"}</dd>
          <dt className="text-muted">Renews</dt><dd>{d10(row.renewsAt) || "—"}{row.renewalOverdueDays !== null && <span className="ml-1.5 text-warning">({row.renewalOverdueDays}d overdue)</span>}</dd>
          {metrics.helcim.configured && (<><dt className="text-muted">Helcim</dt><dd>{row.helcimStatus ? `${row.helcimStatus} · ${money(row.helcimMonthly ?? 0)}/mo · next ${d10(row.helcimNextBilling) || "—"}${row.helcimFailed ? " · FAILED PAYMENT" : ""}` : "no matching subscription"}</dd></>)}
          <dt className="text-muted">Lead source</dt><dd>{row.leadSource}</dd>
          <dt className="text-muted">Campaign</dt><dd>{row.signupCampaign ?? "—"}{row.signupContent ? ` / ${row.signupContent}` : ""}</dd>
          <dt className="text-muted">Referrer</dt><dd className="truncate">{row.signupReferrer ?? "—"}</dd>
          <dt className="text-muted">Logins</dt><dd>{row.loginCount ?? "—"} · last {row.lastLoginAt ? d10(row.lastLoginAt) : "never"}</dd>
          <dt className="text-muted">Province / HST</dt><dd>{row.province ?? "—"} · {row.hstRegistered === null ? "?" : row.hstRegistered ? "HST registered" : "not registered"}</dd>
        </dl>

        <h3 className="mb-2 mt-6 text-sm font-medium">Notes</h3>
        <div className="flex gap-2">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Log a call, a reply, an idea…" className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
          <button disabled={!note.trim()} onClick={() => { crm.addNote(row.id, note); setNote(""); }} className="self-end rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-40">Add</button>
        </div>

        <h3 className="mb-2 mt-6 text-sm font-medium">Timeline</h3>
        <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
          {timeline(row, notes).map((e, i) => (
            <li key={i} className="relative text-sm">
              <span className={`absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full ${e.tone === "bad" ? "bg-danger" : e.tone === "good" ? "bg-success" : e.tone === "note" ? "bg-accent" : "bg-muted"}`} />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-muted">{d10(e.at)}</div>
                  <div className={e.tone === "note" ? "whitespace-pre-wrap rounded-lg bg-surface-2 px-2.5 py-1.5" : ""}>{e.text}</div>
                </div>
                {e.noteId && <button aria-label="Delete note" onClick={() => crm.deleteNote(e.noteId!)} className="mt-1 text-muted hover:text-danger"><Trash2 size={13} /></button>}
              </div>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
