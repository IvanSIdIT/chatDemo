import { createFileRoute } from "@tanstack/react-router";
import { unlink } from "node:fs/promises";

import { requireManagerRequest } from "@/lib/api-auth";
import {
  isIngestRuntimeAvailable,
  queueIngestJob,
  saveUploadedPdf,
} from "@/lib/ingest-runner";

export const Route = createFileRoute("/api/admin/upload-knowledge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireManagerRequest(request);
        if (!auth.ok) {
          return auth.response;
        }

        if (!isIngestRuntimeAvailable()) {
          return new Response(
            JSON.stringify({
              error:
                "RAG ingest is not available in this deployment. Use npm run ingest locally or run the app on a server with Python installed.",
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }

        let savedPath: string | undefined;

        try {
          const formData = await request.formData();
          const fileEntry = formData.get("file");

          if (!(fileEntry instanceof File)) {
            return new Response(JSON.stringify({ error: "Missing PDF file in form data." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const saved = await saveUploadedPdf(fileEntry);
          savedPath = saved.absolutePath;

          const job = queueIngestJob(saved.absolutePath);

          console.log("[api/admin/upload-knowledge] queued ingest", {
            jobId: job.jobId,
            fileName: saved.fileName,
            managerId: auth.userId,
            pdfPath: job.pdfPath,
            logPath: job.logPath,
          });

          return new Response(
            JSON.stringify({
              status: "queued",
              jobId: job.jobId,
              fileName: saved.fileName,
              message:
                "File uploaded successfully and queued for AI processing. Vectorization may take several minutes.",
            }),
            {
              status: 202,
              headers: { "Content-Type": "application/json" },
            },
          );
        } catch (error) {
          if (savedPath) {
            try {
              await unlink(savedPath);
            } catch (cleanupError) {
              console.error("[api/admin/upload-knowledge] failed to delete temp file:", cleanupError);
            }
          }

          const message = error instanceof Error ? error.message : "Failed to queue knowledge upload.";
          console.error("[api/admin/upload-knowledge] upload failed:", error);

          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
