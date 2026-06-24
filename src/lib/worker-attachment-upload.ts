import { readApiErrorMessage, readApiJson } from "@/lib/api-response";
import { supabase } from "@/lib/supabase";
import type { EmployeeMessage } from "@/lib/database.types";

type PrepareUploadResponse = {
  fileName: string;
  storagePath: string;
  signedUploadUrl: string;
  token: string;
};

type CompleteUploadResponse = {
  message: EmployeeMessage;
};

async function getAuthHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("You must be signed in to send attachments.");
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

async function prepareWorkerPdfUpload(file: File): Promise<PrepareUploadResponse> {
  const headers = await getAuthHeaders();
  const response = await fetch("/api/worker/upload-attachment-prepare", {
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

  return readApiJson<PrepareUploadResponse>(response);
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
    throw new Error(text || `Storage upload failed (${response.status}).`);
  }
}

async function completeWorkerPdfUpload(
  storagePath: string,
  fileName: string,
): Promise<EmployeeMessage> {
  const headers = await getAuthHeaders();
  const response = await fetch("/api/worker/upload-attachment", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ storagePath, fileName }),
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, "Failed to send PDF to manager"));
  }

  const payload = await readApiJson<CompleteUploadResponse>(response);
  return payload.message;
}

export async function uploadWorkerPdfAttachment(file: File): Promise<EmployeeMessage> {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Only .pdf files are supported.");
  }

  const prepared = await prepareWorkerPdfUpload(file);
  await uploadPdfToSignedUrl(prepared.signedUploadUrl, file);
  return completeWorkerPdfUpload(prepared.storagePath, prepared.fileName);
}

export async function fetchWorkerAttachmentDownloadUrl(storagePath: string): Promise<string> {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({ storagePath });
  const response = await fetch(`/api/worker/attachment-download?${params.toString()}`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, "Failed to get download URL"));
  }

  const payload = await readApiJson<{ signedUrl: string }>(response);
  return payload.signedUrl;
}
