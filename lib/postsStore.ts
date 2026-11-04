import "server-only";
import { sb, tryTable } from "./adminStore";
import { readCache, writeCache } from "./seo/store";
import type { Post } from "./adminTypes";

const FILE = "posts.json";
type Row = { id: string; posted_on: string; platform: string | null; title: string | null; url: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null; notes: string | null };

const fromRow = (r: Row): Post => ({ id: String(r.id), postedOn: r.posted_on, platform: r.platform, title: r.title, url: r.url, utmSource: r.utm_source, utmMedium: r.utm_medium, utmCampaign: r.utm_campaign, utmContent: r.utm_content, notes: r.notes });

export async function listPosts(): Promise<{ posts: Post[]; durable: boolean }> {
  const r = await tryTable("admin_posts", () => sb().from("admin_posts").select("*").order("posted_on", { ascending: false }).limit(500));
  if (r.ok) return { posts: ((r.data ?? []) as Row[]).map(fromRow), durable: true };
  return { posts: readCache<Post[]>(FILE, []), durable: false };
}

export async function addPost(p: Omit<Post, "id">): Promise<void> {
  const r = await tryTable("admin_posts", () =>
    sb().from("admin_posts").insert({ posted_on: p.postedOn, platform: p.platform, title: p.title, url: p.url, utm_source: p.utmSource, utm_medium: p.utmMedium, utm_campaign: p.utmCampaign, utm_content: p.utmContent, notes: p.notes }).select("id")
  );
  if (r.ok) return;
  const all = readCache<Post[]>(FILE, []);
  all.unshift({ ...p, id: `${Date.now()}` });
  writeCache(FILE, all);
}

export async function deletePost(id: string): Promise<void> {
  const r = await tryTable("admin_posts", () => sb().from("admin_posts").delete().eq("id", id).select("id"));
  if (r.ok) return;
  writeCache(FILE, readCache<Post[]>(FILE, []).filter((p) => p.id !== id));
}
