// Pure: the pipeline stage inferred from data (no manual override).
import type { SubscriberRow } from "./metrics";
import type { CrmStage } from "./adminTypes";

export function derivedStageOf(r: SubscriberRow): CrmStage {
  if (r.status === "canceled") return "churned";
  if (r.atRisk) return "at_risk";
  if (r.isPaid && r.status === "trialing") return "trial";
  if (r.isPaid) return "customer";
  return "lead";
}
