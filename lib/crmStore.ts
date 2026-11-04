import "server-only";
import { sb, tryTable } from "./adminStore";
import { readCache, writeCache } from "./seo/store";
import type { CrmContact, CrmNote } from "./adminTypes";

const FILE = "crm.json";
type Local = { contacts: CrmContact[]; notes: CrmNote[] };
type ContactRow = { user_id: string; stage: string | null; tags: string[] | null; follow_up_on: string | null };
type NoteRow = { id: string; user_id: string; body: string; created_at: string };

export async function listCrm(): Promise<{ contacts: CrmContact[]; notes: CrmNote[]; durable: boolean }> {
  const [c, n] = await Promise.all([
    tryTable("admin_crm_contacts", () => sb().from("admin_crm_contacts").select("user_id,stage,tags,follow_up_on")),
    tryTable("admin_crm_notes", () => sb().from("admin_crm_notes").select("id,user_id,body,created_at").order("created_at", { ascending: false }).limit(2000)),
  ]);
  if (c.ok && n.ok) {
    return {
      durable: true,
      contacts: ((c.data ?? []) as ContactRow[]).map((r) => ({ userId: r.user_id, stage: r.stage, tags: r.tags ?? [], followUpOn: r.follow_up_on })),
      notes: ((n.data ?? []) as NoteRow[]).map((r) => ({ id: String(r.id), userId: r.user_id, body: r.body, createdAt: r.created_at })),
    };
  }
  const local = readCache<Local>(FILE, { contacts: [], notes: [] });
  return { ...local, durable: false };
}

export async function saveContact(userId: string, patch: { stage?: string | null; tags?: string[]; followUpOn?: string | null }): Promise<void> {
  const { contacts } = await listCrm();
  const cur = contacts.find((x) => x.userId === userId) ?? { userId, stage: null, tags: [], followUpOn: null };
  const next: CrmContact = {
    userId,
    stage: patch.stage !== undefined ? patch.stage : cur.stage,
    tags: patch.tags !== undefined ? [...new Set(patch.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20) : cur.tags,
    followUpOn: patch.followUpOn !== undefined ? patch.followUpOn : cur.followUpOn,
  };
  const r = await tryTable("admin_crm_contacts", () =>
    sb().from("admin_crm_contacts").upsert({ user_id: userId, stage: next.stage, tags: next.tags, follow_up_on: next.followUpOn, updated_at: new Date().toISOString() }).select("user_id")
  );
  if (r.ok) return;
  const local = readCache<Local>(FILE, { contacts: [], notes: [] });
  local.contacts = [...local.contacts.filter((x) => x.userId !== userId), next];
  writeCache(FILE, local);
}

export async function addNote(userId: string, body: string): Promise<void> {
  const r = await tryTable("admin_crm_notes", () => sb().from("admin_crm_notes").insert({ user_id: userId, body }).select("id"));
  if (r.ok) return;
  const local = readCache<Local>(FILE, { contacts: [], notes: [] });
  local.notes.unshift({ id: `${Date.now()}`, userId, body, createdAt: new Date().toISOString() });
  writeCache(FILE, local);
}

export async function removeNote(id: string): Promise<void> {
  const r = await tryTable("admin_crm_notes", () => sb().from("admin_crm_notes").delete().eq("id", id).select("id"));
  if (r.ok) return;
  const local = readCache<Local>(FILE, { contacts: [], notes: [] });
  local.notes = local.notes.filter((n) => n.id !== id);
  writeCache(FILE, local);
}
