import type { AuthError, PostgrestError } from "@supabase/supabase-js";

type SupabaseLikeError = PostgrestError | AuthError | Error | unknown;

export function logSupabaseError(context: string, error: SupabaseLikeError): void {
  if (error && typeof error === "object") {
    const details = {
      context,
      message: "message" in error ? error.message : String(error),
      code: "code" in error ? error.code : undefined,
      details: "details" in error ? error.details : undefined,
      hint: "hint" in error ? error.hint : undefined,
      status: "status" in error ? error.status : undefined,
    };
    console.error("[supabase]", details);
    return;
  }

  console.error("[supabase]", { context, message: String(error) });
}

export function formatSupabaseError(error: SupabaseLikeError): string {
  if (!error || typeof error !== "object") {
    return "Unexpected error. Check the browser console for details.";
  }

  const code = "code" in error ? error.code : undefined;
  const message = "message" in error ? error.message : "Request failed.";
  const hint = "hint" in error ? error.hint : undefined;

  if (code === "PGRST205") {
    return "Table employee_messages is missing. Run Supabase SQL migrations first.";
  }

  if (code === "42501") {
    return "Permission denied by RLS. Ensure your user has role worker in accounts or user_metadata, then run migration 20250623110000_fix_worker_rls_role_check.sql.";
  }

  if (code === "23502") {
    return "Required field is missing in the insert payload.";
  }

  if (hint) {
    return `${message} (${hint})`;
  }

  return message ?? "Request failed.";
}
