"use client";

import { MarketingSection } from "@/components/MarketingSection";
import { useDashboard } from "@/lib/DashboardContext";

export default function MarketingPage() {
  const { marketing, marketingError } = useDashboard();
  return <MarketingSection marketing={marketing} error={marketingError} />;
}
