import "server-only";
import { kvGet, kvSet } from "./adminStore";
import type { NotificationLogItem } from "./adminTypes";

export function channelsConfigured() {
  return {
    slack: !!process.env.SLACK_WEBHOOK_URL,
    email: !!(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_TO && process.env.ALERT_EMAIL_FROM),
  };
}

export async function listNotifications(): Promise<NotificationLogItem[]> {
  return kvGet<NotificationLogItem[]>("notifications_log", []);
}

type Msg = { kind: NotificationLogItem["kind"]; severity: NotificationLogItem["severity"]; title: string; body: string; html?: string; subject?: string };

async function slack(text: string): Promise<string | null> {
  try {
    const res = await fetch(process.env.SLACK_WEBHOOK_URL!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10_000) });
    return res.ok ? null : `Slack ${res.status}`;
  } catch (e) { return e instanceof Error ? e.message : "Slack failed"; }
}

async function email(subject: string, text: string, html?: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: process.env.ALERT_EMAIL_FROM, to: process.env.ALERT_EMAIL_TO!.split(",").map((s) => s.trim()), subject, text, html }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? null : `Resend ${res.status}: ${(await res.text()).slice(0, 120)}`;
  } catch (e) { return e instanceof Error ? e.message : "Email failed"; }
}

/** Send to every configured channel and record it in the log (always — even with no channel). */
export async function notify(m: Msg): Promise<NotificationLogItem> {
  const ch = channelsConfigured();
  const channels: string[] = [];
  const errors: string[] = [];
  const slackText = m.kind === "digest" ? m.body : `*${m.title}*\n${m.body}`;
  if (ch.slack) { const e = await slack(slackText); e ? errors.push(e) : channels.push("slack"); }
  if (ch.email) { const e = await email(m.subject ?? m.title.replace(/[*_]/g, ""), `${m.title}\n\n${m.body}`, m.html); e ? errors.push(e) : channels.push("email"); }
  const item: NotificationLogItem = { at: new Date().toISOString(), kind: m.kind, severity: m.severity, title: m.title, body: m.body.slice(0, 1500), channels, error: errors.length ? errors.join("; ") : !ch.slack && !ch.email ? "No channel configured — logged only" : null };
  const log = await kvGet<NotificationLogItem[]>("notifications_log", []);
  await kvSet("notifications_log", [item, ...log].slice(0, 60));
  return item;
}
