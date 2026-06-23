#!/usr/bin/env python3
"""
Semantic-chunk PDF ingest for Supabase pgvector (LlamaParse → Markdown → embeddings).

Usage:
  npm run ingest
  py -3 ingest.py

Place PDFs in docs/ or set INGEST_PDF_PATH in .env (e.g. C:/Users/sidel/Desktop/ZOV.pdf).
Requires: OPENAI_API_KEY, SUPABASE_SECRET_KEY, LLAMA_CLOUD_API_KEY
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from llama_parse import LlamaParse
from openai import OpenAI
from supabase import Client, create_client

DOCS_DIR = Path(__file__).parent / "docs"
EMBEDDING_MODEL = "text-embedding-3-small"
SIMILARITY_THRESHOLD = float(os.getenv("SEMANTIC_CHUNK_THRESHOLD", "0.83"))
EMBED_BATCH_SIZE = 64
INSERT_BATCH_SIZE = 25
LLAMA_NUM_WORKERS = int(os.getenv("LLAMA_PARSE_WORKERS", "4"))


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def create_llama_parser() -> LlamaParse:
    return LlamaParse(
        api_key=require_env("LLAMA_CLOUD_API_KEY"),
        result_type="markdown",
        num_workers=LLAMA_NUM_WORKERS,
    )


def extract_page_number(metadata: dict | None) -> int | None:
    if not metadata:
        return None

    for key in ("page_label", "page_number", "page", "page_index"):
        value = metadata.get(key)
        if value is None:
            continue
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)

    return None


def parse_pdf_markdown(parser: LlamaParse, pdf_path: Path) -> list[dict]:
    print(f"  LlamaParse: extracting markdown from {pdf_path.name}...")
    documents = parser.load_data(str(pdf_path))

    pages: list[dict] = []
    for index, document in enumerate(documents):
        text = (getattr(document, "text", None) or "").strip()
        if not text:
            continue

        metadata = getattr(document, "metadata", None) or {}
        page_number = extract_page_number(metadata) or (index + 1)
        pages.append({"page": page_number, "text": text})

    if not pages:
        raise RuntimeError(f"LlamaParse returned no text for {pdf_path.name}")

    print(f"  LlamaParse: {len(pages)} page document(s) parsed.")
    return pages


def is_markdown_table(block: str) -> bool:
    lines = [line.strip() for line in block.splitlines() if line.strip()]
    if len(lines) < 2:
        return False

    pipe_lines = sum(1 for line in lines if "|" in line)
    separator_lines = sum(1 for line in lines if re.match(r"^\|?[\s:\-|]+\|?$", line))
    return pipe_lines >= 2 and (separator_lines >= 1 or pipe_lines >= len(lines) * 0.6)


def is_markdown_figure_block(block: str) -> bool:
    lowered = block.lower()
    if lowered.startswith("!["):
        return True
    return bool(re.match(r"^(рис\.|рисунок|figure|fig\.)\s*\d+", lowered, re.IGNORECASE))


def split_sentences(text: str) -> list[str]:
    normalized = re.sub(r"[ \t]+", " ", text).strip()
    if not normalized:
        return []

    parts = re.split(r"(?<=[.!?…])\s+(?=[A-ZА-ЯЁ0-9«\"(])", normalized)
    sentences = [part.strip() for part in parts if part.strip()]
    return sentences or [normalized]


def split_markdown_units(text: str) -> list[str]:
    """Keep Markdown tables and figure captions intact; split prose into sentences."""
    blocks = re.split(r"\n{2,}", text.strip())
    units: list[str] = []

    for block in blocks:
        cleaned = block.strip()
        if not cleaned:
            continue

        if is_markdown_table(cleaned) or is_markdown_figure_block(cleaned):
            units.append(cleaned)
            continue

        if cleaned.startswith("#"):
            units.append(cleaned)
            continue

        units.extend(split_sentences(cleaned))

    return units


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


def semantic_chunk_units(
    units: list[str],
    unit_embeddings: list[list[float]],
    threshold: float,
) -> list[str]:
    if not units:
        return []

    if len(units) != len(unit_embeddings):
        raise ValueError("Unit and embedding counts must match.")

    if len(units) == 1:
        return [units[0]]

    chunks: list[str] = []
    current_units = [units[0]]

    for index in range(1, len(units)):
        previous = np.array(unit_embeddings[index - 1], dtype=np.float32)
        current = np.array(unit_embeddings[index], dtype=np.float32)
        similarity = cosine_similarity(previous, current)

        if similarity < threshold:
            chunks.append("\n\n".join(current_units))
            current_units = [units[index]]
        else:
            current_units.append(units[index])

    if current_units:
        chunks.append("\n\n".join(current_units))

    return chunks


def delete_source_chunks(supabase: Client, source: str) -> None:
    while True:
        response = (
            supabase.table("document_chunks")
            .select("id")
            .eq("metadata->>source", source)
            .limit(INSERT_BATCH_SIZE)
            .execute()
        )
        ids = [row["id"] for row in (response.data or [])]
        if not ids:
            return
        supabase.table("document_chunks").delete().in_("id", ids).execute()


def insert_chunk_batches(supabase: Client, rows: list[dict]) -> None:
    for start in range(0, len(rows), INSERT_BATCH_SIZE):
        batch = rows[start : start + INSERT_BATCH_SIZE]
        supabase.table("document_chunks").insert(batch).execute()
        print(f"  Inserted {min(start + len(batch), len(rows))}/{len(rows)} chunks...")


def ingest_pdf(
    openai_client: OpenAI,
    supabase: Client,
    parser: LlamaParse,
    pdf_path: Path,
    threshold: float,
) -> int:
    source = pdf_path.name
    print(f"Processing {source}...")

    page_documents = parse_pdf_markdown(parser, pdf_path)
    semantic_chunks: list[str] = []
    chunk_pages: list[int | None] = []

    for page_document in page_documents:
        page_number = page_document["page"]
        units = split_markdown_units(page_document["text"])
        if not units:
            continue

        unit_embeddings = embed_texts(openai_client, units)
        page_chunks = semantic_chunk_units(units, unit_embeddings, threshold)

        for chunk in page_chunks:
            semantic_chunks.append(chunk)
            chunk_pages.append(page_number)

    if not semantic_chunks:
        print(f"  Skipped {source}: no semantic chunks produced.")
        return 0

    print(f"  Generated {len(semantic_chunks)} semantic chunks.")
    chunk_embeddings = embed_texts(openai_client, semantic_chunks)
    delete_source_chunks(supabase, source)

    rows = [
        {
            "content": chunk,
            "embedding": embedding,
            "metadata": {
                "source": source,
                "chunk_index": index,
                "chunk_count": len(semantic_chunks),
                "page": chunk_pages[index],
                "similarity_threshold": threshold,
                "embedding_model": EMBEDDING_MODEL,
                "parser": "llama-parse",
                "result_type": "markdown",
            },
        }
        for index, (chunk, embedding) in enumerate(zip(semantic_chunks, chunk_embeddings, strict=True))
    ]

    insert_chunk_batches(supabase, rows)
    print(f"  Stored {len(rows)} semantic chunks from {source}.")
    return len(rows)


def collect_pdf_files() -> list[Path]:
    paths: dict[str, Path] = {}

    if DOCS_DIR.exists():
        for pdf_path in DOCS_DIR.glob("*.pdf"):
            paths[str(pdf_path.resolve())] = pdf_path.resolve()

    ingest_pdf_path = os.getenv("INGEST_PDF_PATH", "").strip()
    if ingest_pdf_path:
        custom_path = Path(ingest_pdf_path).expanduser().resolve()
        if custom_path.exists():
            paths[str(custom_path)] = custom_path
        else:
            print(f"Warning: INGEST_PDF_PATH not found: {custom_path}")

    return sorted(paths.values(), key=lambda path: path.name.lower())


def main() -> int:
    load_dotenv()

    openai_api_key = require_env("OPENAI_API_KEY")
    require_env("LLAMA_CLOUD_API_KEY")
    supabase_url = os.getenv("SUPABASE_URL", "").strip() or os.getenv("VITE_SUPABASE_URL", "").strip()
    if not supabase_url:
        raise RuntimeError("Missing required environment variable: SUPABASE_URL or VITE_SUPABASE_URL")
    supabase_key = require_env("SUPABASE_SECRET_KEY")

    if not DOCS_DIR.exists():
        DOCS_DIR.mkdir(parents=True, exist_ok=True)

    pdf_files = collect_pdf_files()
    if not pdf_files:
        print(
            f"No PDF files found. Add files to {DOCS_DIR} "
            "or set INGEST_PDF_PATH in .env (e.g. C:/Users/sidel/Desktop/ZOV.pdf).",
        )
        return 1

    openai_client = OpenAI(api_key=openai_api_key)
    supabase = create_client(supabase_url, supabase_key)
    parser = create_llama_parser()

    total_chunks = 0
    for pdf_path in pdf_files:
        total_chunks += ingest_pdf(
            openai_client,
            supabase,
            parser,
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
