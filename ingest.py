#!/usr/bin/env python3
"""
Markdown-first RAG ingest for technical PDFs.

Pipeline:
  LlamaParse -> Markdown blocks -> contextual metadata injection ->
  LlamaIndex SentenceSplitter -> OpenAI embeddings -> Supabase pgvector
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import Document
from llama_parse import LlamaParse
from openai import OpenAI
from supabase import Client, create_client

DOCS_DIR = Path(__file__).parent / "docs"
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
EMBED_BATCH_SIZE = 64
INSERT_BATCH_SIZE = 25
LLAMA_NUM_WORKERS = int(os.getenv("LLAMA_PARSE_WORKERS", "4"))

CHUNK_SIZE = int(os.getenv("LLAMA_CHUNK_SIZE", "1024"))
CHUNK_OVERLAP = int(os.getenv("LLAMA_CHUNK_OVERLAP", "160"))

MIN_BLOCK_CHARS = int(os.getenv("MIN_BLOCK_CHARS", "40"))
MIN_BLOCK_WORDS = int(os.getenv("MIN_BLOCK_WORDS", "5"))
MIN_CHUNK_CHARS = int(os.getenv("MIN_CHUNK_CHARS", "80"))
MIN_CHUNK_WORDS = int(os.getenv("MIN_CHUNK_WORDS", "12"))


@dataclass
class ParsedPage:
    page_number: int
    text: str


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def word_count(text: str) -> int:
    return len(re.findall(r"[\w\u0400-\u04FF]+", text, re.UNICODE))


def is_meaningful_text(text: str, *, min_chars: int, min_words: int) -> bool:
    stripped = text.strip()
    return len(stripped) >= min_chars and word_count(stripped) >= min_words


def clean_markdown_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[^\S\n]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)

    cleaned_lines: list[str] = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            cleaned_lines.append("")
            continue
        if re.fullmatch(r"[-=_*]{3,}", stripped):
            continue
        cleaned_lines.append(stripped)

    return "\n".join(cleaned_lines).strip()


def create_llama_parser() -> LlamaParse:
    return LlamaParse(
        api_key=require_env("LLAMA_CLOUD_API_KEY"),
        result_type="markdown",
        num_workers=LLAMA_NUM_WORKERS,
    )


def create_splitter() -> SentenceSplitter:
    return SentenceSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        paragraph_separator="\n\n",
        secondary_chunking_regex=r"(?<=[.!?…])\s+",
    )


def extract_page_number(metadata: dict | None) -> int | None:
    if not metadata:
        return None
    for key in ("page_label", "page_number", "page", "page_index"):
        value = metadata.get(key)
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)
    return None


def parse_pdf_markdown(parser: LlamaParse, pdf_path: Path) -> list[ParsedPage]:
    print(f"  LlamaParse: extracting markdown from {pdf_path.name}...")
    documents = parser.load_data(str(pdf_path))

    pages: list[ParsedPage] = []
    for index, document in enumerate(documents):
        raw_text = getattr(document, "text", None) or ""
        text = clean_markdown_text(raw_text)
        if not text:
            continue

        metadata = getattr(document, "metadata", None) or {}
        page_number = extract_page_number(metadata) or (index + 1)
        pages.append(ParsedPage(page_number=page_number, text=text))

    if not pages:
        raise RuntimeError(f"LlamaParse returned no text for {pdf_path.name}")

    print(f"  LlamaParse: {len(pages)} page document(s) parsed.")
    return pages


def is_markdown_table_line(line: str) -> bool:
    stripped = line.strip()
    return "|" in stripped and len(stripped) > 2


def is_note_like_block(text: str) -> bool:
    return bool(
        re.match(
            r"^(note|warning|caution|important|внимание|примечание)\b",
            text.strip(),
            re.IGNORECASE,
        )
    )


def split_heading(line: str) -> tuple[int, str] | None:
    match = re.match(r"^(#{1,6})\s+(.*)$", line.strip())
    if not match:
        return None
    return len(match.group(1)), match.group(2).strip()


def extract_document_title(source: str, pages: list[ParsedPage]) -> str:
    for page in pages[:3]:
        for line in page.text.splitlines():
            heading = split_heading(line)
            if heading and heading[0] == 1:
                return heading[1]
    return Path(source).stem.replace("_", " ")


def build_context_prefix(metadata: dict) -> str:
    document_title = metadata.get("document_title", "Unknown document")
    section_path = metadata.get("section_path", "General")
    page = metadata.get("page", "?")
    return (
        f"[Document: {document_title} -> Section: {section_path} -> "
        f"Page: {page} -> Block: {metadata.get('block_type', 'text')}]"
    )


def flush_block(
    blocks: list[Document],
    *,
    source: str,
    document_title: str,
    page_number: int,
    heading_stack: list[str],
    block_lines: list[str],
    block_type: str,
) -> None:
    text = "\n".join(block_lines).strip()
    if not text:
        return

    min_chars = 20 if block_type == "table" else MIN_BLOCK_CHARS
    min_words = 3 if block_type == "table" else MIN_BLOCK_WORDS
    if not is_meaningful_text(text, min_chars=min_chars, min_words=min_words):
        return

    section_path = " -> ".join(heading_stack) if heading_stack else "General"
    metadata = {
        "source": source,
        "document_title": document_title,
        "section_path": section_path,
        "page": page_number,
        "block_type": block_type,
    }

    blocks.append(Document(text=text, metadata=metadata))


def build_contextual_documents(source: str, pages: list[ParsedPage]) -> list[Document]:
    document_title = extract_document_title(source, pages)
    heading_stack: list[str] = [document_title]
    blocks: list[Document] = []

    for page in pages:
        block_lines: list[str] = []
        block_type = "prose"

        def flush_current() -> None:
            nonlocal block_lines, block_type
            flush_block(
                blocks,
                source=source,
                document_title=document_title,
                page_number=page.page_number,
                heading_stack=heading_stack,
                block_lines=block_lines,
                block_type=block_type,
            )
            block_lines = []
            block_type = "prose"

        for raw_line in page.text.splitlines():
            line = raw_line.strip()
            if not line:
                flush_current()
                continue

            heading = split_heading(line)
            if heading:
                flush_current()
                level, title = heading
                relative_level = max(level - 1, 1)
                heading_stack = heading_stack[:relative_level]
                heading_stack.append(title)
                continue

            line_is_table = is_markdown_table_line(line)
            if line_is_table:
                if block_lines and block_type != "table":
                    flush_current()
                block_type = "table"
                block_lines.append(line)
                continue

            if block_type == "table":
                flush_current()

            block_type = "prose"
            block_lines.append(line)

        flush_current()

    merged: list[Document] = []
    for block in blocks:
        if (
            merged
            and merged[-1].metadata.get("page") == block.metadata.get("page")
            and merged[-1].metadata.get("section_path") == block.metadata.get("section_path")
            and merged[-1].metadata.get("block_type") == "table"
            and block.metadata.get("block_type") == "prose"
            and is_note_like_block(block.text)
        ):
            previous = merged[-1]
            merged[-1] = Document(
                text=f"{previous.text}\n\n{block.text}",
                metadata=previous.metadata,
            )
            continue
        merged.append(block)

    return merged


def chunk_documents(splitter: SentenceSplitter, documents: list[Document]) -> list[dict]:
    chunk_records: list[dict] = []

    for document in documents:
        prefix = build_context_prefix(document.metadata)
        block_type = str(document.metadata.get("block_type", "prose"))

        if block_type == "table":
            chunks = [document.text.strip()]
        else:
            nodes = splitter.get_nodes_from_documents([document])
            chunks = [node.text.strip() for node in nodes if node.text.strip()]

        for chunk in chunks:
            injected = f"{prefix}\n{chunk}".strip()
            if not is_meaningful_text(
                injected,
                min_chars=MIN_CHUNK_CHARS,
                min_words=MIN_CHUNK_WORDS,
            ):
                continue
            chunk_records.append(
                {
                    "content": injected,
                    "metadata": {
                        **document.metadata,
                        "context_prefix": prefix,
                        "char_count": len(injected),
                        "word_count": word_count(injected),
                        "embedding_model": EMBEDDING_MODEL,
                        "parser": "llama-parse",
                        "result_type": "markdown",
                        "chunk_size": CHUNK_SIZE,
                        "chunk_overlap": CHUNK_OVERLAP,
                    },
                }
            )
            print(
                "  Created chunk length "
                f"{len(injected)} chars, {word_count(injected)} words "
                f"(section={document.metadata.get('section_path')})."
            )

    return chunk_records


def embed_texts(client: OpenAI, texts: list[str]) -> list[list[float]]:
    if not texts:
        return []

    embeddings: list[list[float]] = []
    for start in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[start : start + EMBED_BATCH_SIZE]
        response = client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=batch,
            dimensions=EMBEDDING_DIMENSIONS,
        )
        embeddings.extend(item.embedding for item in response.data)

    return embeddings


def truncate_document_chunks(supabase: Client) -> None:
    print("Clearing document_chunks table...")
    deleted = 0
    while True:
        response = supabase.table("document_chunks").select("id").limit(INSERT_BATCH_SIZE).execute()
        ids = [row["id"] for row in (response.data or [])]
        if not ids:
            break
        supabase.table("document_chunks").delete().in_("id", ids).execute()
        deleted += len(ids)
    print(f"Cleared {deleted} row(s) from document_chunks.")


def insert_chunk_batches(supabase: Client, rows: list[dict]) -> None:
    for start in range(0, len(rows), INSERT_BATCH_SIZE):
        batch = rows[start : start + INSERT_BATCH_SIZE]
        supabase.table("document_chunks").insert(batch).execute()
        print(f"  Inserted {min(start + len(batch), len(rows))}/{len(rows)} chunks...")


def ingest_pdf(
    openai_client: OpenAI,
    supabase: Client,
    parser: LlamaParse,
    splitter: SentenceSplitter,
    pdf_path: Path,
) -> int:
    source = pdf_path.name
    print(f"Processing {source}...")

    pages = parse_pdf_markdown(parser, pdf_path)
    contextual_documents = build_contextual_documents(source, pages)
    if not contextual_documents:
        print(f"  Skipped {source}: no contextual blocks produced.")
        return 0

    print(f"  Built {len(contextual_documents)} contextual document block(s).")
    chunk_records = chunk_documents(splitter, contextual_documents)
    if not chunk_records:
        print(f"  Skipped {source}: no valid chunks produced.")
        return 0

    print(f"  Generated {len(chunk_records)} valid chunk(s).")
    embeddings = embed_texts(openai_client, [record["content"] for record in chunk_records])

    rows = []
    for index, (record, embedding) in enumerate(zip(chunk_records, embeddings, strict=True)):
        rows.append(
            {
                "content": record["content"],
                "embedding": embedding,
                "metadata": {
                    **record["metadata"],
                    "chunk_index": index,
                    "chunk_count": len(chunk_records),
                },
            }
        )

    insert_chunk_batches(supabase, rows)
    print(f"  Stored {len(rows)} contextual chunks from {source}.")
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


def delete_chunks_for_source(supabase: Client, source: str) -> int:
    print(f"Removing existing chunks for source={source}...")
    deleted = 0
    while True:
        response = (
            supabase.table("document_chunks")
            .select("id")
            .contains("metadata", {"source": source})
            .limit(INSERT_BATCH_SIZE)
            .execute()
        )
        ids = [row["id"] for row in (response.data or [])]
        if not ids:
            break
        supabase.table("document_chunks").delete().in_("id", ids).execute()
        deleted += len(ids)
    print(f"Removed {deleted} existing chunk(s) for {source}.")
    return deleted


def cleanup_uploaded_file() -> None:
    cleanup_path = os.getenv("INGEST_CLEANUP_PATH", "").strip()
    if not cleanup_path:
        return

    path = Path(cleanup_path)
    if path.exists():
        path.unlink()
        print(f"Removed temporary upload file: {path}")


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Ingest PDF documents into the RAG knowledge base.")
    parser.add_argument(
        "pdf_path",
        nargs="?",
        help="Optional path to a single PDF file. If omitted, ingest all PDFs from docs/.",
    )
    parser.add_argument(
        "--replace-source",
        action="store_true",
        help="Replace only chunks for the uploaded PDF source instead of truncating the full table.",
    )
    return parser


def ingest_single_pdf(pdf_path: Path, *, replace_source: bool) -> int:
    if not pdf_path.exists():
        raise RuntimeError(f"PDF not found: {pdf_path}")
    if pdf_path.suffix.lower() != ".pdf":
        raise RuntimeError(f"Only PDF files are supported: {pdf_path}")

    openai_client = OpenAI(api_key=require_env("OPENAI_API_KEY"))
    supabase_url = os.getenv("SUPABASE_URL", "").strip() or os.getenv("VITE_SUPABASE_URL", "").strip()
    if not supabase_url:
        raise RuntimeError("Missing required environment variable: SUPABASE_URL or VITE_SUPABASE_URL")
    supabase = create_client(supabase_url, require_env("SUPABASE_SECRET_KEY"))
    parser = create_llama_parser()
    splitter = create_splitter()

    if replace_source:
        delete_chunks_for_source(supabase, pdf_path.name)

    total_chunks = ingest_pdf(openai_client, supabase, parser, splitter, pdf_path)
    print(f"Done. Ingested {total_chunks} contextual chunks from {pdf_path.name}.")
    return 0 if total_chunks > 0 else 1


def main() -> int:
    load_dotenv()
    args = build_arg_parser().parse_args()

    require_env("OPENAI_API_KEY")
    require_env("LLAMA_CLOUD_API_KEY")
    require_env("SUPABASE_SECRET_KEY")

    if not DOCS_DIR.exists():
        DOCS_DIR.mkdir(parents=True, exist_ok=True)

    if args.pdf_path:
        pdf_path = Path(args.pdf_path).expanduser().resolve()
        return ingest_single_pdf(pdf_path, replace_source=args.replace_source)

    supabase_url = os.getenv("SUPABASE_URL", "").strip() or os.getenv("VITE_SUPABASE_URL", "").strip()
    if not supabase_url:
        raise RuntimeError("Missing required environment variable: SUPABASE_URL or VITE_SUPABASE_URL")

    pdf_files = collect_pdf_files()
    if not pdf_files:
        print(f"No PDF files found. Add files to {DOCS_DIR} or set INGEST_PDF_PATH in .env.")
        return 1

    openai_client = OpenAI(api_key=require_env("OPENAI_API_KEY"))
    supabase = create_client(supabase_url, require_env("SUPABASE_SECRET_KEY"))
    parser = create_llama_parser()
    splitter = create_splitter()

    truncate_document_chunks(supabase)

    total_chunks = 0
    for pdf_path in pdf_files:
        total_chunks += ingest_pdf(openai_client, supabase, parser, splitter, pdf_path)

    print(f"Done. Ingested {total_chunks} contextual chunks from {len(pdf_files)} PDF file(s).")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"ingest.py failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
    finally:
        cleanup_uploaded_file()
