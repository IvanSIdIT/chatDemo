import { createFileRoute } from "@tanstack/react-router";

import { requireWorkerRequest } from "@/lib/api-auth";
import { saveEmployeeMessage } from "@/lib/chat-persistence";
import {
  formatWorkerPdfMessage,
  isValidWorkerAttachmentPath,
  sanitizeWorkerPdfFilename,
} from "@/lib/worker-attachments";
import { createSupabaseServerClient, getAccessTokenFromRequest } from "@/lib/supabase-server";

export const Route = createFileRoute("/api/worker/upload-attachment")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireWorkerRequest(request);
        if (!auth.ok) {
          return auth.response;
        }

        try {
          const body = (await request.json().catch(() => null)) as {
            storagePath?: string;
            fileName?: string;
          } | null;

          const storagePath = body?.storagePath?.trim() ?? "";
          const fileName = sanitizeWorkerPdfFilename(body?.fileName ?? "document.pdf");

          if (!isValidWorkerAttachmentPath(storagePath, auth.userId)) {
            return new Response(JSON.stringify({ error: "Invalid attachment storage path." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const accessToken = getAccessTokenFromRequest(request);
          if (!accessToken) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          const supabase = createSupabaseServerClient(accessToken);
          const message = await saveEmployeeMessage(
            supabase,
            formatWorkerPdfMessage({ fileName, storagePath }),
            "pending",
          );

          if (!message) {
            return new Response(JSON.stringify({ error: "Failed to save attachment message." }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ message }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to send PDF attachment.";
          console.error("[api/worker/upload-attachment] failed:", error);

          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
