import type { UserRole } from "./database.types";
import {
  createSupabaseServerClient,
  getAccessTokenFromRequest,
} from "./supabase-server";

type AuthSuccess = {
  ok: true;
  userId: string;
  email: string | null;
  role: UserRole;
};

type AuthFailure = {
  ok: false;
  response: Response;
};

export async function requireAuthenticatedRole(
  request: Request,
  allowedRoles: UserRole[],
): Promise<AuthSuccess | AuthFailure> {
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

  const { data: account, error: accountError } = await supabase
    .from("accounts")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (accountError && accountError.code !== "PGRST205") {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Failed to verify account role." }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  const metadataRole = user.user_metadata?.role;
  const role =
    account?.role ??
    (metadataRole === "worker" || metadataRole === "manager" ? metadataRole : null);

  if (!role || !allowedRoles.includes(role)) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  return {
    ok: true,
    userId: user.id,
    email: user.email ?? null,
    role,
  };
}

export async function requireManagerRequest(request: Request): Promise<AuthSuccess | AuthFailure> {
  return requireAuthenticatedRole(request, ["manager"]);
}
