import { createSupabaseServiceClient } from "@/lib/supabase-server";

export const DUPLICATE_INGESTED_DOCUMENT_MESSAGE =
  "Этот PDF уже добавлен в базу знаний. Удалите существующий документ в списке, если хотите загрузить его снова.";

export async function isIngestedDocumentSourceTaken(source: string): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("document_chunks")
    .select("id")
    .contains("metadata", { source })
    .limit(1);

  if (error) {
    throw new Error(`Failed to check existing documents: ${error.message}`);
  }

  return (data?.length ?? 0) > 0;
}
