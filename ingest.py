#!/usr/bin/env python3
"""
Semantic-chunk PDF ingest for Supabase pgvector.

Usage:
  pip install -r requirements-ingest.txt
  # Set OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY in .env
  python ingest.py

Place PDF instruction manuals in docs/ before running.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from openai import OpenAI
from pypdf import PdfReader
from supabase import Client, create_client

DOCS_DIR = Path(__file__).parent / "docs"
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536
SIMILARITY_THRESHOLD = float(os.getenv("SEMANTIC_CHUNK_THRESHOLD", "0.83"))
EMBED_BATCH_SIZE = 64


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def extract_pdf_text(pdf_path: Path) -> str:
    reader = PdfReader(str(pdf_path))
    pages: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        if text.strip():
            pages.append(text)
    return "\n".join(pages)


def split_sentences(text: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return []

    # Split on sentence boundaries (Latin + Cyrillic sentence starters).
    parts = re.split(r"(?<=[.!?…])\s+(?=[A-ZА-ЯЁ0-9«\"(])", normalized)
    sentences = [part.strip() for part in parts if part.strip()]

    if not sentences and normalized:
        return [normalized]

    return sentences


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)


def embed_texts(client: OpenAI, texts: list[str]) -> list[list[float]]:
    if not texts:
        return []

    embeddings: list[list[float]] = []
    for start in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[start : start + EMBED_BATCH_SIZE]
        response = client.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        embeddings.extend(item.embedding for item in response.data)

    return embeddings


def semantic_chunk_sentences(
    sentences: list[str],
    sentence_embeddings: list[list[float]],
    threshold: float,
) -> list[str]:
    if not sentences:
        return []

    if len(sentences) != len(sentence_embeddings):
        raise ValueError("Sentence and embedding counts must match.")

    if len(sentences) == 1:
        return [sentences[0]]

    chunks: list[str] = []
    current_sentences = [sentences[0]]
    vectors = [np.array(sentence_embeddings[0], dtype=np.float32)]

    for index in range(1, len(sentences)):
        previous = vectors[-1]
        current = np.array(sentence_embeddings[index], dtype=np.float32)
        similarity = cosine_similarity(previous, current)

        if similarity < threshold:
            chunks.append(" ".join(current_sentences))
            current_sentences = [sentences[index]]
        else:
            current_sentences.append(sentences[index])

        vectors.append(current)

    if current_sentences:
        chunks.append(" ".join(current_sentences))

    return chunks


def delete_source_chunks(supabase: Client, source: str) -> None:
    supabase.table("document_chunks").delete().eq("metadata->>source", source).execute()


def ingest_pdf(
    client: OpenAI,
    supabase: Client,
    pdf_path: Path,
    threshold: float,
) -> int:
    source = pdf_path.name
    print(f"Processing {source}...")

    text = extract_pdf_text(pdf_path)
    sentences = split_sentences(text)

    if not sentences:
        print(f"  Skipped {source}: no extractable text.")
        return 0

    sentence_embeddings = embed_texts(client, sentences)
    semantic_chunks = semantic_chunk_sentences(sentences, sentence_embeddings, threshold)

    if not semantic_chunks:
        print(f"  Skipped {source}: no semantic chunks produced.")
        return 0

    chunk_embeddings = embed_texts(client, semantic_chunks)
    delete_source_chunks(supabase, source)

    rows = [
        {
            "content": chunk,
            "embedding": embedding,
            "metadata": {
                "source": source,
                "chunk_index": index,
                "chunk_count": len(semantic_chunks),
                "similarity_threshold": threshold,
                "embedding_model": EMBEDDING_MODEL,
            },
        }
        for index, (chunk, embedding) in enumerate(zip(semantic_chunks, chunk_embeddings, strict=True))
    ]

    supabase.table("document_chunks").insert(rows).execute()
    print(f"  Stored {len(rows)} semantic chunks from {source}.")
    return len(rows)


def main() -> int:
    load_dotenv()

    openai_api_key = require_env("OPENAI_API_KEY")
    supabase_url = os.getenv("SUPABASE_URL", "").strip() or os.getenv("VITE_SUPABASE_URL", "").strip()
    if not supabase_url:
        raise RuntimeError("Missing required environment variable: SUPABASE_URL or VITE_SUPABASE_URL")
    supabase_key = require_env("SUPABASE_SECRET_KEY")

    if not DOCS_DIR.exists():
        DOCS_DIR.mkdir(parents=True, exist_ok=True)

    pdf_files = sorted(DOCS_DIR.glob("*.pdf"))
    if not pdf_files:
        print(f"No PDF files found in {DOCS_DIR}. Add manuals and run again.")
        return 1

    openai_client = OpenAI(api_key=openai_api_key)
    supabase = create_client(supabase_url, supabase_key)

    total_chunks = 0
    for pdf_path in pdf_files:
        total_chunks += ingest_pdf(
            openai_client,
            supabase,
            pdf_path,
            SIMILARITY_THRESHOLD,
        )

    print(f"Done. Ingested {total_chunks} chunks from {len(pdf_files)} PDF file(s).")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI entrypoint
        print(f"ingest.py failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
