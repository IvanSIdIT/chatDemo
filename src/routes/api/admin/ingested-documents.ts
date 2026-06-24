import { createFileRoute } from "@tanstack/react-router";

import { requireManagerRequest } from "@/lib/api-auth";
import type { IngestedDocument } from "@/lib/ingested-documents";
import {
  isValidDocumentSource,
  listMatchingStorageObjectNames,
  matchesRagDocumentSource,
  toRagStoragePaths,
} from "@/lib/rag-document-sources";
import { RAG_PDF_BUCKET } from "@/lib/rag-storage";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
  getAccessTokenFromRequest,
} from "@/lib/supabase-server";

type IngestedDocumentRow = {
  source: string;
  document_title: string | null;
  chunk_count: number;
  first_ingested_at: string;
  last_ingested_at: string;
};

type StorageObjectRow = {
  name: string;
  created_at: string | null;
  metadata: Record<string, unknown> | null;
};

function readStorageSize(metadata: Record<string, unknown> | null): number | null {
  const size = metadata?.size;
  return typeof size === "number" ? size : null;
}

function findStorageMatch(source: string, objects: StorageObjectRow[]): StorageObjectRow | null {
  return objects.find((object) => matchesRagDocumentSource(object.name, source)) ?? null;
}

export const Route = createFileRoute("/api/admin/ingested-documents")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireManagerRequest(request);
        if (!auth.ok) {
          return auth.response;
        }

        try {
          const accessToken = getAccessTokenFromRequest(request);
          if (!accessToken) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          const userSupabase = createSupabaseServerClient(accessToken);
          const { data: rows, error } = await userSupabase.rpc("list_ingested_documents");

          if (error) {
            console.error("[api/admin/ingested-documents] rpc failed:", error);
            return new Response(JSON.stringify({ error: "Failed to load ingested documents." }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          const serviceSupabase = createSupabaseServiceClient();
          const { data: storageObjects, error: storageError } = await serviceSupabase.storage
            .from(RAG_PDF_BUCKET)
            .list("uploads", {
              limit: 1000,
              sortBy: { column: "created_at", order: "desc" },
            });

          if (storageError) {
            console.warn("[api/admin/ingested-documents] storage list failed:", storageError);
          }

          const storageList = (storageObjects ?? []) as StorageObjectRow[];
          const documents: IngestedDocument[] = ((rows ?? []) as IngestedDocumentRow[]).map(
            (row) => {
              const storageMatch = findStorageMatch(row.source, storageList);

              return {
                source: row.source,
                documentTitle: row.document_title,
                chunkCount: Number(row.chunk_count),
                firstIngestedAt: row.first_ingested_at,
                lastIngestedAt: row.last_ingested_at,
                storageSizeBytes: readStorageSize(storageMatch?.metadata ?? null),
                storageUploadedAt: storageMatch?.created_at ?? null,
              };
            },
          );

          return new Response(JSON.stringify({ documents }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("[api/admin/ingested-documents] unexpected error:", error);
          return new Response(JSON.stringify({ error: "Failed to load ingested documents." }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
      DELETE: async ({ request }) => {
        const auth = await requireManagerRequest(request);
        if (!auth.ok) {
          return auth.response;
        }

        try {
          const body = (await request.json().catch(() => null)) as { source?: string } | null;
          const source = body?.source?.trim() ?? "";

          if (!isValidDocumentSource(source)) {
            return new Response(JSON.stringify({ error: "Invalid document source." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const accessToken = getAccessTokenFromRequest(request);
          if (!accessToken) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          const userSupabase = createSupabaseServerClient(accessToken);
          const { data: deletedChunks, error } = await userSupabase.rpc("delete_ingested_document", {
            p_source: source,
          });

          if (error) {
            console.error("[api/admin/ingested-documents] delete rpc failed:", error);
            return new Response(JSON.stringify({ error: "Failed to delete ingested document." }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          const serviceSupabase = createSupabaseServiceClient();
          const { data: storageObjects, error: storageError } = await serviceSupabase.storage
            .from(RAG_PDF_BUCKET)
            .list("uploads", { limit: 1000 });

          let deletedStorageObjects = 0;
          if (storageError) {
            console.warn("[api/admin/ingested-documents] storage list failed:", storageError);
          } else {
            const matchingNames = listMatchingStorageObjectNames(
              (storageObjects ?? []).map((object) => object.name),
              source,
            );
            const storagePaths = toRagStoragePaths(matchingNames);

            if (storagePaths.length > 0) {
              const { error: removeError } = await serviceSupabase.storage
                .from(RAG_PDF_BUCKET)
                .remove(storagePaths);

              if (removeError) {
                console.warn("[api/admin/ingested-documents] storage remove failed:", removeError);
              } else {
                deletedStorageObjects = storagePaths.length;
              }
            }
          }

          return new Response(
            JSON.stringify({
              source,
              deletedChunks: Number(deletedChunks ?? 0),
              deletedStorageObjects,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        } catch (error) {
          console.error("[api/admin/ingested-documents] delete unexpected error:", error);
          return new Response(JSON.stringify({ error: "Failed to delete ingested document." }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
