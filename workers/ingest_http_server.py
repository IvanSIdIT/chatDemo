import os
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI()


class IngestRequest(BaseModel):
    jobId: str
    storagePath: str
    fileName: str
    signedUrl: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/ingest")
def ingest(
    payload: IngestRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    secret = os.getenv("INGEST_WORKER_SECRET", "").strip()
    if not secret or authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    project_root = Path(__file__).resolve().parents[1]
    ingest_script = project_root / "ingest.py"
    if not ingest_script.exists():
        raise HTTPException(status_code=500, detail="ingest.py was not found in the worker image.")

    with tempfile.TemporaryDirectory() as temp_dir:
        pdf_path = Path(temp_dir) / payload.fileName
        response = httpx.get(payload.signedUrl, timeout=120.0)
        response.raise_for_status()
        pdf_path.write_bytes(response.content)

        result = subprocess.run(
            [sys.executable, str(ingest_script), str(pdf_path), "--replace-source"],
            cwd=str(project_root),
            capture_output=True,
            text=True,
            env=os.environ.copy(),
            check=False,
        )

        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=(result.stderr or result.stdout or "ingest.py failed")[:1000],
            )

    return {
        "status": "completed",
        "jobId": payload.jobId,
        "storagePath": payload.storagePath,
    }
