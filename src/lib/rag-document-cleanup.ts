import type { SupabaseClient } from "@supabase/supabase-js";

import {
  listMatchingStorageObjectNames,
  toRagStoragePaths,
} from "@/lib/rag-document-sources";
import { RAG_PDF_BUCKET } from "@/lib/rag-storage";
import type { Database } from "@/lib/database.types";

type ServiceClient = SupabaseClient<Database>;

export async function deleteIngestedChunksForSource(
  supabase: ServiceClient,
  source: string,
): Promise<number> {
  const { count, error: countError } = await supabase
    .from("document_chunks")
    .select("id", { count: "exact", head: true })
    .contains("metadata", { source });

  if (countError) {
    throw new Error(`Failed to count document chunks: ${countError.message}`);
  }

  const { error } = await supabase
    .from("document_chunks")
    .delete()
    .contains("metadata", { source });

  if (error) {
    throw new Error(`Failed to delete document chunks: ${error.message}`);
  }

  return count ?? 0;
}

export async function deleteAllIngestedChunks(supabase: ServiceClient): Promise<number> {
  const { count, error: countError } = await supabase
    .from("document_chunks")
    .select("id", { count: "exact", head: true });

  if (countError) {
    throw new Error(`Failed to count document chunks: ${countError.message}`);
  }

  const { error } = await supabase.from("document_chunks").delete().not("id", "is", null);

  if (error) {
    throw new Error(`Failed to delete document chunks: ${error.message}`);
  }

  return count ?? 0;
}

export async function deleteStorageObjectsForSource(
  supabase: ServiceClient,
  source: string,
): Promise<number> {
  const { data: storageObjects, error: storageError } = await supabase.storage
    .from(RAG_PDF_BUCKET)
    .list("uploads", { limit: 1000 });

  if (storageError) {
    console.warn("[rag-document-cleanup] storage list failed:", storageError);
    return 0;
  }

  const matchingNames = listMatchingStorageObjectNames(
    (storageObjects ?? []).map((object) => object.name),
    source,
  );
  const storagePaths = toRagStoragePaths(matchingNames);

  if (storagePaths.length === 0) {
    return 0;
  }

  const { error: removeError } = await supabase.storage.from(RAG_PDF_BUCKET).remove(storagePaths);

  if (removeError) {
    console.warn("[rag-document-cleanup] storage remove failed:", removeError);
    return 0;
  }

  return storagePaths.length;
}

export async function deleteAllStorageUploads(supabase: ServiceClient): Promise<number> {
  const { data: storageObjects, error: storageError } = await supabase.storage
    .from(RAG_PDF_BUCKET)
    .list("uploads", { limit: 1000 });

  if (storageError) {
    console.warn("[rag-document-cleanup] storage list failed:", storageError);
    return 0;
  }

  const storagePaths = toRagStoragePaths((storageObjects ?? []).map((object) => object.name));

  if (storagePaths.length === 0) {
    return 0;
  }

  const { error: removeError } = await supabase.storage.from(RAG_PDF_BUCKET).remove(storagePaths);

  if (removeError) {
    console.warn("[rag-document-cleanup] storage remove failed:", removeError);
    return 0;
  }

  return storagePaths.length;
}
