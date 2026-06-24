import { createFileRoute } from "@tanstack/react-router";

import { requireManagerRequest } from "@/lib/api-auth";
import { fetchMonthlyUsageFromLangfuse } from "@/lib/langfuse-metrics";

export const Route = createFileRoute("/api/analytics/usage")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireManagerRequest(request);
        if (!auth.ok) {
          return auth.response;
        }

        try {
          const url = new URL(request.url);
          const months = Number(url.searchParams.get("months") ?? "12");
          const summary = await fetchMonthlyUsageFromLangfuse({ months });

          return new Response(JSON.stringify(summary), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "private, max-age=60",
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load Langfuse analytics.";
          const isConfigError = message.includes("credentials are not configured");
          const isTimeout = error instanceof Error && error.name === "TimeoutError";

          return new Response(JSON.stringify({ error: message }), {
            status: isConfigError ? 503 : isTimeout ? 504 : 502,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
