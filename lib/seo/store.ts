import fs from "node:fs";
import path from "node:path";

// Small JSON cache on disk so crawl/PageSpeed/inspection results survive
// a dev-server restart. Fine locally; on Vercel the filesystem is
// read-only/ephemeral, so writes silently no-op there and results live in
// memory until the instance recycles.
const DIR = path.join(process.cwd(), ".seo-cache");

export function readCache<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeCache(name: string, data: unknown): void {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, name), JSON.stringify(data));
  } catch {
    /* read-only filesystem — ignore */
  }
}
