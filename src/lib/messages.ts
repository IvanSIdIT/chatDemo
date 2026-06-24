import { supabase } from "./supabase";
import type { EmployeeMessage, EmployeeMessageInsert, MessageStatus } from "./database.types";
import { formatSupabaseError, logSupabaseError } from "./supabase-error";

export type EmployeeMessageWithEmail = EmployeeMessage & {
  employee_email: string | null;
};

const AI_ASSISTANT_PREFIX = "[AI Assistant] ";

export function isEmployeeRequestMessage(message: Pick<EmployeeMessage, "content">): boolean {
  return !message.content.startsWith(AI_ASSISTANT_PREFIX);
}

export async function sendEmployeeMessage(content: string): Promise<EmployeeMessage> {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Message cannot be empty.");
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    logSupabaseError("sendEmployeeMessage.getUser", userError);
    throw new Error(formatSupabaseError(userError));
  }

  if (!user) {
    throw new Error("You must be signed in to send a message.");
  }

  const payload: EmployeeMessageInsert = {
    content: trimmed,
    status: "pending",
  };

  const { data, error } = await supabase
    .from("employee_messages")
    .insert(payload)
    .select("id, employee_id, content, status, action_plan, action_plan_status, created_at")
    .single();

  if (error) {
    logSupabaseError("sendEmployeeMessage.insert", {
      ...error,
      payload,
      userId: user.id,
      userRole: user.user_metadata?.role,
    });
    throw new Error(formatSupabaseError(error));
  }

  return data;
}

export async function fetchWorkerMessages(): Promise<EmployeeMessage[]> {
  const { data, error } = await supabase
    .from("employee_messages")
    .select("id, employee_id, content, status, action_plan, action_plan_status, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function fetchManagerMessages(): Promise<EmployeeMessageWithEmail[]> {
  const { data: messages, error: messagesError } = await supabase
    .from("employee_messages")
    .select("id, employee_id, content, status, action_plan, action_plan_status, created_at")
    .order("created_at", { ascending: false });

  if (messagesError) {
    throw messagesError;
  }

  const rows = (messages ?? []).filter(isEmployeeRequestMessage);
  if (rows.length === 0) {
    return [];
  }

  const employeeIds = [...new Set(rows.map((row) => row.employee_id))];
  const { data: accounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id, email")
    .in("id", employeeIds);

  if (accountsError && accountsError.code !== "PGRST205") {
    throw accountsError;
  }

  const emailById = new Map((accounts ?? []).map((account) => [account.id, account.email]));

  return rows.map((row) => ({
    ...row,
    employee_email: emailById.get(row.employee_id) ?? null,
  }));
}

export function subscribeToEmployeeMessages(
  onInsert: (message: EmployeeMessage) => void,
  onUpdate?: (message: EmployeeMessage) => void,
  onError?: (error: Error) => void,
  onSubscribed?: () => void,
) {
  const channel = supabase
    .channel("manager-employee-messages")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "employee_messages",
      },
      (payload) => {
        const message = payload.new as EmployeeMessage;
        if (!isEmployeeRequestMessage(message)) {
          return;
        }
        onInsert(message);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "employee_messages",
      },
      (payload) => {
        const message = payload.new as EmployeeMessage;
        if (!isEmployeeRequestMessage(message)) {
          return;
        }
        onUpdate?.(message);
      },
    )
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        onSubscribed?.();
        return;
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        onError?.(new Error(err?.message ?? `Realtime subscription failed: ${status}`));
      }
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function formatMessageStatus(status: MessageStatus): string {
  return status === "pending" ? "Ожидает" : "Проверено";
}

export function shortMessageId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}
