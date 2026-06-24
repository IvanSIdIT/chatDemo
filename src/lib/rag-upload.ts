import { readApiErrorMessage, readApiJson } from "@/lib/api-response";
import { supabase } from "@/lib/supabase";

export type RagUploadResponse = {
  status: "queued";
  mode: "local" | "worker" | "stored";
  jobId: string;
  fileName: string;
  storagePath: string | null;
  message: string;
};

type RagUploadPrepareResponse = {
  fileName: string;
  storagePath: string;
  signedUploadUrl: string;
  token: string;
};

async function getAuthHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("You must be signed in as a manager to upload knowledge files.");
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

async function prepareDirectUpload(file: File): Promise<RagUploadPrepareResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch("/api/admin/upload-knowledge-prepare", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
    }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, "Failed to prepare PDF upload"));
  }

  return readApiJson<RagUploadPrepareResponse>(response);
}

async function uploadPdfToSignedUrl(signedUploadUrl: string, file: File): Promise<void> {
  const response = await fetch(signedUploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/pdf",
    },
    body: file,
  });

  if (!response.ok) {
    const text = (await response.text().catch(() => "")).trim();
    throw new Error(text || `Direct storage upload failed (${response.status}).`);
  }
}

async function completeKnowledgeUpload(
  storagePath: string,
  fileName: string,
): Promise<RagUploadResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch("/api/admin/upload-knowledge", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ storagePath, fileName }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, "Failed to queue PDF ingest"));
  }

  return readApiJson<RagUploadResponse>(response);
}

export async function uploadKnowledgePdf(file: File): Promise<RagUploadResponse> {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Only .pdf documents are supported.");
  }

  const prepared = await prepareDirectUpload(file);
  await uploadPdfToSignedUrl(prepared.signedUploadUrl, file);
  return completeKnowledgeUpload(prepared.storagePath, prepared.fileName);
}
