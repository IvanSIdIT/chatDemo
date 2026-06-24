FROM python:3.11-slim

WORKDIR /app

COPY requirements-ingest.txt ingest.py ./
COPY workers/requirements-worker.txt workers/ingest_http_server.py workers/__init__.py ./workers/

RUN pip install --no-cache-dir -r requirements-ingest.txt -r workers/requirements-worker.txt

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

EXPOSE 8000

CMD ["sh", "-c", "uvicorn workers.ingest_http_server:app --host 0.0.0.0 --port ${PORT:-8000}"]
