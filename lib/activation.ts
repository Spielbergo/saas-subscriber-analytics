// The one place that defines "activated". Pure and client-safe.
import type { UsageRow } from "./metrics";

export const ACTIVATION_RULE =
  "Activated = the user has done at least one core bookkeeping task: created an invoice, tracked an expense, or uploaded a bank statement (which brings in transactions). Creating a company, products or projects alone is setup, not activation.";

/** Which core tasks this user has completed (empty = not activated). */
export function coreActions(u: UsageRow | null): string[] {
  if (!u) return [];
  const a: string[] = [];
  if (u.invoices > 0) a.push("invoice");
  if (u.expenses > 0) a.push("expense");
  if (u.bankStatements > 0) a.push("bank statement");
  return a;
}
