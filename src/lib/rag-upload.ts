import { supabase } from "@/lib/supabase";

export type RagUploadResponse = {
  status: "queued";
  jobId: string;
  fileName: string;
  message: string;
};

export type RagUploadErrorResponse = {
  error: string;
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

export async function uploadKnowledgePdf(file: File): Promise<RagUploadResponse> {
  const headers = await getAuthHeaders();
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/admin/upload-knowledge", {
    method: "POST",
    headers,
    body: formData,
  });

  const payload = (await response.json()) as RagUploadResponse | RagUploadErrorResponse;

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload && payload.error
        ? payload.error
        : `Upload failed (${response.status}).`;
    throw new Error(message);
  }

  return payload as RagUploadResponse;
}
