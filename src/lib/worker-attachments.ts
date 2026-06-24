export const WORKER_PDF_MESSAGE_PREFIX = "[Worker PDF]";

export const MAX_WORKER_PDF_BYTES = 20 * 1024 * 1024;

export type WorkerPdfAttachment = {
  fileName: string;
  storagePath: string;
};

export function formatWorkerPdfMessage(attachment: WorkerPdfAttachment): string {
  return `${WORKER_PDF_MESSAGE_PREFIX} ${attachment.fileName}\nstorage:${attachment.storagePath}`;
}

export function parseWorkerPdfMessage(content: string): WorkerPdfAttachment | null {
  if (!content.startsWith(`${WORKER_PDF_MESSAGE_PREFIX} `)) {
    return null;
  }

  const lines = content.split(/\r?\n/);
  const header = lines[0]?.slice(WORKER_PDF_MESSAGE_PREFIX.length).trim() ?? "";
  const storageLine = lines.find((line) => line.startsWith("storage:"));
  const storagePath = storageLine?.slice("storage:".length).trim() ?? "";

  if (!header || !storagePath.startsWith("attachments/")) {
    return null;
  }

  return {
    fileName: header,
    storagePath,
  };
}

export function isWorkerPdfMessage(content: string): boolean {
  return parseWorkerPdfMessage(content) !== null;
}

export function sanitizeWorkerPdfFilename(filename: string): string {
  const baseName = filename.split(/[/\\]/).pop() ?? "document.pdf";
  const normalized = baseName.replace(/[^\w.\-()+\s]/g, "_").trim();
  return normalized.toLowerCase().endsWith(".pdf") ? normalized : `${normalized}.pdf`;
}

export function isValidWorkerAttachmentPath(storagePath: string, employeeId: string): boolean {
  if (!storagePath.startsWith(`attachments/${employeeId}/`)) {
    return false;
  }

  if (storagePath.includes("..") || storagePath.includes("\\")) {
    return false;
  }

  return storagePath.toLowerCase().endsWith(".pdf");
}
