"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/form";
import { appUrl } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");
const password = z.string().min(10, "Use at least 10 characters.").max(128);

/** Only allow same-site relative redirects after login. */
function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export async function signIn(_: FormState, data: FormData): Promise<FormState> {
  const parsed = z.object({ email, password: z.string().min(1, "Enter your password.") })
    .safeParse({ email: data.get("email"), password: data.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: error.code === "email_not_confirmed"
      ? "Please confirm your email first — check your inbox for the link."
      : "Email or password is incorrect." };
  }
  redirect(safeNext(data.get("next")));
}

export async function signUp(_: FormState, data: FormData): Promise<FormState> {
  const parsed = z.object({ email, password, name: z.string().trim().min(2, "Enter your name.").max(120) })
    .safeParse({ email: data.get("email"), password: data.get("password"), name: data.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await supabaseServer();
  const { data: result, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.name },
      emailRedirectTo: `${appUrl()}/auth/callback?next=/onboarding`,
    },
  });
  if (error) {
    return { error: error.code === "weak_password" ? "Choose a stronger password." : "Could not create the account. Please try again." };
  }
  if (result.session) redirect("/onboarding");
  return { ok: "Check your email to confirm your account, then sign in." };
}

export async function requestReset(_: FormState, data: FormData): Promise<FormState> {
  const parsed = email.safeParse(data.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await supabaseServer();
  await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${appUrl()}/auth/callback?next=/reset-password` });
  // Same answer whether or not the account exists.
  return { ok: "If an account exists for that email, a reset link is on its way." };
}

export async function updatePassword(_: FormState, data: FormData): Promise<FormState> {
  const parsed = password.safeParse(data.get("password"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { error: "Your reset link has expired. Request a new one." };
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
