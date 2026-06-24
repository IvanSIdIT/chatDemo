import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ingestScript = join(projectRoot, "ingest.py");
const uploadsDir = join(projectRoot, "uploads", "rag");
const ingestLogsDir = join(projectRoot, "logs", "ingest");

const MAX_PDF_BYTES = 80 * 1024 * 1024;

export type IngestJobInfo = {
  jobId: string;
  logPath: string;
  pdfPath: string;
};

export function isIngestRuntimeAvailable(): boolean {
  return process.env.VERCEL !== "1" && resolvePythonCommand() !== null;
}

export function getUploadsDirectory(): string {
  return uploadsDir;
}

function resolvePythonCommand(): { command: string; prefixArgs: string[] } | null {
  const windowsPython = join(
    process.env.LOCALAPPDATA ?? "",
    "Programs",
    "Python",
    "Python311",
    "python.exe",
  );

  if (process.env.PYTHON_PATH && existsSync(process.env.PYTHON_PATH)) {
    return { command: process.env.PYTHON_PATH, prefixArgs: [] };
  }

  if (process.platform === "win32" && existsSync(windowsPython)) {
    return { command: windowsPython, prefixArgs: [] };
  }

  if (process.platform === "win32") {
    return { command: "py", prefixArgs: ["-3"] };
  }

  return { command: "python3", prefixArgs: [] };
}

export function sanitizePdfFilename(filename: string): string {
  const baseName = filename.split(/[/\\]/).pop() ?? "document.pdf";
  const normalized = baseName.replace(/[^\w.\-()+\s]/g, "_").trim();
  return normalized.toLowerCase().endsWith(".pdf") ? normalized : `${normalized}.pdf`;
}

export async function saveUploadedPdf(file: File): Promise<{ absolutePath: string; fileName: string }> {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Only PDF files are supported.");
  }

  if (file.type && file.type !== "application/pdf") {
    throw new Error("Invalid file type. Upload a PDF document.");
  }

  if (file.size <= 0) {
    throw new Error("The uploaded file is empty.");
  }

  if (file.size > MAX_PDF_BYTES) {
    throw new Error("PDF is too large. Maximum allowed size is 80 MB.");
  }

  mkdirSync(uploadsDir, { recursive: true });

  const fileName = sanitizePdfFilename(file.name);
  const absolutePath = join(uploadsDir, `${Date.now()}-${randomUUID()}-${fileName}`);
  const readable = Readable.fromWeb(file.stream() as never);
  await pipeline(readable, createWriteStream(absolutePath));

  return { absolutePath, fileName };
}

export function queueIngestJob(pdfPath: string): IngestJobInfo {
  const python = resolvePythonCommand();
  if (!python) {
    throw new Error(
      "Python is not available on the server. Install Python 3.11+ or set PYTHON_PATH.",
    );
  }

  mkdirSync(ingestLogsDir, { recursive: true });

  const jobId = randomUUID();
  const logPath = join(ingestLogsDir, `${jobId}.log`);
  const logStream = createWriteStream(logPath, { flags: "a" });
  logStream.write(`[ingest] queued ${pdfPath}\n`);

  const args = [
    ...python.prefixArgs,
    ingestScript,
    pdfPath,
    "--replace-source",
  ];

  const child = spawn(python.command, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      INGEST_CLEANUP_PATH: pdfPath,
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    logStream.write(chunk);
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    logStream.write(chunk);
  });

  child.on("error", (error) => {
    logStream.write(`[ingest] spawn error: ${error.message}\n`);
    logStream.end();
  });

  child.on("close", (code) => {
    logStream.write(`[ingest] finished with code ${code ?? "unknown"}\n`);
    logStream.end();
  });

  child.unref();

  return { jobId, logPath, pdfPath };
}
