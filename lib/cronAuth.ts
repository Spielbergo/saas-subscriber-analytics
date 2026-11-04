import "server-only";
import { timingSafeEqual } from "node:crypto";

/** CRON_SECRET via `Authorization: Bearer …` (Vercel Cron) or `?secret=` (cron-job.org / UptimeRobot). */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? new URL(request.url).searchParams.get("secret") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
