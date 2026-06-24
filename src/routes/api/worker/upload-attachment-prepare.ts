import { createFileRoute } from "@tanstack/react-router";

import { requireWorkerRequest } from "@/lib/api-auth";
import {
  MAX_WORKER_PDF_BYTES,
  sanitizeWorkerPdfFilename,
} from "@/lib/worker-attachments";
import {
  buildWorkerAttachmentStoragePath,
  createSignedWorkerAttachmentUploadUrl,
} from "@/lib/worker-attachment-storage";

type PrepareUploadBody = {
  fileName?: string;
  fileSize?: number;
};

export const Route = createFileRoute("/api/worker/upload-attachment-prepare")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireWorkerRequest(request);
        if (!auth.ok) {
          return auth.response;
        }

        try {
          const body = (await request.json().catch(() => null)) as PrepareUploadBody | null;
          const fileName = sanitizeWorkerPdfFilename(body?.fileName ?? "document.pdf");
          const fileSize = Number(body?.fileSize ?? 0);

          if (!Number.isFinite(fileSize) || fileSize <= 0) {
            return new Response(JSON.stringify({ error: "Invalid PDF file size." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          if (fileSize > MAX_WORKER_PDF_BYTES) {
            return new Response(JSON.stringify({ error: "PDF is too large. Maximum allowed size is 20 MB." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const storagePath = buildWorkerAttachmentStoragePath(auth.userId, fileName);
          const signedUpload = await createSignedWorkerAttachmentUploadUrl(storagePath);

          return new Response(
            JSON.stringify({
              fileName,
              storagePath,
              signedUploadUrl: signedUpload.signedUrl,
              token: signedUpload.token,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to prepare attachment upload.";
          console.error("[api/worker/upload-attachment-prepare] failed:", error);

          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
