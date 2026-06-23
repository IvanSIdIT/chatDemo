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
export const RAG_EMBEDDING_DIMENSIONS = 1536;

const DEFAULT_RPC_THRESHOLD = 0;
const DEFAULT_APP_THRESHOLD = Number(process.env.RAG_MATCH_THRESHOLD ?? "0.3");
const DEFAULT_MATCH_COUNT = 5;
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

export function formatPgvector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function embedQuery(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const { embedding } = await embed({
    model: openai.embedding(RAG_EMBEDDING_MODEL, {
      dimensions: RAG_EMBEDDING_DIMENSIONS,
    }),
    value: trimmed,
  });

  if (embedding.length !== RAG_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding dimension mismatch: expected ${RAG_EMBEDDING_DIMENSIONS}, got ${embedding.length}`,
    );
  }

  return embedding;
}

export async function retrieveChunks(
  supabase: SupabaseClient<Database>,
  query: string,
  options?: {
    rpcThreshold?: number;
    appThreshold?: number;
    limit?: number;
    logLabel?: string;
  },
): Promise<MatchedChunk[]> {
  const logLabel = options?.logLabel ?? "[rag]";
  const queryEmbedding = await embedQuery(query);

  console.log(`${logLabel} Query embedding model:`, RAG_EMBEDDING_MODEL);
  console.log(`${logLabel} Query embedding dimensions:`, queryEmbedding.length);
  console.log(`${logLabel} Query vector (first 5 numbers):`, queryEmbedding.slice(0, 5));

  if (queryEmbedding.length === 0) {
    return [];
  }

  const rpcThreshold = options?.rpcThreshold ?? DEFAULT_RPC_THRESHOLD;
  const appThreshold = options?.appThreshold ?? DEFAULT_APP_THRESHOLD;
  const matchCount = options?.limit ?? DEFAULT_MATCH_COUNT;

  const rpcArgs = {
    query_embedding: queryEmbedding,
    match_threshold: rpcThreshold,
    match_count: matchCount,
  };

  let { data, error } = await supabase.rpc("match_chunks", rpcArgs);

  if (error) {
    console.error(`${logLabel} RPC match_chunks error (number[]):`, error);
    const fallbackArgs = {
      query_embedding: formatPgvector(queryEmbedding),
      match_threshold: rpcThreshold,
      match_count: matchCount,
    };
    ({ data, error } = await supabase.rpc("match_chunks", fallbackArgs as never));
  }

  if (error) {
    console.error(`${logLabel} RPC match_chunks error (pgvector string):`, error);
    throw error;
  }

  const rawChunks = (data ?? []) as MatchedChunk[];
  console.log(`${logLabel} RPC match_chunks raw result length:`, rawChunks.length);
  console.log(
    `${logLabel} RPC raw similarities:`,
    rawChunks.map((chunk) => ({
      id: chunk.id,
      similarity: chunk.similarity,
      length: chunk.content?.length ?? 0,
    })),
  );
  console.log(`${logLabel} RPC raw context:`, JSON.stringify(rawChunks, null, 2));

  const thresholdFiltered = rawChunks.filter((chunk) => chunk.similarity >= appThreshold);
  const validChunks = thresholdFiltered.filter((chunk) => isValidChunkContent(chunk.content));

  console.log(`${logLabel} After app threshold ${appThreshold}:`, thresholdFiltered.length);
  console.log(`${logLabel} After content validation:`, validChunks.length);

  return validChunks;
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
