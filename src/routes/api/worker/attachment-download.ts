import { createFileRoute } from "@tanstack/react-router";

import { requireAuthenticatedRole } from "@/lib/api-auth";
import { isValidWorkerAttachmentPath } from "@/lib/worker-attachments";
import { createSignedWorkerAttachmentDownloadUrl } from "@/lib/worker-attachment-storage";

export const Route = createFileRoute("/api/worker/attachment-download")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireAuthenticatedRole(request, ["worker", "manager"]);
        if (!auth.ok) {
          return auth.response;
        }

        try {
          const url = new URL(request.url);
          const storagePath = url.searchParams.get("storagePath")?.trim() ?? "";

          if (!storagePath.startsWith("attachments/")) {
            return new Response(JSON.stringify({ error: "Invalid attachment path." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const pathEmployeeId = storagePath.split("/")[1] ?? "";
          if (auth.role === "worker" && pathEmployeeId !== auth.userId) {
            return new Response(JSON.stringify({ error: "Forbidden" }), {
              status: 403,
              headers: { "Content-Type": "application/json" },
            });
          }

          if (auth.role === "worker" && !isValidWorkerAttachmentPath(storagePath, auth.userId)) {
            return new Response(JSON.stringify({ error: "Invalid attachment path." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const signedUrl = await createSignedWorkerAttachmentDownloadUrl(storagePath);

          return new Response(JSON.stringify({ signedUrl }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to create download URL.";
          console.error("[api/worker/attachment-download] failed:", error);

          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
