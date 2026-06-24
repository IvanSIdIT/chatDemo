import type { ActionPlanStatus, EmployeeMessage, MessageStatus } from "./database.types";

export const EMPLOYEE_MESSAGE_SELECT =
  "id, employee_id, content, status, action_plan, action_plan_status, created_at";

export const EMPLOYEE_MESSAGE_SELECT_LEGACY =
  "id, employee_id, content, status, created_at";

type EmployeeMessageRow = {
  id: string;
  employee_id: string;
  content: string;
  status: MessageStatus;
  created_at: string;
  action_plan?: string | null;
  action_plan_status?: ActionPlanStatus;
};

export function isMissingActionPlanColumnsError(error: {
  code?: string;
  message?: string;
}): boolean {
  if (error.code === "42703") {
    return true;
  }

  const message = error.message?.toLowerCase() ?? "";
  return message.includes("action_plan");
}

export function normalizeEmployeeMessage(row: EmployeeMessageRow): EmployeeMessage {
  return {
    ...row,
    action_plan: row.action_plan ?? null,
    action_plan_status: row.action_plan_status ?? "none",
  };
}
