import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { FileText, Loader2, Paperclip } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { uploadWorkerPdfAttachment } from "@/lib/worker-attachment-upload";

const CHAT_SESSION_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `chat-${Date.now()}`;

const WELCOME_MESSAGE: UIMessage = {
  id: "welcome",
  role: "assistant",
  parts: [
    {
      type: "text",
      text: "Hello. Describe the issue you are observing on the line.",
    },
  ],
};

type SentPdfMessage = {
  id: string;
  fileName: string;
};

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function ChatComponent() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [sentPdfMessages, setSentPdfMessages] = useState<SentPdfMessage[]>([]);
  const [pdfUploadError, setPdfUploadError] = useState<string | null>(null);
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: async () => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          return token
            ? {
                Authorization: `Bearer ${token}`,
                "X-Chat-Session-Id": CHAT_SESSION_ID,
              }
            : {
                "X-Chat-Session-Id": CHAT_SESSION_ID,
              };
        },
      }),
    [],
  );
  const { messages, sendMessage, status, error } = useChat({
    messages: [WELCOME_MESSAGE],
    transport,
    onError: (chatError) => {
      console.error("[chat] useChat error:", {
        message: chatError.message,
        name: chatError.name,
        stack: chatError.stack,
      });
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sentPdfMessages, status, isUploadingPdf]);

  const isLoading = status === "submitted" || status === "streaming";
  const isBusy = isLoading || isUploadingPdf;
  const lastMessage = messages.at(-1);
  const isAssistantGenerating =
    isLoading &&
    (status === "submitted" ||
      (lastMessage?.role === "assistant" && status === "streaming"));

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    setInput(event.target.value);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isBusy) {
      return;
    }

    void sendMessage({ text });
    setInput("");
  }

  async function handlePdfSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setPdfUploadError("Можно отправить только PDF-файл.");
      event.target.value = "";
      return;
    }

    setIsUploadingPdf(true);
    setPdfUploadError(null);

    try {
      const message = await uploadWorkerPdfAttachment(file);
      setSentPdfMessages((current) => [
        ...current,
        { id: message.id, fileName: file.name },
      ]);
    } catch (uploadError) {
      setPdfUploadError(
        uploadError instanceof Error ? uploadError.message : "Не удалось отправить PDF.",
      );
    } finally {
      setIsUploadingPdf(false);
      event.target.value = "";
    }
  }

  return (
    <>
      <div
        ref={scrollRef}
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-3 overflow-y-auto px-4 py-6 sm:px-6"
      >
        {messages.map((message, index) => {
          const text = getMessageText(message);
          const isUser = message.role === "user";
          const isLast = index === messages.length - 1;
          const isStreamingThisMessage =
            isLast && message.role === "assistant" && status === "streaming";

          if (!text && !isStreamingThisMessage && !isUser) {
            return null;
          }

          return (
            <div
              key={message.id}
              className={
                isUser
                  ? "ml-auto max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                  : "mr-auto max-w-[80%] text-sm text-foreground"
              }
            >
              {text}
              {isStreamingThisMessage && !text ? (
                <span className="text-muted-foreground">Печатает...</span>
              ) : null}
              {isStreamingThisMessage && text ? (
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current align-middle" />
              ) : null}
            </div>
          );
        })}

        {sentPdfMessages.map((pdfMessage) => (
          <div
            key={pdfMessage.id}
            className="ml-auto max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
          >
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{pdfMessage.fileName}</span>
            </div>
            <p className="mt-1 text-xs text-primary-foreground/80">PDF отправлен менеджеру</p>
          </div>
        ))}

        {isUploadingPdf ? (
          <div className="ml-auto flex max-w-[80%] items-center gap-2 rounded-lg bg-primary/90 px-3 py-2 text-sm text-primary-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Отправка PDF менеджеру...
          </div>
        ) : null}

        {isAssistantGenerating && lastMessage?.role === "user" ? (
          <div className="mr-auto max-w-[80%] text-sm text-muted-foreground">
            Печатает...
          </div>
        ) : null}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-border bg-card px-4 py-3 sm:px-6"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
          {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
          {pdfUploadError ? <p className="text-sm text-destructive">{pdfUploadError}</p> : null}
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              disabled={isBusy}
              onChange={(event) => void handlePdfSelected(event)}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={isBusy}
              aria-label="Отправить PDF менеджеру"
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploadingPdf ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </Button>
            <Input
              value={input}
              onChange={handleInputChange}
              placeholder="Type a message"
              autoComplete="off"
              disabled={isBusy}
            />
            <Button type="submit" disabled={!input.trim() || isBusy}>
              {isLoading ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
