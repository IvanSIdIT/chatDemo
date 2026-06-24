import { openai } from "@ai-sdk/openai";
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

import {
  getLastUserMessage,
  getUIMessageText,
  saveEmployeeMessage,
} from "@/lib/chat-persistence";
import { buildRagSystemPrompt, retrieveChunks } from "@/lib/rag";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
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

          const modelMessages = await convertToModelMessages(messages);
          let ragSystemPrompt: string | undefined;

          if (userText) {
            try {
              const ragSupabase = createSupabaseServiceClient();
              const chunks = await retrieveChunks(ragSupabase, userText, {
                rpcThreshold: 0,
                appThreshold: Number(process.env.RAG_MATCH_THRESHOLD ?? "0.35"),
                limit: Number(process.env.RAG_SIMILARITY_TOP_K ?? "6"),
                logLabel: "[api/chat]",
              });

              console.log("[api/chat] Final RAG chunks used:", chunks.length);
              ragSystemPrompt = buildRagSystemPrompt(chunks);
            } catch (ragError) {
              console.error("[api/chat] RAG retrieval failed:", ragError);
              ragSystemPrompt = buildRagSystemPrompt([]);
            }
          }

          const result = streamText({
            model: openai("gpt-4o"),
            system: ragSystemPrompt,
            messages: modelMessages,
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
