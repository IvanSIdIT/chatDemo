import { createFileRoute } from "@tanstack/react-router";

import { requireManagerRequest } from "@/lib/api-auth";
import { MAX_RAG_PDF_BYTES, sanitizePdfFilename } from "@/lib/ingest-runner";
import { buildRagStoragePath, createSignedPdfUploadUrl } from "@/lib/rag-storage";

type PrepareUploadBody = {
  fileName?: string;
  fileSize?: number;
};

export const Route = createFileRoute("/api/admin/upload-knowledge-prepare")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireManagerRequest(request);
        if (!auth.ok) {
          return auth.response;
        }

        try {
          const body = (await request.json().catch(() => null)) as PrepareUploadBody | null;
          const fileName = sanitizePdfFilename(body?.fileName ?? "document.pdf");
          const fileSize = Number(body?.fileSize ?? 0);

          if (!Number.isFinite(fileSize) || fileSize <= 0) {
            return new Response(JSON.stringify({ error: "Invalid PDF file size." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          if (fileSize > MAX_RAG_PDF_BYTES) {
            return new Response(JSON.stringify({ error: "PDF is too large. Maximum allowed size is 80 MB." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const storagePath = buildRagStoragePath(fileName);
          const signedUpload = await createSignedPdfUploadUrl(storagePath);

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
          const message =
            error instanceof Error ? error.message : "Failed to prepare PDF upload.";
          console.error("[api/admin/upload-knowledge-prepare] failed:", error);

          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
