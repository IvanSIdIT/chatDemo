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

type KeywordChunk = {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  rank: number;
};

type FusedChunk = MatchedChunk & {
  vectorSimilarity: number;
  keywordRank: number;
  fusionScore: number;
  rerankBoost: number;
};

export const RAG_EMBEDDING_MODEL = "text-embedding-3-small";
export const RAG_EMBEDDING_DIMENSIONS = 1536;

const DEFAULT_RPC_THRESHOLD = 0;
const DEFAULT_APP_THRESHOLD = Number(process.env.RAG_MATCH_THRESHOLD ?? "0.3");
const DEFAULT_FINAL_TOP_K = Number(process.env.RAG_SIMILARITY_TOP_K ?? "8");
const DEFAULT_CANDIDATES_PER_QUERY = Number(process.env.RAG_NUM_CHUNKS_PER_QUERY ?? "10");
const DEFAULT_RRF_K = Number(process.env.RAG_RRF_K ?? "60");
const HYBRID_SEARCH_ENABLED = (process.env.RAG_ENABLE_HYBRID ?? "true").toLowerCase() !== "false";

const MIN_CHUNK_CHARS = 20;
const MIN_CHUNK_WORDS = 3;

const CHEMICAL_TERMS = [
  "ppm",
  "chloride",
  "chlorides",
  "sulfate",
  "sulfates",
  "hardness",
  "calcium",
  "magnesium",
  "ph",
  "coolant",
  "antifreeze",
  "water quality",
  "distilled",
  "deionized",
  "corrosion",
  "engine damage",
];

function wordCount(text: string): number {
  const matches = text.match(/[\w\u0400-\u04FF]+/gu);
  return matches?.length ?? 0;
}

export function isValidChunkContent(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < MIN_CHUNK_CHARS) {
    return false;
  }

  return wordCount(trimmed) >= MIN_CHUNK_WORDS;
}

export function formatPgvector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export function expandQueryForKeywordSearch(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) {
    return "";
  }

  const tokens = new Set(trimmed.split(/\s+/).filter((token) => token.length > 1));

  if (/water|coolant|antifreeze|качеств|вода|антифриз|охлажд/i.test(query)) {
    for (const term of [
      "water",
      "quality",
      "chlorides",
      "sulfates",
      "hardness",
      "ppm",
      "coolant",
      "antifreeze",
    ]) {
      tokens.add(term);
    }
  }

  if (/damage|engine|corrosion|поврежд|двигател|корроз/i.test(query)) {
    for (const term of ["engine", "damage", "corrosion", "pitting", "cylinder"]) {
      tokens.add(term);
    }
  }

  if (/table|limit|requirement|требован|таблиц|ppm|mg\/l/i.test(query)) {
    for (const term of ["ppm", "mg/L", "hardness", "chlorides", "sulfates", "maximum", "minimum"]) {
      tokens.add(term);
    }
  }

  return [...tokens].join(" ");
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

async function callMatchChunks(
  supabase: SupabaseClient<Database>,
  queryEmbedding: number[],
  rpcThreshold: number,
  matchCount: number,
  logLabel: string,
): Promise<MatchedChunk[]> {
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

  return (data ?? []) as MatchedChunk[];
}

async function callMatchChunksKeyword(
  supabase: SupabaseClient<Database>,
  searchQuery: string,
  matchCount: number,
  logLabel: string,
): Promise<KeywordChunk[]> {
  const { data, error } = await supabase.rpc("match_chunks_keyword", {
    search_query: searchQuery,
    match_count: matchCount,
  });

  if (error) {
    console.warn(`${logLabel} RPC match_chunks_keyword unavailable:`, error.message);
    return [];
  }

  return (data ?? []) as KeywordChunk[];
}

export function reciprocalRankFusion(
  vectorChunks: MatchedChunk[],
  keywordChunks: KeywordChunk[],
  rrfK = DEFAULT_RRF_K,
): FusedChunk[] {
  const fused = new Map<string, FusedChunk>();

  vectorChunks.forEach((chunk, index) => {
    const fusionScore = 1 / (rrfK + index + 1);
    fused.set(chunk.id, {
      ...chunk,
      vectorSimilarity: chunk.similarity,
      keywordRank: 0,
      fusionScore,
      rerankBoost: 0,
      similarity: chunk.similarity,
    });
  });

  keywordChunks.forEach((chunk, index) => {
    const fusionScore = 1 / (rrfK + index + 1);
    const existing = fused.get(chunk.id);

    if (existing) {
      existing.keywordRank = chunk.rank;
      existing.fusionScore += fusionScore;
      existing.similarity = existing.fusionScore;
      return;
    }

    fused.set(chunk.id, {
      id: chunk.id,
      content: chunk.content,
      metadata: chunk.metadata,
      similarity: fusionScore,
      vectorSimilarity: 0,
      keywordRank: chunk.rank,
      fusionScore,
      rerankBoost: 0,
    });
  });

  return [...fused.values()].sort((left, right) => right.fusionScore - left.fusionScore);
}

export function rerankChunks(query: string, chunks: FusedChunk[]): FusedChunk[] {
  const queryLower = query.toLowerCase();
  const queryTokens = new Set(
    queryLower.split(/[^\w\u0400-\u04FF]+/u).filter((token) => token.length > 2),
  );

  const reranked = chunks.map((chunk) => {
    let boost = 0;
    const contentLower = chunk.content.toLowerCase();
    const sectionPath = String(chunk.metadata?.section_path ?? "").toLowerCase();
    const blockType = String(chunk.metadata?.block_type ?? "").toLowerCase();

    if (contentLower.includes("|")) {
      boost += 0.15;
    }

    if (blockType === "table") {
      boost += 0.1;
    }

    for (const term of CHEMICAL_TERMS) {
      if (!contentLower.includes(term)) {
        continue;
      }

      const termRoot = term.split(" ")[0] ?? term;
      if (
        queryLower.includes(term) ||
        queryLower.includes(termRoot) ||
        /water|coolant|antifreeze|ppm|chloride|sulfate|hardness|quality/i.test(queryLower)
      ) {
        boost += 0.06;
      }
    }

    if (/\b\d+(\.\d+)?\s*(ppm|mg\/l|mg\/L|%|°[cf])\b/i.test(chunk.content)) {
      boost += 0.12;
    }

    if (
      (/water|coolant|antifreeze|качеств|вода/i.test(queryLower) &&
        (sectionPath.includes("coolant") ||
          sectionPath.includes("water") ||
          contentLower.includes("water quality"))) ||
      (/damage|engine|corrosion|поврежд|двигател/i.test(queryLower) &&
        (sectionPath.includes("damage") ||
          sectionPath.includes("engine") ||
          contentLower.includes("engine damage")))
    ) {
      boost += 0.14;
    }

    for (const token of queryTokens) {
      if (contentLower.includes(token)) {
        boost += 0.02;
      }
    }

    if (chunk.keywordRank > 0) {
      boost += Math.min(chunk.keywordRank, 0.25);
    }

    return {
      ...chunk,
      rerankBoost: boost,
      similarity: chunk.fusionScore + boost,
    };
  });

  return reranked.sort((left, right) => right.similarity - left.similarity);
}

function passesRetrievalThreshold(chunk: FusedChunk, appThreshold: number): boolean {
  if (chunk.vectorSimilarity >= appThreshold) {
    return true;
  }

  if (chunk.keywordRank > 0.01) {
    return true;
  }

  return chunk.fusionScore >= 2 / (DEFAULT_RRF_K + 1);
}

export async function retrieveChunks(
  supabase: SupabaseClient<Database>,
  query: string,
  options?: {
    rpcThreshold?: number;
    appThreshold?: number;
    limit?: number;
    candidatesPerQuery?: number;
    enableHybrid?: boolean;
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
  const finalTopK = options?.limit ?? DEFAULT_FINAL_TOP_K;
  const candidatesPerQuery = options?.candidatesPerQuery ?? DEFAULT_CANDIDATES_PER_QUERY;
  const enableHybrid = options?.enableHybrid ?? HYBRID_SEARCH_ENABLED;

  const vectorChunks = await callMatchChunks(
    supabase,
    queryEmbedding,
    rpcThreshold,
    candidatesPerQuery,
    logLabel,
  );

  console.log(`${logLabel} Vector candidates:`, vectorChunks.length);

  let rankedChunks: FusedChunk[];

  if (enableHybrid) {
    const keywordQuery = expandQueryForKeywordSearch(query);
    const keywordChunks = keywordQuery
      ? await callMatchChunksKeyword(supabase, keywordQuery, candidatesPerQuery, logLabel)
      : [];

    console.log(`${logLabel} Keyword query:`, keywordQuery);
    console.log(`${logLabel} Keyword candidates:`, keywordChunks.length);

    rankedChunks = reciprocalRankFusion(vectorChunks, keywordChunks);
    rankedChunks = rerankChunks(query, rankedChunks);

    console.log(
      `${logLabel} Hybrid fusion top scores:`,
      rankedChunks.slice(0, finalTopK).map((chunk) => ({
        id: chunk.id,
        fusionScore: Number(chunk.fusionScore.toFixed(4)),
        vectorSimilarity: Number(chunk.vectorSimilarity.toFixed(4)),
        keywordRank: Number(chunk.keywordRank.toFixed(4)),
        rerankBoost: Number(chunk.rerankBoost.toFixed(4)),
      })),
    );
  } else {
    rankedChunks = vectorChunks.map((chunk) => ({
      ...chunk,
      vectorSimilarity: chunk.similarity,
      keywordRank: 0,
      fusionScore: chunk.similarity,
      rerankBoost: 0,
    }));
  }

  const thresholdFiltered = rankedChunks.filter((chunk) => passesRetrievalThreshold(chunk, appThreshold));
  const validChunks = thresholdFiltered
    .filter((chunk) => isValidChunkContent(chunk.content))
    .slice(0, finalTopK);

  const droppedByValidation = thresholdFiltered.filter((chunk) => !isValidChunkContent(chunk.content));

  console.log(`${logLabel} After threshold/hybrid filter:`, thresholdFiltered.length);
  console.log(`${logLabel} After content validation (top ${finalTopK}):`, validChunks.length);
  if (droppedByValidation.length > 0) {
    console.log(
      `${logLabel} Dropped by validation:`,
      droppedByValidation.map((chunk) => ({
        id: chunk.id,
        length: chunk.content.length,
        words: wordCount(chunk.content),
      })),
    );
  }

  if (validChunks.length > 0) {
    return validChunks.map(({ id, content, metadata, similarity }) => ({
      id,
      content,
      metadata,
      similarity,
    }));
  }

  const fallback = rankedChunks
    .filter((chunk) => isValidChunkContent(chunk.content))
    .slice(0, finalTopK);

  return fallback.map(({ id, content, metadata, similarity }) => ({
    id,
    content,
    metadata,
    similarity,
  }));
}

export function buildRagSystemPrompt(chunks: MatchedChunk[]): string {
  if (chunks.length === 0) {
    return [
      "You are a factory line assistant.",
      "No relevant instruction excerpts were found in the knowledge base for this question.",
      "Reply politely in the same language as the user and say that you do not have this information in the available instructions.",
      "Do not invent technical details, part numbers, or procedures.",
      "If the question asks about table values or numeric ranges and the context is missing, explicitly say that the table data was not found in the retrieved instructions.",
    ].join("\n");
  }

  const context = chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] (relevance=${chunk.similarity.toFixed(3)})\n${chunk.content}`,
    )
    .join("\n\n");

  return [
    "You are a factory line assistant.",
    "Answer the employee's question using the instruction context below.",
    "Synthesize information across multiple excerpts when needed: one excerpt may contain a table, another may contain explanatory notes, warnings, or damage descriptions.",
    "If different excerpts cover different parts of the answer (for example, water-quality limits in one table and engine damage notes in another section), combine them into one coherent answer.",
    "Only say that you do not have the information if none of the excerpts contain relevant facts after careful review.",
    "If the context is partial, answer with what is available and clearly state which details are missing.",
    "Treat markdown tables as authoritative structured data. Read rows and columns carefully before answering.",
    "When comparing negative temperatures, verify the math explicitly: -15°C is colder than -7°C.",
    "For viscosity recommendations, ensure lower temperature conditions align with lower-temperature suitable viscosity grades according to the retrieved table, not intuition.",
    "When the answer depends on ppm limits, hardness, chlorides, sulfates, or other tabular specs, quote the value exactly from the retrieved context.",
    "For coolant / water-quality questions, prioritize table limits and any linked notes about corrosion or engine damage.",
    "",
    "Instruction context:",
    context,
  ].join("\n");
}
