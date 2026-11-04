"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { seoFetch } from "@/lib/seoClient";
import { CRM_STAGES, type CrmContact, type CrmData, type CrmNote, type CrmStage } from "@/lib/adminTypes";
import type { SubscriberRow } from "@/lib/metrics";

export { derivedStageOf as derivedStage } from "@/lib/crmStage";
import { derivedStageOf } from "@/lib/crmStage";

type Ctx = {
  ready: boolean;
  durable: boolean;
  senderName: string;
  siteUrl: string | null;
  contacts: Map<string, CrmContact>;
  notesFor: (userId: string) => CrmNote[];
  stageOf: (r: SubscriberRow) => { stage: CrmStage; manual: boolean };
  saveContact: (userId: string, patch: { stage?: string | null; tags?: string[]; followUpOn?: string | null }) => Promise<void>;
  addNote: (userId: string, body: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  openId: string | null;
  open: (userId: string | null) => void;
  error: string | null;
};

const CrmCtx = createContext<Ctx | null>(null);

export function CrmProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<CrmData | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await seoFetch<CrmData>("/api/crm"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load CRM data");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const contacts = useMemo(() => new Map((data?.contacts ?? []).map((c) => [c.userId, c])), [data]);
  const notes = data?.notes ?? [];

  const post = useCallback(async (body: unknown) => {
    try {
      await seoFetch("/api/crm", { method: "POST", body: JSON.stringify(body) });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
  }, [load]);

  const value: Ctx = {
    ready: data !== null,
    durable: data?.durable ?? true,
    senderName: data?.senderName ?? "Scott",
    siteUrl: data?.siteUrl ?? null,
    contacts,
    notesFor: (id) => notes.filter((n) => n.userId === id),
    stageOf: (r) => {
      const manual = contacts.get(r.id)?.stage as CrmStage | null | undefined;
      return manual && CRM_STAGES.some((s) => s.id === manual) ? { stage: manual, manual: true } : { stage: derivedStageOf(r), manual: false };
    },
    saveContact: (userId, patch) => post({ action: "contact", userId, ...patch }),
    addNote: (userId, body) => post({ action: "addNote", userId, body }),
    deleteNote: (id) => post({ action: "deleteNote", id }),
    openId,
    open: setOpenId,
    error,
  };
  return <CrmCtx.Provider value={value}>{children}</CrmCtx.Provider>;
}

export function useCrm() {
  const c = useContext(CrmCtx);
  if (!c) throw new Error("useCrm must be used within CrmProvider");
  return c;
}
