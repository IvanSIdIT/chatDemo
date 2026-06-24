import type { MonthlyUsageSummary } from "@/lib/langfuse-metrics";
import { supabase } from "@/lib/supabase";

export type { MonthlyUsagePoint, MonthlyUsageSummary } from "@/lib/langfuse-metrics";

async function getAuthHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("You must be signed in as a manager to view analytics.");
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchMonthlyUsageAnalytics(months = 12): Promise<MonthlyUsageSummary> {
  const headers = await getAuthHeaders();
  const response = await fetch(`/api/analytics/usage?months=${months}`, {
    headers,
  });

  const payload = (await response.json()) as MonthlyUsageSummary | { error?: string };

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload && payload.error
        ? payload.error
        : `Failed to load analytics (${response.status}).`;
    throw new Error(message);
  }

  return payload as MonthlyUsageSummary;
}
