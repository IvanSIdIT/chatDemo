import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

export type MatchedChunk = {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
};

const DEFAULT_MATCH_THRESHOLD = 0.75;
const DEFAULT_MATCH_COUNT = 3;

export async function embedQuery(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const { embedding } = await embed({
    model: openai.embedding("text-embedding-3-small"),
    value: trimmed,
  });

  return embedding;
}

export async function retrieveChunks(
  supabase: SupabaseClient<Database>,
  query: string,
  options?: {
    threshold?: number;
    limit?: number;
  },
): Promise<MatchedChunk[]> {
  const embedding = await embedQuery(query);
  if (embedding.length === 0) {
    return [];
  }

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: embedding,
    match_threshold: options?.threshold ?? DEFAULT_MATCH_THRESHOLD,
    match_count: options?.limit ?? DEFAULT_MATCH_COUNT,
  });

  if (error) {
    throw error;
  }

  return (data ?? []) as MatchedChunk[];
}

export function buildRagSystemPrompt(chunks: MatchedChunk[]): string {
  const context = chunks
    .map((chunk, index) => `[${index + 1}] ${chunk.content}`)
    .join("\n\n");

  return [
    "You are a factory line assistant.",
    "Answer the employee's question strictly based on the instruction context below.",
    "If the context does not contain enough information, say so clearly and do not invent details.",
    "",
    "Instruction context:",
    context || "(No relevant instructions found in the knowledge base.)",
  ].join("\n");
}
