import { FileText, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  deleteAllIngestedDocuments,
  deleteIngestedDocument,
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
  const [pendingDelete, setPendingDelete] = useState<IngestedDocument | null>(null);
  const [pendingDeleteAll, setPendingDeleteAll] = useState(false);
  const [deletingSource, setDeletingSource] = useState<string | null>(null);
  const isBusyDeleting = deletingSource !== null;

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

  async function handleConfirmDelete() {
    if (!pendingDelete) {
      return;
    }

    const source = pendingDelete.source;
    setDeletingSource(source);
    setError(null);

    try {
      await deleteIngestedDocument(source);
      setDocuments((current) => current.filter((document) => document.source !== source));
      setPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить документ.");
    } finally {
      setDeletingSource(null);
    }
  }

  async function handleConfirmDeleteAll() {
    setDeletingSource("__all__");
    setError(null);

    try {
      await deleteAllIngestedDocuments();
      setDocuments([]);
      setPendingDeleteAll(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить все документы.");
    } finally {
      setDeletingSource(null);
    }
  }

  return (
    <>
      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">Загруженные инструкции</h2>
            <p className="text-xs text-muted-foreground">
              PDF, проиндексированные в базе знаний RAG.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {documents.length > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={isLoading || isRefreshing || isBusyDeleting}
                onClick={() => setPendingDeleteAll(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Удалить все
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLoading || isRefreshing || isBusyDeleting}
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
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка списка документов...
          </div>
        ) : error && documents.length === 0 ? (
          <div className="px-4 py-8 text-sm text-destructive">{error}</div>
        ) : documents.length === 0 ? (
          <div className="px-4 py-8 text-sm text-muted-foreground">
            Пока нет проиндексированных PDF. Загрузите инструкцию через форму выше.
          </div>
        ) : (
          <>
            {error ? <div className="border-b border-border px-4 py-3 text-sm text-destructive">{error}</div> : null}
            <ul className="divide-y divide-border">
              {documents.map((document) => {
                const isDeleting = deletingSource === document.source;

                return (
                  <li key={document.source} className="flex gap-3 px-4 py-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                      <FileText className="h-4 w-4 text-primary" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm font-medium text-foreground" title={document.source}>
                        {document.source}
                      </p>
                      {document.documentTitle && document.documentTitle !== document.source ? (
                        <p
                          className="truncate text-xs text-muted-foreground"
                          title={document.documentTitle}
                        >
                          {document.documentTitle}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>Чанков: {document.chunkCount}</span>
                        <span>Размер: {formatDocumentSize(document.storageSizeBytes)}</span>
                        <span>Индекс: {formatIngestedAt(document.lastIngestedAt)}</span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={isBusyDeleting}
                      aria-label={`Удалить ${document.source}`}
                      onClick={() => setPendingDelete(document)}
                    >
                      {isDeleting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && deletingSource === null) {
            setPendingDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить инструкцию?</AlertDialogTitle>
            <AlertDialogDescription>
              Файл <span className="font-medium text-foreground">{pendingDelete?.source}</span> будет
              удалён из базы знаний RAG вместе со всеми чанками
              {pendingDelete ? ` (${pendingDelete.chunkCount})` : ""}. PDF в хранилище также будет
              удалён, если он там есть.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusyDeleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isBusyDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDelete();
              }}
            >
              {deletingSource && deletingSource !== "__all__" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Удаление...
                </>
              ) : (
                "Удалить"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDeleteAll}
        onOpenChange={(open) => {
          if (!open && !isBusyDeleting) {
            setPendingDeleteAll(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить все инструкции?</AlertDialogTitle>
            <AlertDialogDescription>
              Будут удалены все {documents.length} PDF из базы знаний RAG вместе со всеми чанками и
              файлами в хранилище. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBusyDeleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isBusyDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDeleteAll();
              }}
            >
              {deletingSource === "__all__" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Удаление...
                </>
              ) : (
                "Удалить все"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
