import type { SupabaseClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";

import type { Database, MessageStatus } from "./database.types";
import {
  EMPLOYEE_MESSAGE_SELECT,
  EMPLOYEE_MESSAGE_SELECT_LEGACY,
  isMissingActionPlanColumnsError,
  normalizeEmployeeMessage,
} from "./employee-message-fields";

type ServerSupabase = SupabaseClient<Database>;

export function getUIMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function getLastUserMessage(messages: UIMessage[]): UIMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index];
    }
  }

  return undefined;
}

export async function saveEmployeeMessage(
  supabase: ServerSupabase,
  content: string,
  status: MessageStatus = "pending",
) {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const { data, error } = await supabase
    .from("employee_messages")
    .insert({
      content: trimmed,
      status,
    })
    .select(EMPLOYEE_MESSAGE_SELECT)
    .single();

  if (error && isMissingActionPlanColumnsError(error)) {
    const legacyResult = await supabase
      .from("employee_messages")
      .insert({
        content: trimmed,
        status,
      })
      .select(EMPLOYEE_MESSAGE_SELECT_LEGACY)
      .single();

    if (legacyResult.error) {
      throw legacyResult.error;
    }

    return normalizeEmployeeMessage(legacyResult.data);
  }

  if (error) {
    throw error;
  }

  return normalizeEmployeeMessage(data);
}
