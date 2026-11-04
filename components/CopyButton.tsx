"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/lib/clipboard";

/** Small "copy to clipboard" button with a brief confirmation. */
export function CopyButton({
  getText,
  label = "Copy",
  title,
  iconOnly = false,
  className = "",
}: {
  getText: () => string;
  label?: ReactNode;
  title?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");

  async function go(e: React.MouseEvent) {
    e.stopPropagation(); // don't trigger row clicks
    const ok = await copyText(getText());
    setState(ok ? "ok" : "fail");
    setTimeout(() => setState("idle"), 1800);
  }

  return (
    <button
      onClick={go}
      title={title ?? "Copy to clipboard"}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-text ${className}`}
    >
      {state === "ok" ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      {!iconOnly && (state === "ok" ? "Copied" : state === "fail" ? "Copy failed" : label)}
    </button>
  );
}
