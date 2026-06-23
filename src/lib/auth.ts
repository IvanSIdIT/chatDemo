import { redirect } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";

import type { Account, UserRole } from "./database.types";
import { supabase } from "./supabase";

export type AuthState = {
  session: Session | null;
  account: Account | null;
  role: UserRole | null;
};

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getAccount(userId: string): Promise<Account | null> {
  const { data, error } = await supabase
    .from("accounts")
    .select("id, email, role, created_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST205") {
      return null;
    }
    throw error;
  }

  return data;
}

function roleFromUserMetadata(user: { user_metadata?: Record<string, unknown>; email?: string; id: string }): Account | null {
  const role = user.user_metadata?.role;
  if (role !== "worker" && role !== "manager") {
    return null;
  }

  return {
    id: user.id,
    email: user.email ?? "",
    role,
    created_at: new Date().toISOString(),
  };
}

export async function getAccountForUser(user: {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}): Promise<Account | null> {
  const account = await getAccount(user.id);
  if (account) {
    return account;
  }

  return roleFromUserMetadata(user);
}

export async function getAuthState(): Promise<AuthState> {
  const session = await getSession();

  if (!session) {
    return { session: null, account: null, role: null };
  }

  const account = await getAccountForUser(session.user);

  return {
    session,
    account,
    role: account?.role ?? null,
  };
}

export async function signIn(email: string, password: string): Promise<AuthState> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  const account = await getAccountForUser(data.user);

  if (!account) {
    await supabase.auth.signOut();
    throw new Error("Account not found. Contact your administrator.");
  }

  return {
    session: data.session,
    account,
    role: account.role,
  };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export function routeForRole(role: UserRole): "/worker" | "/manager" {
  return role === "manager" ? "/manager" : "/worker";
}

export async function requireRole(role: UserRole): Promise<AuthState> {
  if (typeof window === "undefined") {
    return { session: null, account: null, role: null };
  }

  const auth = await getAuthState();

  if (!auth.session || auth.role !== role) {
    throw redirect({ to: "/" });
  }

  return auth;
}
