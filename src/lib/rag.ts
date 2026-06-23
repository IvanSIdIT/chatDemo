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

export const RAG_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_MATCH_THRESHOLD = 0.65;
const DEFAULT_MATCH_COUNT = 3;
const MIN_CHUNK_CHARS = 40;
const MIN_CHUNK_WORDS = 5;

function wordCount(text: string): number {
  const matches = text.match(/[\w\u0400-\u04FF]+/gu);
  return matches?.length ?? 0;
}

export function isValidChunkContent(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < MIN_CHUNK_CHARS) {
    return false;
  }
  if (wordCount(trimmed) < MIN_CHUNK_WORDS) {
    return false;
  }
  if (/^[\s\W\d]+$/u.test(trimmed)) {
    return false;
  }
  return true;
}

export async function embedQuery(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const { embedding } = await embed({
    model: openai.embedding(RAG_EMBEDDING_MODEL),
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

  return ((data ?? []) as MatchedChunk[]).filter((chunk) => isValidChunkContent(chunk.content));
}

export function buildRagSystemPrompt(chunks: MatchedChunk[]): string {
  if (chunks.length === 0) {
    return [
      "You are a factory line assistant.",
      "No relevant instruction excerpts were found in the knowledge base for this question.",
      "Reply politely in the same language as the user and say that you do not have this information in the available instructions.",
      "Do not invent technical details, part numbers, or procedures.",
    ].join("\n");
  }

  const context = chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] (similarity=${chunk.similarity.toFixed(3)})\n${chunk.content}`,
    )
    .join("\n\n");

  return [
    "You are a factory line assistant.",
    "Answer the employee's question strictly based on the instruction context below.",
    "If the context does not contain enough information, say politely that you do not have this information in the instructions. Do not invent details.",
    "",
    "Instruction context:",
    context,
  ].join("\n");
}
