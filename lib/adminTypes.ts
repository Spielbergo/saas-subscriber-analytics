// Client-safe types for the admin data layer (snapshots, Helcim, CRM…).

export type SnapshotSubscriber = {
  id: string; // user id
  plan: string | null;
  status: string | null;
  mrr: number; // monthly value counted for this user at snapshot time
};

export type SnapshotData = {
  users: number;
  paid: number;
  free: number;
  mrr: number;
  mrrSource: "helcim" | "estimate";
  estimatedMrr: number;
  byPlan: Record<string, number>;
  byStatus: Record<string, number>;
  signups7: number;
  signups30: number;
  cancellations30: number;
  atRisk: number;
  inactiveFree: number;
  notStarted: number;
  setUp: number;
  building: number;
  activated?: number | null; // did a core task; null = usage data unavailable
  companies: number;
  products: number;
  projects: number;
  neverLoggedIn: number;
  overdueRenewals: number;
  trialConversionRate: number;
  helcim: { active: number; failed: number; paused: number; mrr: number } | null;
  ga: { sessions: number; users: number; newUsers: number; keyEvents: number; engagementRate: number } | null;
  sc: { clicks: number; impressions: number; ctr: number; position: number } | null;
  seo: { score: number; errors: number; warnings: number; notices: number; pages: number } | null;
  backlinks: number | null;
  subscribers: SnapshotSubscriber[];
};

export type Snapshot = { day: string; data: SnapshotData };
export type Annotation = { id: string; day: string; label: string };

// ---------- Helcim ----------

export type HelcimSubscription = {
  id: number | string;
  customerCode: string | null;
  customerEmail: string | null;
  customerName: string | null;
  paymentPlanId: number | string | null;
  planName: string | null;
  status: string; // active | paused | cancelled | term_ending | term_ended
  recurringAmount: number;
  monthlyAmount: number; // normalised to a month using the plan's billing period
  billingPeriod: string | null;
  dateActivated: string | null;
  dateBilling: string | null;
  timesBilled: number;
  hasFailedPayments: boolean;
  matchedUserId: string | null;
  matchedBy: "customerCode" | "email" | null;
};

export type HelcimTransaction = {
  id: string;
  date: string;
  amount: number;
  type: string; // purchase | refund | …
  status: string; // approved | declined | …
  customerCode: string | null;
  currency: string | null;
  cardType: string | null;
};

export type HelcimMonth = {
  month: string; // YYYY-MM
  gross: number;
  refunds: number;
  net: number;
  approved: number;
  declined: number;
};

export type HelcimSummary = {
  configured: boolean;
  fetchedAt: string | null;
  error: string | null;
  warnings: string[];
  subscriptions: HelcimSubscription[];
  byStatus: Record<string, number>;
  activeCount: number;
  mrr: number; // actual recurring revenue from active subscriptions
  failedPaymentCount: number;
  pausedCount: number;
  overdueCount: number;
  upcoming7d: { count: number; amount: number };
  plans: { id: number | string; name: string; amount: number; period: string | null }[];
  months: HelcimMonth[];
  last30: { gross: number; refunds: number; net: number; approved: number; declined: number };
  recentDeclines: HelcimTransaction[];
  unmatchedActive: number;
};

export type ReconKind =
  | "no_helcim_subscription" // Supabase says paid, nothing found in Helcim
  | "status_mismatch" // statuses disagree
  | "failed_payment" // Helcim reports failed payments
  | "billing_overdue" // next billing date passed while still active
  | "helcim_unmatched"; // active in Helcim, no matching user

export type ReconIssue = {
  kind: ReconKind;
  userId: string | null;
  email: string | null;
  name: string | null;
  supabase: { plan: string | null; status: string | null; periodEnd: string | null } | null;
  helcim: { status: string; monthly: number; nextBilling: string | null; failed: boolean } | null;
  detail: string;
};

// ---------- CRM ----------

export type CrmStage = "lead" | "trial" | "customer" | "at_risk" | "churned" | "partner" | "ignore";
export const CRM_STAGES: { id: CrmStage; label: string }[] = [
  { id: "lead", label: "Lead" },
  { id: "trial", label: "Trial" },
  { id: "customer", label: "Customer" },
  { id: "at_risk", label: "At risk" },
  { id: "churned", label: "Churned" },
  { id: "partner", label: "Partner / friend" },
  { id: "ignore", label: "Ignore" },
];

export type CrmContact = { userId: string; stage: string | null; tags: string[]; followUpOn: string | null };
export type CrmNote = { id: string; userId: string; body: string; createdAt: string };

// ---------- Growth: posts & mentions ----------

export type Post = {
  id: string;
  postedOn: string; // YYYY-MM-DD
  platform: string | null;
  title: string | null;
  url: string | null; // the tagged link
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  notes: string | null;
};

export type Mention = {
  id: string;
  source: "hackernews" | "reddit" | "alerts";
  title: string;
  url: string;
  author: string | null;
  date: string; // ISO
  snippet: string | null;
  context: string | null; // subreddit / HN points / alert feed
  isNew: boolean;
};

export type MentionsResult = {
  terms: string[];
  fetchedAt: string;
  items: Mention[];
  sources: { name: string; ok: boolean; count: number; error: string | null }[];
};

export type CrmData = { contacts: CrmContact[]; notes: CrmNote[]; durable: boolean; senderName: string; siteUrl: string | null };

// ---------- Operations: monitoring & alerts ----------

export type MonitorCheck = {
  at: string;
  target: string; // URL
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  detail: string | null; // error text, redirect note…
};

export type CertInfo = {
  host: string;
  checkedAt: string;
  validTo: string | null;
  daysLeft: number | null;
  issuer: string | null;
  authorized: boolean; // chain + hostname valid
  error: string | null;
};

export type DomainInfo = {
  domain: string;
  checkedAt: string;
  expires: string | null;
  daysLeft: number | null;
  registrar: string | null;
  source: "rdap" | "manual" | null;
  error: string | null;
};

export type TargetStatus = {
  url: string;
  last: MonitorCheck | null;
  uptime24h: number | null; // 0-1
  uptime7d: number | null;
  uptime30d: number | null;
  avgLatency24h: number | null;
  checks24h: number;
  recent: { at: string; ok: boolean; latencyMs: number | null }[]; // newest last, up to 120
};

export type NotificationLogItem = {
  at: string;
  kind: "alert" | "resolved" | "digest" | "test";
  severity: "critical" | "warning" | "info";
  title: string;
  body: string;
  channels: string[]; // where it was delivered
  error: string | null;
};

export type MonitorStatus = {
  configured: boolean; // at least one URL to watch
  targets: TargetStatus[];
  certs: CertInfo[];
  domains: DomainInfo[];
  notifications: NotificationLogItem[];
  channels: { slack: boolean; email: boolean };
  thresholds: { sslDays: number; domainDays: number };
  durable: boolean;
  lastRunAt: string | null;
};
