import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

function getSupabaseUrl(): string {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!url) {
    throw new Error("Missing VITE_SUPABASE_URL or SUPABASE_URL.");
  }
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("Missing VITE_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY.");
  }
  return key;
}

export function getAccessTokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim() || null;
}

export function createSupabaseServerClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
