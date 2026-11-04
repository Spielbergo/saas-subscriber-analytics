"use client";

import { useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
import type { SubscriberRow } from "@/lib/metrics";
import { TEMPLATES, fillTemplate, mailtoUrl, suggestTemplate } from "@/lib/outreach";
import { copyText } from "@/lib/clipboard";
import { useCrm } from "./CrmContext";

/** "Reach out" — opens your own mail client with a prefilled message. Nothing is sent from the dashboard. */
export function OutreachMenu({ row, compact = false }: { row: SubscriberRow; compact?: boolean }) {
  const { senderName } = useCrm();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, []);
  if (!row.email) return null;
  const suggested = suggestTemplate(row);

  return (
    <div ref={ref} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={`Reach out — suggested: ${suggested.label}`}
        className={`flex items-center gap-1.5 rounded-lg border border-border bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-text ${compact ? "p-1.5" : "px-3 py-1.5 text-sm"}`}
      >
        <Mail size={compact ? 13 : 14} /> {!compact && "Reach out"}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-xl border border-border bg-surface p-1.5 shadow-lg">
          {[suggested, ...TEMPLATES.filter((t) => t.id !== suggested.id)].map((t, i) => {
            const { subject, body } = fillTemplate(t, row, senderName);
            return (
              <div key={t.id} className="flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                <a href={mailtoUrl(row.email!, subject, body)} onClick={() => setOpen(false)} className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-medium">{t.label}{i === 0 && <span className="ml-1.5 text-xs font-normal text-accent">suggested</span>}</span>
                  <span className="block truncate text-xs text-muted">{t.hint}</span>
                </a>
                <button
                  className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted hover:text-text"
                  onClick={async () => { const ok = await copyText(`Subject: ${subject}\n\n${body}`); setNote(ok ? "Copied" : "Copy failed"); setTimeout(() => setNote(null), 1500); }}
                >
                  Copy
                </button>
              </div>
            );
          })}
          {note && <p className="px-2 pb-1 text-xs text-success">{note}</p>}
        </div>
      )}
    </div>
  );
}
