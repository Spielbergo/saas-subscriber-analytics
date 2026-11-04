// Pure, client-safe maths over snapshots.
import type { Snapshot } from "./adminTypes";

export type MrrMovement = {
  day: string;
  start: number;
  new: number;
  expansion: number;
  contraction: number;
  churn: number;
  end: number;
  logosStart: number;
  logosLost: number;
};

/** Compare consecutive snapshots' per-subscriber MRR to classify movement. */
export function mrrMovements(snaps: Snapshot[]): MrrMovement[] {
  const out: MrrMovement[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const prev = new Map(snaps[i - 1].data.subscribers.map((s) => [s.id, s.mrr]));
    const cur = new Map(snaps[i].data.subscribers.map((s) => [s.id, s.mrr]));
    let nw = 0, exp = 0, con = 0, ch = 0, lost = 0, logos = 0;
    for (const [id, was] of prev) {
      if (was > 0) logos++;
      const now = cur.get(id) ?? 0;
      if (was > 0 && now === 0) { ch += was; lost++; }
      else if (was > 0 && now > was) exp += now - was;
      else if (was > 0 && now < was) con += was - now;
    }
    for (const [id, now] of cur) if (now > 0 && !((prev.get(id) ?? 0) > 0)) nw += now;
    const r = (n: number) => Math.round(n * 100) / 100;
    out.push({
      day: snaps[i].day,
      start: r([...prev.values()].reduce((a, b) => a + b, 0)),
      new: r(nw), expansion: r(exp), contraction: r(con), churn: r(ch),
      end: r([...cur.values()].reduce((a, b) => a + b, 0)),
      logosStart: logos, logosLost: lost,
    });
  }
  return out;
}

export type Kpis = {
  days: number; // days of history used
  arpu: number | null;
  monthlyLogoChurn: number | null; // 0-1
  monthlyRevenueChurn: number | null;
  ltv: number | null;
  netNewMrr30: number | null;
};

export function kpis(snaps: Snapshot[]): Kpis {
  const last = snaps[snaps.length - 1];
  const empty: Kpis = { days: snaps.length, arpu: null, monthlyLogoChurn: null, monthlyRevenueChurn: null, ltv: null, netNewMrr30: null };
  if (!last) return empty;
  const payers = last.data.subscribers.filter((s) => s.mrr > 0).length;
  const arpu = payers ? last.data.mrr / payers : null;
  if (snaps.length < 8) return { ...empty, arpu };
  const mv = mrrMovements(snaps).slice(-30);
  const span = mv.length;
  const lost = mv.reduce((n, m) => n + m.logosLost, 0);
  const churnMrr = mv.reduce((n, m) => n + m.churn, 0);
  const startLogos = mv[0].logosStart || 0;
  const startMrr = mv[0].start || 0;
  const scale = 30 / span;
  const logoChurn = startLogos ? Math.min(1, (lost * scale) / startLogos) : null;
  const revChurn = startMrr ? Math.min(1, (churnMrr * scale) / startMrr) : null;
  return {
    days: snaps.length,
    arpu,
    monthlyLogoChurn: logoChurn,
    monthlyRevenueChurn: revChurn,
    ltv: arpu !== null && logoChurn ? arpu / logoChurn : null,
    netNewMrr30: Math.round((mv[mv.length - 1].end - mv[0].start) * scale * 100) / 100,
  };
}

/** Linear projection of when MRR reaches the goal, from the last ~30 snapshots. */
export function goalProjection(snaps: Snapshot[], goal: number): { current: number; pct: number; perDay: number | null; eta: string | null } {
  const last = snaps[snaps.length - 1];
  const current = last?.data.mrr ?? 0;
  const pct = goal > 0 ? Math.min(1, current / goal) : 0;
  const win = snaps.slice(-30);
  if (win.length < 7) return { current, pct, perDay: null, eta: null };
  const d0 = new Date(win[0].day).getTime();
  const d1 = new Date(win[win.length - 1].day).getTime();
  const days = (d1 - d0) / 86_400_000;
  const perDay = days > 0 ? (win[win.length - 1].data.mrr - win[0].data.mrr) / days : null;
  let eta: string | null = null;
  if (perDay && perDay > 0 && current < goal) {
    eta = new Date(d1 + ((goal - current) / perDay) * 86_400_000).toISOString().slice(0, 10);
  }
  return { current, pct, perDay, eta };
}
