import { FileText, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  fetchIngestedDocuments,
  formatDocumentSize,
  formatIngestedAt,
  type IngestedDocument,
} from "@/lib/ingested-documents";

export function IngestedDocumentsList() {
  const [documents, setDocuments] = useState<IngestedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDocuments = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "initial") {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const rows = await fetchIngestedDocuments();
      setDocuments(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить список документов.");
    } finally {
      if (mode === "initial") {
        setIsLoading(false);
      } else {
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadDocuments("initial");
  }, [loadDocuments]);

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">Загруженные инструкции</h2>
          <p className="text-xs text-muted-foreground">
            PDF, проиндексированные в базе знаний RAG.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isLoading || isRefreshing}
          onClick={() => void loadDocuments("refresh")}
        >
          {isRefreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Обновить
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка списка документов...
        </div>
      ) : error ? (
        <div className="px-4 py-8 text-sm text-destructive">{error}</div>
      ) : documents.length === 0 ? (
        <div className="px-4 py-8 text-sm text-muted-foreground">
          Пока нет проиндексированных PDF. Загрузите инструкцию через форму выше.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {documents.map((document) => (
            <li key={document.source} className="flex gap-3 px-4 py-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <FileText className="h-4 w-4 text-primary" aria-hidden />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm font-medium text-foreground" title={document.source}>
                  {document.source}
                </p>
                {document.documentTitle && document.documentTitle !== document.source ? (
                  <p className="truncate text-xs text-muted-foreground" title={document.documentTitle}>
                    {document.documentTitle}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>Чанков: {document.chunkCount}</span>
                  <span>Размер: {formatDocumentSize(document.storageSizeBytes)}</span>
                  <span>Индекс: {formatIngestedAt(document.lastIngestedAt)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
