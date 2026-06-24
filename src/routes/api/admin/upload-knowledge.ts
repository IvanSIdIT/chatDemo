import { createFileRoute } from "@tanstack/react-router";
import { unlink } from "node:fs/promises";

import { requireManagerRequest } from "@/lib/api-auth";
import {
  canSpawnLocalIngest,
  queueIngestJob,
  sanitizePdfFilename,
  saveUploadedPdf,
} from "@/lib/ingest-runner";
import { hasRemoteIngestWorker, triggerRemoteIngest } from "@/lib/ingest-remote";
import { uploadPdfToStorage } from "@/lib/rag-storage";

type UploadMode = "local" | "worker" | "stored";

function buildQueuedMessage(mode: UploadMode): string {
  if (mode === "local") {
    return "File uploaded successfully and queued for local AI processing. Vectorization may take several minutes.";
  }

  if (mode === "worker") {
    return "File uploaded to cloud storage and queued on the ingest worker. Vectorization may take several minutes.";
  }

  return "File uploaded to cloud storage. Configure INGEST_WORKER_URL on Vercel or run npm run ingest locally to process it.";
}

export const Route = createFileRoute("/api/admin/upload-knowledge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireManagerRequest(request);
        if (!auth.ok) {
          return auth.response;
        }

        let savedPath: string | undefined;
        let storagePath: string | undefined;

        try {
          const formData = await request.formData();
          const fileEntry = formData.get("file");

          if (!(fileEntry instanceof File)) {
            return new Response(JSON.stringify({ error: "Missing PDF file in form data." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const fileName = sanitizePdfFilename(fileEntry.name);

          try {
            const stored = await uploadPdfToStorage(fileEntry, fileName);
            storagePath = stored.storagePath;
          } catch (storageError) {
            console.error("[api/admin/upload-knowledge] storage upload failed:", storageError);
            if (!canSpawnLocalIngest()) {
              throw storageError;
            }
          }

          let mode: UploadMode = "stored";
          let jobId = randomUUID();

          if (canSpawnLocalIngest()) {
            const saved = await saveUploadedPdf(fileEntry);
            savedPath = saved.absolutePath;
            const job = queueIngestJob(saved.absolutePath);
            jobId = job.jobId;
            mode = "local";

            console.log("[api/admin/upload-knowledge] queued local ingest", {
              jobId: job.jobId,
              fileName,
              managerId: auth.userId,
              pdfPath: job.pdfPath,
              storagePath,
            });
          } else if (hasRemoteIngestWorker() && storagePath) {
            const remoteJob = await triggerRemoteIngest(storagePath, fileName);
            jobId = remoteJob.jobId;
            mode = "worker";

            console.log("[api/admin/upload-knowledge] queued remote ingest", {
              jobId,
              fileName,
              managerId: auth.userId,
              storagePath,
            });
          } else if (storagePath) {
            console.log("[api/admin/upload-knowledge] stored only", {
              jobId,
              fileName,
              managerId: auth.userId,
              storagePath,
            });
          } else {
            return new Response(
              JSON.stringify({
                error:
                  "Could not store the PDF. Configure Supabase Storage bucket rag-pdfs or run the app locally with Python installed.",
              }),
              { status: 503, headers: { "Content-Type": "application/json" } },
            );
          }

          return new Response(
            JSON.stringify({
              status: "queued",
              mode,
              jobId,
              fileName,
              storagePath: storagePath ?? null,
              message: buildQueuedMessage(mode),
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
