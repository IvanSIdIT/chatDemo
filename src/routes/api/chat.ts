import { openai } from "@ai-sdk/openai";
import { createFileRoute } from "@tanstack/react-router";
import {
  propagateAttributes,
  startActiveObservation,
  updateActiveObservation,
} from "@langfuse/tracing";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

import {
  getLastUserMessage,
  getUIMessageText,
  saveEmployeeMessage,
} from "@/lib/chat-persistence";
import { ensureLangfuseTracing, flushLangfuse, isLangfuseEnabled } from "@/lib/langfuse";
import { buildRagSystemPrompt, retrieveChunks, type MatchedChunk } from "@/lib/rag";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
  getAccessTokenFromRequest,
} from "@/lib/supabase-server";

const CHAT_SESSION_HEADER = "x-chat-session-id";

type AuthenticatedUser = {
  id: string;
  email: string | null;
};

function summarizeChunksForTracing(chunks: MatchedChunk[]) {
  return chunks.map((chunk) => ({
    id: chunk.id,
    similarity: Number(chunk.similarity.toFixed(4)),
    section: chunk.metadata?.section_path ?? null,
    page: chunk.metadata?.page ?? null,
    blockType: chunk.metadata?.block_type ?? null,
    preview: chunk.content.slice(0, 400),
  }));
}

function getChatSessionId(request: Request, userId: string): string {
  const headerValue = request.headers.get(CHAT_SESSION_HEADER)?.trim();
  if (headerValue) {
    return headerValue.slice(0, 200);
  }

  return `user:${userId}`.slice(0, 200);
}

async function authenticateRequest(request: Request): Promise<
  | { ok: true; user: AuthenticatedUser; accessToken: string }
  | { ok: false; response: Response }
> {
  const accessToken = getAccessTokenFromRequest(request);
  if (!accessToken) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  const supabase = createSupabaseServerClient(accessToken);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  return {
    ok: true,
    user: { id: user.id, email: user.email ?? null },
    accessToken,
  };
}

async function retrieveChunksWithTracing(
  userText: string,
): Promise<{ chunks: MatchedChunk[]; ragSystemPrompt: string; ragError?: string }> {
  const retrieve = async () => {
    try {
      const ragSupabase = createSupabaseServiceClient();
      const chunks = await retrieveChunks(ragSupabase, userText, {
        rpcThreshold: 0,
        appThreshold: Number(process.env.RAG_MATCH_THRESHOLD ?? "0.3"),
        limit: Number(process.env.RAG_SIMILARITY_TOP_K ?? "8"),
        candidatesPerQuery: Number(process.env.RAG_NUM_CHUNKS_PER_QUERY ?? "10"),
        logLabel: "[api/chat]",
      });

      return {
        chunks,
        ragSystemPrompt: buildRagSystemPrompt(chunks),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "RAG retrieval failed.";
      return {
        chunks: [],
        ragSystemPrompt: buildRagSystemPrompt([]),
        ragError: message,
      };
    }
  };

  if (!isLangfuseEnabled()) {
    return retrieve();
  }

  return startActiveObservation(
    "rag-retrieval",
    async (retriever) => {
      retriever.update({
        input: { query: userText },
        metadata: {
          hybridEnabled: process.env.RAG_ENABLE_HYBRID ?? "true",
          topK: String(process.env.RAG_SIMILARITY_TOP_K ?? "8"),
          candidatesPerQuery: String(process.env.RAG_NUM_CHUNKS_PER_QUERY ?? "10"),
        },
      });

      const result = await retrieve();

      retriever.update({
        level: result.ragError ? "ERROR" : "DEFAULT",
        statusMessage: result.ragError,
        output: {
          chunkCount: result.chunks.length,
          chunks: summarizeChunksForTracing(result.chunks),
          hasContext: result.chunks.length > 0,
        },
        metadata: {
          promptLength: String(result.ragSystemPrompt.length),
        },
      });

      return result;
    },
    { asType: "retriever" },
  );
}

async function handleChatRequest(
  request: Request,
  auth: { user: AuthenticatedUser; accessToken: string },
): Promise<Response> {
  if (!process.env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured on the server." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createSupabaseServerClient(auth.accessToken);
  const { messages }: { messages: UIMessage[] } = await request.json();
  const lastUserMessage = getLastUserMessage(messages);
  const userText = lastUserMessage ? getUIMessageText(lastUserMessage) : "";
  const sessionId = getChatSessionId(request, auth.user.id);

  const runChat = async (): Promise<Response> => {
    if (isLangfuseEnabled()) {
      updateActiveObservation({
        input: { query: userText, messageCount: messages.length },
      });
    }

    if (userText) {
      try {
        await saveEmployeeMessage(supabase, userText, "pending");
      } catch (error) {
        console.error("[api/chat] failed to save user message:", error);
        return new Response(JSON.stringify({ error: "Failed to save employee message." }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const modelMessages = await convertToModelMessages(messages);
    let ragSystemPrompt: string | undefined;
    let retrievedChunkCount = 0;
    let ragError: string | undefined;

    if (userText) {
      const ragResult = await retrieveChunksWithTracing(userText);
      retrievedChunkCount = ragResult.chunks.length;
      ragSystemPrompt = ragResult.ragSystemPrompt;
      ragError = ragResult.ragError;

      console.log("[api/chat] Final RAG chunks used:", retrievedChunkCount);
      if (ragError) {
        console.error("[api/chat] RAG retrieval failed:", ragError);
      }
    }

    const result = streamText({
      model: openai("gpt-4o"),
      system: ragSystemPrompt,
      messages: modelMessages,
      experimental_telemetry: {
        isEnabled: isLangfuseEnabled(),
        functionId: "factory-chat-generation",
        metadata: {
          sessionId,
          retrievedChunkCount: String(retrievedChunkCount),
          ragError: ragError ?? "",
          hasRagContext: String(retrievedChunkCount > 0),
        },
      },
      onFinish: async ({ text, usage, finishReason }) => {
        if (isLangfuseEnabled()) {
          updateActiveObservation({
            output: {
              text,
              finishReason,
              usage,
              retrievedChunkCount,
              hasRagContext: retrievedChunkCount > 0,
            },
          });
        }

        await flushLangfuse();
      },
    });

    return result.toUIMessageStreamResponse({
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  };

  if (!isLangfuseEnabled()) {
    return runChat();
  }

  return propagateAttributes(
    {
      userId: auth.user.id,
      sessionId,
      traceName: "factory-chat",
      tags: ["factory-chat", "rag"],
      metadata: {
        feature: "worker-chat",
        route: "/api/chat",
      },
    },
    () =>
      startActiveObservation(
        "factory-chat",
        async (span) => {
          const response = await runChat();

          span.update({
            output: {
              status: response.status,
              ok: response.ok,
            },
          });

          return response;
        },
        { asType: "chain" },
      ),
  );
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        ensureLangfuseTracing();

        try {
          const auth = await authenticateRequest(request);
          if (!auth.ok) {
            return auth.response;
          }

          return await handleChatRequest(request, auth);
        } catch (error) {
          console.error("[api/chat] POST failed:", error);
          await flushLangfuse();
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
