import { createFileRoute } from "@tanstack/react-router";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";

import { requireManagerRequest } from "@/lib/api-auth";
import {
  canSpawnLocalIngest,
  queueIngestJob,
  sanitizePdfFilename,
  saveUploadedPdf,
} from "@/lib/ingest-runner";
import { hasRemoteIngestWorker, triggerRemoteIngest } from "@/lib/ingest-remote";
import { downloadStoragePdfToTemp, uploadPdfToStorage } from "@/lib/rag-storage";

type UploadMode = "local" | "worker" | "stored";

type QueueUploadResult = {
  mode: UploadMode;
  jobId: string;
  fileName: string;
  storagePath: string | null;
  message: string;
};

function buildQueuedMessage(mode: UploadMode): string {
  if (mode === "local") {
    return "File uploaded successfully and queued for local AI processing. Vectorization may take several minutes.";
  }

  if (mode === "worker") {
    return "File uploaded to cloud storage and queued on the ingest worker. Vectorization may take several minutes.";
  }

  return "File uploaded to cloud storage. Configure INGEST_WORKER_URL on Vercel or run npm run ingest locally to process it.";
}

function isValidStoragePath(storagePath: string): boolean {
  if (!storagePath.startsWith("uploads/")) {
    return false;
  }

  if (storagePath.includes("..") || storagePath.includes("\\")) {
    return false;
  }

  return storagePath.toLowerCase().endsWith(".pdf");
}

async function queueKnowledgeUpload(options: {
  managerId: string;
  fileName: string;
  storagePath?: string;
  fileEntry?: File;
}): Promise<QueueUploadResult> {
  const fileName = sanitizePdfFilename(options.fileName);
  let savedPath: string | undefined;
  let storagePath = options.storagePath;

  try {
    if (options.fileEntry) {
      try {
        const stored = await uploadPdfToStorage(options.fileEntry, fileName);
        storagePath = stored.storagePath;
      } catch (storageError) {
        console.error("[api/admin/upload-knowledge] storage upload failed:", storageError);
        if (!canSpawnLocalIngest()) {
          throw storageError;
        }
      }
    }

    if (!storagePath && !options.fileEntry) {
      throw new Error("Storage path is required after direct upload.");
    }

    let mode: UploadMode = "stored";
    let jobId = randomUUID();

    if (canSpawnLocalIngest()) {
      if (options.fileEntry) {
        const saved = await saveUploadedPdf(options.fileEntry);
        savedPath = saved.absolutePath;
      } else if (storagePath) {
        savedPath = await downloadStoragePdfToTemp(storagePath);
      } else {
        throw new Error("Could not resolve a local PDF path for ingest.");
      }

      const job = queueIngestJob(savedPath);
      jobId = job.jobId;
      mode = "local";

      console.log("[api/admin/upload-knowledge] queued local ingest", {
        jobId: job.jobId,
        fileName,
        managerId: options.managerId,
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
        managerId: options.managerId,
        storagePath,
      });
    } else if (storagePath) {
      console.log("[api/admin/upload-knowledge] stored only", {
        jobId,
        fileName,
        managerId: options.managerId,
        storagePath,
      });
    } else {
      throw new Error(
        "Could not store the PDF. Configure Supabase Storage bucket rag-pdfs or run the app locally with Python installed.",
      );
    }

    return {
      mode,
      jobId,
      fileName,
      storagePath: storagePath ?? null,
      message: buildQueuedMessage(mode),
    };
  } catch (error) {
    if (savedPath) {
      try {
        await unlink(savedPath);
      } catch (cleanupError) {
        console.error("[api/admin/upload-knowledge] failed to delete temp file:", cleanupError);
      }
    }

    throw error;
  }
}

export const Route = createFileRoute("/api/admin/upload-knowledge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireManagerRequest(request);
        if (!auth.ok) {
          return auth.response;
        }

        try {
          const contentType = request.headers.get("content-type") ?? "";

          if (contentType.includes("application/json")) {
            const body = (await request.json().catch(() => null)) as {
              storagePath?: string;
              fileName?: string;
            } | null;

            const storagePath = body?.storagePath?.trim() ?? "";
            const fileName = body?.fileName?.trim() ?? "";

            if (!storagePath || !isValidStoragePath(storagePath)) {
              return new Response(JSON.stringify({ error: "Invalid storage path for uploaded PDF." }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
              });
            }

            if (!fileName) {
              return new Response(JSON.stringify({ error: "Missing PDF file name." }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
              });
            }

            const result = await queueKnowledgeUpload({
              managerId: auth.userId,
              fileName,
              storagePath,
            });

            return new Response(JSON.stringify({ status: "queued", ...result }), {
              status: 202,
              headers: { "Content-Type": "application/json" },
            });
          }

          const formData = await request.formData();
          const fileEntry = formData.get("file");

          if (!(fileEntry instanceof File)) {
            return new Response(JSON.stringify({ error: "Missing PDF file in form data." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const result = await queueKnowledgeUpload({
            managerId: auth.userId,
            fileName: fileEntry.name,
            fileEntry,
          });

          return new Response(JSON.stringify({ status: "queued", ...result }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
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
