import { NextResponse } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/adminAuth";
import { listCrm, saveContact, addNote, removeNote } from "@/lib/crmStore";
import { seoSiteUrl } from "@/lib/seo/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ ...(await listCrm()), senderName: process.env.OUTREACH_SENDER_NAME || "Scott", siteUrl: seoSiteUrl() });
  } catch (e) { return errorResponse("crm", e); }
}

const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const b = await request.json();
    switch (b.action) {
      case "contact": {
        if (!UUID.test(b.userId ?? "")) return NextResponse.json({ error: "bad userId" }, { status: 400 });
        const followUp = b.followUpOn === null || b.followUpOn === "" ? null : /^\d{4}-\d{2}-\d{2}$/.test(b.followUpOn ?? "") ? b.followUpOn : undefined;
        await saveContact(b.userId, {
          stage: b.stage === undefined ? undefined : b.stage || null,
          tags: Array.isArray(b.tags) ? b.tags.map(String) : undefined,
          followUpOn: b.followUpOn === undefined ? undefined : followUp,
        });
        break;
      }
      case "addNote": {
        const body = String(b.body ?? "").trim().slice(0, 4000);
        if (!UUID.test(b.userId ?? "") || !body) return NextResponse.json({ error: "userId and body required" }, { status: 400 });
        await addNote(b.userId, body);
        break;
      }
      case "deleteNote":
        await removeNote(String(b.id));
        break;
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return errorResponse("crm", e); }
}
