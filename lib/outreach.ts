// Client-safe outreach templates. Nothing is sent from here — buttons open
// the user's own mail client via mailto: with the text prefilled.
import type { SubscriberRow } from "./metrics";

export type Template = { id: string; label: string; subject: string; body: string; hint: string };

export const TEMPLATES: Template[] = [
  {
    id: "onboarding",
    label: "Help getting started",
    hint: "Signed up but never created a company",
    subject: "Need a hand getting set up on NorthBooks?",
    body: "Hi {firstName},\n\nI noticed you signed up for NorthBooks but haven't finished setting up your business yet. Is there anything confusing, or anything you were hoping it would do that it didn't?\n\nIf it helps, reply with what you're trying to get done and I'll point you to the quickest way — happy to hop on a short call too.\n\n{sender}",
  },
  {
    id: "checkin",
    label: "Check-in (at risk)",
    hint: "Paying, but gone quiet",
    subject: "How is NorthBooks working for you?",
    body: "Hi {firstName},\n\nThanks for being a NorthBooks subscriber. I noticed you haven't been in for a little while, and I'd love to know if something's getting in the way — a missing feature, something confusing, or just a busy season.\n\nAny feedback at all helps me make it better, and if there's something I can fix for you, I will.\n\n{sender}",
  },
  {
    id: "nudge",
    label: "Nudge (inactive free)",
    hint: "Free user who stopped logging in",
    subject: "Still need help with your books?",
    body: "Hi {firstName},\n\nIt's been a while since you last logged into NorthBooks. If you ran into a snag or it wasn't quite what you needed, I'd really appreciate hearing what — it directly shapes what I build next.\n\nIf you're still looking for a simple way to handle invoices, expenses and HST, your account is waiting.\n\n{sender}",
  },
  {
    id: "firstinvoice",
    label: "First invoice nudge",
    hint: "Set up, but hasn't invoiced yet",
    subject: "Ready to send your first invoice?",
    body: "Hi {firstName},\n\nYou've got your business set up in NorthBooks — nice. The next step is usually the most useful one: creating your first invoice. It takes a couple of minutes, and I'm glad to walk you through it if you'd like.\n\n{sender}",
  },
  {
    id: "payment",
    label: "Payment issue",
    hint: "Failed or overdue billing",
    subject: "A quick note about your NorthBooks payment",
    body: "Hi {firstName},\n\nIt looks like your most recent NorthBooks payment didn't go through — this usually just means a card expired or was replaced. Could you check your payment details when you get a chance? If you'd rather sort it out together, just reply and I'll help.\n\n{sender}",
  },
  {
    id: "feedback",
    label: "Ask for feedback",
    hint: "Happy, active customers",
    subject: "Quick question about NorthBooks",
    body: "Hi {firstName},\n\nYou've been getting good use out of NorthBooks, and I'd love your take: what's the one thing that would make it noticeably better for you? Even a one-line reply helps a lot.\n\nThank you for being an early user.\n\n{sender}",
  },
  {
    id: "winback",
    label: "Win-back (churned)",
    hint: "Cancelled subscribers",
    subject: "Sorry to see you go — anything I could have done better?",
    body: "Hi {firstName},\n\nI saw your NorthBooks subscription ended. No hard feelings at all — I'd just really like to know what didn't work, so I can fix it. A sentence or two is plenty.\n\nIf things change, you're always welcome back.\n\n{sender}",
  },
];

/** The most fitting template for this person's situation. */
export function suggestTemplate(r: SubscriberRow): Template {
  const by = (id: string) => TEMPLATES.find((t) => t.id === id)!;
  if (r.helcimFailed || (r.renewalOverdueDays !== null && r.isPaid)) return by("payment");
  if (r.status === "canceled") return by("winback");
  if (r.atRisk) return by("checkin");
  if (r.inactiveFree) return r.activationStage === "not_started" ? by("onboarding") : by("nudge");
  if (r.activationStage === "not_started") return by("onboarding");
  if (r.activationStage === "set_up" || r.activationStage === "building") return by("firstinvoice");
  return by("feedback");
}

export function firstName(r: SubscriberRow): string {
  const n = (r.fullName ?? "").trim().split(/\s+/)[0];
  return n || "there";
}

export function fillTemplate(t: Template, r: SubscriberRow, sender: string): { subject: string; body: string } {
  const sub = (s: string) => s.replace(/\{firstName\}/g, firstName(r)).replace(/\{sender\}/g, sender);
  return { subject: sub(t.subject), body: sub(t.body) };
}

export function mailtoUrl(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
