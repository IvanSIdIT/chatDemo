import { supabase } from "@/lib/supabase";

export type IngestedDocument = {
  source: string;
  documentTitle: string | null;
  chunkCount: number;
  firstIngestedAt: string;
  lastIngestedAt: string;
  storageSizeBytes: number | null;
  storageUploadedAt: string | null;
};

type IngestedDocumentsApiResponse = {
  documents: IngestedDocument[];
};

async function getAuthHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("You must be signed in as a manager to view ingested documents.");
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchIngestedDocuments(): Promise<IngestedDocument[]> {
  const headers = await getAuthHeaders();
  const response = await fetch("/api/admin/ingested-documents", { headers });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Failed to load ingested documents (${response.status}).`);
  }

  const payload = (await response.json()) as IngestedDocumentsApiResponse;
  return payload.documents;
}

export type DeleteIngestedDocumentResult = {
  source: string;
  deletedChunks: number;
  deletedStorageObjects: number;
};

export async function deleteIngestedDocument(source: string): Promise<DeleteIngestedDocumentResult> {
  const headers = await getAuthHeaders();
  const response = await fetch("/api/admin/ingested-documents", {
    method: "DELETE",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Failed to delete document (${response.status}).`);
  }

  return (await response.json()) as DeleteIngestedDocumentResult;
}

export function formatDocumentSize(bytes: number | null): string {
  if (bytes == null || bytes < 0) {
    return "—";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatIngestedAt(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
