"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown } from "lucide-react";
import { approxTokens, copyText, downloadText } from "@/lib/clipboard";
import { buildIssuesReport } from "@/lib/seo/aiReport";
import { buildSeoMarkdown } from "@/lib/exportReport";
import type { SeoBundle } from "@/lib/seo/types";

export function AiCopyMenu({ bundle }: { bundle: SeoBundle }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  async function run(kind: "problems" | "all-issues" | "full" | "download") {
    let text: string;
    if (kind === "problems") text = buildIssuesReport(bundle, { severities: ["error", "warning"] });
    else if (kind === "all-issues") text = buildIssuesReport(bundle, { maxUrlsPerIssue: 40 });
    else text = `# SEO report for ${bundle.siteUrl ?? "site"}\n\n${buildSeoMarkdown(bundle)}`;

    if (kind === "download") {
      downloadText(`seo-report-${new Date().toISOString().slice(0, 10)}.md`, text);
      setNote("Downloaded");
    } else {
      const ok = await copyText(text);
      setNote(ok ? `Copied (~${approxTokens(text).toLocaleString()} tokens)` : "Copy failed");
    }
    setOpen(false);
    setTimeout(() => setNote(null), 3500);
  }

  const Item = ({ onClick, title, sub }: { onClick: () => void; title: string; sub: string }) => (
    <button onClick={onClick} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2">
      {title}
      <span className="block text-xs text-muted">{sub}</span>
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs transition-colors hover:bg-surface-2"
      >
        {note ? <Check size={12} className="text-success" /> : <Bot size={12} />}
        {note ?? "Copy for AI"}
        {!note && <ChevronDown size={11} className="text-muted" />}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-border bg-surface p-2 shadow-lg">
          <Item
            onClick={() => run("problems")}
            title="Errors & warnings (with AI prompt)"
            sub="Each issue with affected URLs and evidence, plus index and speed problems"
          />
          <Item
            onClick={() => run("all-issues")}
            title="All issues incl. notices"
            sub="Same, with the low-priority notices too"
          />
          <Item
            onClick={() => run("full")}
            title="Full SEO report"
            sub="Everything on this tab: audit, opportunities, rankings, indexing, speed, backlinks"
          />
          <Item onClick={() => run("download")} title="Download full report (.md)" sub="For very large reports" />
        </div>
      )}
    </div>
  );
}
