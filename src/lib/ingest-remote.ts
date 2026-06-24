import { randomUUID } from "node:crypto";

import { createSignedStorageUrl } from "@/lib/rag-storage";

export type RemoteIngestPayload = {
  jobId: string;
  storagePath: string;
  fileName: string;
  signedUrl: string;
};

export async function triggerRemoteIngest(
  storagePath: string,
  fileName: string,
): Promise<RemoteIngestPayload> {
  const workerUrl = process.env.INGEST_WORKER_URL?.trim();
  const workerSecret = process.env.INGEST_WORKER_SECRET?.trim();

  if (!workerUrl) {
    throw new Error("INGEST_WORKER_URL is not configured.");
  }

  if (!workerSecret) {
    throw new Error("INGEST_WORKER_SECRET is not configured.");
  }

  const jobId = randomUUID();
  const signedUrl = await createSignedStorageUrl(storagePath);
  const endpoint = workerUrl.replace(/\/$/, "");

  const response = await fetch(`${endpoint}/ingest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${workerSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jobId,
      storagePath,
      fileName,
      signedUrl,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ingest worker request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  return { jobId, storagePath, fileName, signedUrl };
}

export function hasRemoteIngestWorker(): boolean {
  return Boolean(process.env.INGEST_WORKER_URL?.trim() && process.env.INGEST_WORKER_SECRET?.trim());
}
