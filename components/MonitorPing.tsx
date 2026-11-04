"use client";

import { useEffect } from "react";
import { seoFetch } from "@/lib/seoClient";

/** While the dashboard is open, trigger an uptime check every 10 min (server throttles to 5). */
export function MonitorPing() {
  useEffect(() => {
    const ping = () => { if (!document.hidden) seoFetch("/api/monitor", { method: "POST", body: JSON.stringify({ action: "run" }) }).catch(() => {}); };
    const first = setTimeout(ping, 15_000);
    const t = setInterval(ping, 10 * 60_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);
  return null;
}
