import { Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadKnowledgePdf } from "@/lib/rag-upload";

export function RagUploadForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "queued" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setStatus("idle");
    setMessage(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFile) {
      setStatus("error");
      setMessage("Select a PDF file before uploading.");
      return;
    }

    if (!selectedFile.name.toLowerCase().endsWith(".pdf")) {
      setStatus("error");
      setMessage("Only .pdf documents are supported.");
      return;
    }

    setStatus("uploading");
    setMessage("Файл обрабатывается системой ИИ...");

    try {
      const result = await uploadKnowledgePdf(selectedFile);
      setStatus(result.mode === "stored" ? "queued" : "queued");
      setMessage(result.message);
      setSelectedFile(null);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    }
  }

  const isBusy = status === "uploading";

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <div className="mb-4 space-y-1">
        <h2 className="text-base font-semibold text-foreground">RAG knowledge upload</h2>
        <p className="text-sm text-muted-foreground">
          Upload a PDF manual to chunk, embed, and index it in the knowledge base.
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            disabled={isBusy}
            onChange={handleFileChange}
          />
          {selectedFile ? (
            <p className="text-xs text-muted-foreground">
              Selected: {selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)
            </p>
          ) : null}
        </div>

        <Button type="submit" disabled={isBusy || !selectedFile}>
          {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          {isBusy ? "Файл обрабатывается системой ИИ..." : "Загрузить в базу RAG"}
        </Button>
      </form>

      {message ? (
        <p
          className={
            status === "error"
              ? "mt-4 text-sm text-destructive"
              : "mt-4 text-sm text-muted-foreground"
          }
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}
