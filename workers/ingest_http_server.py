import logging
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
app = FastAPI()


class IngestRequest(BaseModel):
    jobId: str
    storagePath: str
    fileName: str
    signedUrl: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _run_ingest_job(payload: IngestRequest) -> None:
    project_root = Path(__file__).resolve().parents[1]
    ingest_script = project_root / "ingest.py"

    logger.info("Starting ingest job %s for %s", payload.jobId, payload.storagePath)

    try:
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
                detail = (result.stderr or result.stdout or "ingest.py failed")[:2000]
                logger.error("Ingest job %s failed: %s", payload.jobId, detail)
                return

        logger.info("Ingest job %s completed for %s", payload.jobId, payload.storagePath)
    except Exception:
        logger.exception("Ingest job %s crashed", payload.jobId)


@app.post("/ingest", status_code=202)
def ingest(
    payload: IngestRequest,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
) -> dict[str, str]:
    secret = os.getenv("INGEST_WORKER_SECRET", "").strip()
    if not secret or authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    project_root = Path(__file__).resolve().parents[1]
    ingest_script = project_root / "ingest.py"
    if not ingest_script.exists():
        raise HTTPException(status_code=500, detail="ingest.py was not found in the worker image.")

    background_tasks.add_task(_run_ingest_job, payload)

    return {
        "status": "queued",
        "jobId": payload.jobId,
        "storagePath": payload.storagePath,
    }
