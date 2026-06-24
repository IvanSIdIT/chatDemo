import { randomUUID } from "node:crypto";

import {
  sanitizeWorkerPdfFilename,
  type WorkerPdfAttachment,
} from "@/lib/worker-attachments";
import { createSupabaseServiceClient } from "@/lib/supabase-server";

export const EMPLOYEE_ATTACHMENTS_BUCKET = "employee-attachments";

export function buildWorkerAttachmentStoragePath(employeeId: string, fileName: string): string {
  const safeName = sanitizeWorkerPdfFilename(fileName);
  return `attachments/${employeeId}/${Date.now()}-${randomUUID()}-${safeName}`;
}

export async function createSignedWorkerAttachmentUploadUrl(
  storagePath: string,
): Promise<{ signedUrl: string; token: string }> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.storage
    .from(EMPLOYEE_ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Failed to create signed upload URL for attachment.");
  }

  return {
    signedUrl: data.signedUrl,
    token: data.token,
  };
}

export async function createSignedWorkerAttachmentDownloadUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.storage
    .from(EMPLOYEE_ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Failed to create download URL for attachment.");
  }

  return data.signedUrl;
}

export function toWorkerPdfAttachment(
  fileName: string,
  storagePath: string,
): WorkerPdfAttachment {
  return { fileName, storagePath };
}
