// Date helpers shared by server and client.

const TZ_DEFAULT = "America/Toronto";

/** YYYY-MM-DD for "today" in the dashboard's timezone (DASHBOARD_TZ env, default Toronto). */
export function todayLocal(tz?: string): string {
  const zone = tz ?? (typeof process !== "undefined" ? process.env.DASHBOARD_TZ : undefined) ?? TZ_DEFAULT;
  return new Date().toLocaleDateString("en-CA", { timeZone: zone });
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}

export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export const monthOf = (day: string) => day.slice(0, 7);
