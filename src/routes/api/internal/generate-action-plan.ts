import { createFileRoute } from "@tanstack/react-router";

import {
  generateIncidentActionPlan,
  verifyInternalApiSecret,
} from "@/lib/incident-action-plan";

export const Route = createFileRoute("/api/internal/generate-action-plan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!verifyInternalApiSecret(request)) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const body = (await request.json().catch(() => null)) as { messageId?: string } | null;
          const messageId = body?.messageId?.trim() ?? "";

          if (!messageId) {
            return new Response(JSON.stringify({ error: "messageId is required." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const actionPlan = await generateIncidentActionPlan(messageId);

          return new Response(JSON.stringify({ ok: true, actionPlan }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Action plan generation failed.";
          console.error("[api/internal/generate-action-plan] failed:", error);

          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
