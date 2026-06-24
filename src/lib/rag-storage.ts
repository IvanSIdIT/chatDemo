import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";

import { getUploadsDirectory } from "@/lib/ingest-runner";
import { createSupabaseServiceClient } from "@/lib/supabase-server";

export const RAG_PDF_BUCKET = "rag-pdfs";

export function buildRagStoragePath(fileName: string): string {
  return `uploads/${Date.now()}-${randomUUID()}-${fileName}`;
}

export async function createSignedPdfUploadUrl(
  storagePath: string,
): Promise<{ signedUrl: string; token: string }> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.storage
    .from(RAG_PDF_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Failed to create signed upload URL for PDF.");
  }

  return {
    signedUrl: data.signedUrl,
    token: data.token,
  };
}

export async function uploadPdfToStorage(
  file: File,
  fileName: string,
): Promise<{ storagePath: string }> {
  const supabase = createSupabaseServiceClient();
  const storagePath = buildRagStoragePath(fileName);
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await supabase.storage.from(RAG_PDF_BUCKET).upload(storagePath, buffer, {
    contentType: "application/pdf",
    upsert: false,
  });

  if (error) {
    throw new Error(`Failed to store PDF in Supabase Storage: ${error.message}`);
  }

  return { storagePath };
}

export async function downloadStoragePdfToTemp(storagePath: string): Promise<string> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.storage.from(RAG_PDF_BUCKET).download(storagePath);

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to download PDF from Supabase Storage.");
  }

  const uploadsDir = getUploadsDirectory();
  mkdirSync(uploadsDir, { recursive: true });
  const tempPath = join(uploadsDir, basename(storagePath));
  await writeFile(tempPath, Buffer.from(await data.arrayBuffer()));

  return tempPath;
}

export async function createSignedStorageUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.storage
    .from(RAG_PDF_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Failed to create signed URL for uploaded PDF.");
  }

  return data.signedUrl;
}
