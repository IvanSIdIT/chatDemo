import { openai } from "@ai-sdk/openai";
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

import {
  getLastUserMessage,
  getUIMessageText,
  saveEmployeeMessage,
} from "@/lib/chat-persistence";
import {
  createSupabaseServerClient,
  getAccessTokenFromRequest,
} from "@/lib/supabase-server";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!process.env.OPENAI_API_KEY) {
            return new Response(
              JSON.stringify({ error: "OPENAI_API_KEY is not configured on the server." }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }

          const accessToken = getAccessTokenFromRequest(request);
          if (!accessToken) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          const supabase = createSupabaseServerClient(accessToken);
          const {
            data: { user },
            error: authError,
          } = await supabase.auth.getUser();

          if (authError || !user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }

          const { messages }: { messages: UIMessage[] } = await request.json();
          const lastUserMessage = getLastUserMessage(messages);
          const userText = lastUserMessage ? getUIMessageText(lastUserMessage) : "";

          if (userText) {
            try {
              await saveEmployeeMessage(supabase, userText, "pending");
            } catch (error) {
              console.error("[api/chat] failed to save user message:", error);
              return new Response(
                JSON.stringify({ error: "Failed to save employee message." }),
                { status: 500, headers: { "Content-Type": "application/json" } },
              );
            }
          }

          const result = streamText({
            model: openai("gpt-4o"),
            messages: await convertToModelMessages(messages),
          });

          return result.toUIMessageStreamResponse({
            headers: {
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
              "X-Accel-Buffering": "no",
            },
          });
        } catch (error) {
          console.error("[api/chat] POST failed:", error);
          return new Response(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Chat request failed.",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
