import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

import type { ActionPlanStatus } from "@/lib/database.types";
import {
  isMissingActionPlanColumnsError,
} from "@/lib/employee-message-fields";
import { extractPdfText } from "@/lib/pdf-text";
import { retrieveChunks, type MatchedChunk } from "@/lib/rag";
import { createSupabaseServiceClient } from "@/lib/supabase-server";
import { EMPLOYEE_ATTACHMENTS_BUCKET } from "@/lib/worker-attachment-storage";
import { parseWorkerPdfMessage } from "@/lib/worker-attachments";

export type { ActionPlanStatus };

const MAX_REPORT_CHARS_FOR_PROMPT = 12_000;
const MAX_REPORT_CHARS_FOR_RAG_QUERY = 4_000;

export function buildIncidentActionPlanPrompt(
  chunks: MatchedChunk[],
  reportText: string,
): string {
  const instructionContext =
    chunks.length === 0
      ? "В базе инструкций не найдено релевантных фрагментов. Составьте план на основе отчёта, явно укажите, что процедуры из инструкций недоступны, и рекомендуйте эскалацию менеджеру."
      : chunks
          .map(
            (chunk, index) =>
              `[${index + 1}] (релевантность=${chunk.similarity.toFixed(3)})\n${chunk.content}`,
          )
          .join("\n\n");

  return [
    "Вы — помощник менеджера производственной линии.",
    "Составьте чёткий план действий для менеджера по отчёту работника об ошибке или неполадке.",
    "План должен быть на русском языке, с нумерованными шагами.",
    "Сначала — меры безопасности и остановка риска, затем диагностика, устранение и контроль.",
    "Опирайтесь на факты из отчёта и на фрагменты инструкций ниже.",
    "Если в инструкциях есть конкретные процедуры, лимиты или требования — включите их в план.",
    "Не выдумывайте детали, которых нет в отчёте или инструкциях.",
    "Если данных недостаточно, укажите, какую информацию нужно уточнить у работника.",
    "Не используйте markdown-заголовки — только нумерованный список шагов.",
    "",
    "Фрагменты инструкций:",
    instructionContext,
    "",
    "Текст отчёта (для справки):",
    reportText.slice(0, MAX_REPORT_CHARS_FOR_PROMPT),
  ].join("\n");
}

export async function markActionPlanGenerating(messageId: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("employee_messages")
    .update({ action_plan_status: "generating" })
    .eq("id", messageId);

  if (error && isMissingActionPlanColumnsError(error)) {
    return;
  }

  if (error) {
    throw error;
  }
}

export async function generateIncidentActionPlan(messageId: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured on the server.");
  }

  const supabase = createSupabaseServiceClient();

  const { data: message, error: messageError } = await supabase
    .from("employee_messages")
    .select("id, content, action_plan_status")
    .eq("id", messageId)
    .single();

  if (messageError || !message) {
    throw new Error(messageError?.message ?? "Message not found.");
  }

  const attachment = parseWorkerPdfMessage(message.content);
  if (!attachment) {
    throw new Error("Message is not a worker PDF incident report.");
  }

  await markActionPlanGenerating(messageId);

  try {
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(EMPLOYEE_ATTACHMENTS_BUCKET)
      .download(attachment.storagePath);

    if (downloadError || !fileData) {
      throw new Error(downloadError?.message ?? "Failed to download incident PDF.");
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    const reportText = await extractPdfText(buffer);

    if (!reportText) {
      throw new Error("Could not extract text from the incident PDF.");
    }

    const ragQuery = reportText.slice(0, MAX_REPORT_CHARS_FOR_RAG_QUERY);
    const chunks = await retrieveChunks(supabase, ragQuery, {
      logLabel: "[action-plan]",
    });

    const systemPrompt = buildIncidentActionPlanPrompt(chunks, reportText);

    const { text } = await generateText({
      model: openai("gpt-4o"),
      system: systemPrompt,
      prompt:
        "Составьте план действий для менеджера по этому отчёту. Ответ — только нумерованный список шагов на русском языке.",
    });

    const actionPlan = text.trim();
    if (!actionPlan) {
      throw new Error("Action plan generation returned empty text.");
    }

    const { error: updateError } = await supabase
      .from("employee_messages")
      .update({
        action_plan: actionPlan,
        action_plan_status: "ready",
      })
      .eq("id", messageId);

    if (updateError) {
      throw updateError;
    }

    return actionPlan;
  } catch (error) {
    console.error("[action-plan] generation failed:", error);

    await supabase
      .from("employee_messages")
      .update({ action_plan_status: "failed" })
      .eq("id", messageId);

    throw error;
  }
}

export function triggerIncidentActionPlanGeneration(requestUrl: string, messageId: string): void {
  const secret = process.env.INGEST_WORKER_SECRET?.trim();
  if (!secret) {
    console.warn("[action-plan] INGEST_WORKER_SECRET is not set; skipping background generation.");
    return;
  }

  const endpoint = new URL("/api/internal/generate-action-plan", new URL(requestUrl).origin);

  void fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messageId }),
  }).catch((error) => {
    console.error("[action-plan] failed to trigger background generation:", error);
  });
}

export function verifyInternalApiSecret(request: Request): boolean {
  const secret = process.env.INGEST_WORKER_SECRET?.trim();
  if (!secret) {
    return false;
  }

  const authorization = request.headers.get("Authorization")?.trim() ?? "";
  return authorization === `Bearer ${secret}`;
}
