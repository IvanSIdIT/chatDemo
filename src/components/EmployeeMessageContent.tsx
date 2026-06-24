import { Download, FileText, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { fetchWorkerAttachmentDownloadUrl } from "@/lib/worker-attachment-upload";
import { parseWorkerPdfMessage } from "@/lib/worker-attachments";

const MESSAGE_PREVIEW_CHAR_LIMIT = 200;

export function EmployeeMessageContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const pdfAttachment = parseWorkerPdfMessage(content);

  if (pdfAttachment) {
    async function handleDownload() {
      setDownloading(true);
      setDownloadError(null);

      try {
        const signedUrl = await fetchWorkerAttachmentDownloadUrl(pdfAttachment.storagePath);
        window.open(signedUrl, "_blank", "noopener,noreferrer");
      } catch (error) {
        setDownloadError(error instanceof Error ? error.message : "Не удалось скачать PDF.");
      } finally {
        setDownloading(false);
      }
    }

    return (
      <div className="max-w-md space-y-2">
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">PDF от работника</p>
            <p className="truncate text-sm text-muted-foreground" title={pdfAttachment.fileName}>
              {pdfAttachment.fileName}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={downloading}
          onClick={() => void handleDownload()}
        >
          {downloading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Скачать PDF
        </Button>
        {downloadError ? <p className="text-xs text-destructive">{downloadError}</p> : null}
      </div>
    );
  }

  const isLong = content.length > MESSAGE_PREVIEW_CHAR_LIMIT;
  const preview = `${content.slice(0, MESSAGE_PREVIEW_CHAR_LIMIT).trimEnd()}…`;

  return (
    <div className="max-w-md space-y-1">
      <p className="whitespace-pre-wrap text-sm">{expanded || !isLong ? content : preview}</p>
      {isLong ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs text-primary"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Свернуть" : "Показать полностью"}
        </Button>
      ) : null}
    </div>
  );
}
