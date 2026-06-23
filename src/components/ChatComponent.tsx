import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";

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

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function ChatComponent() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: async () => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          return token ? { Authorization: `Bearer ${token}` } : {};
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
  }, [messages, status]);

  const isLoading = status === "submitted" || status === "streaming";
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
    if (!text || isLoading) {
      return;
    }

    void sendMessage({ text });
    setInput("");
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
          {error ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : null}
          <div className="flex items-center gap-2">
            <Input
              value={input}
              onChange={handleInputChange}
              placeholder="Type a message"
              autoComplete="off"
              disabled={isLoading}
            />
            <Button type="submit" disabled={!input.trim() || isLoading}>
              {isLoading ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
