"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/form";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, assertRole, ORG_COOKIE, requireUser, requireWorkspace } from "@/lib/auth";
import { canAddSeat } from "@/lib/entitlements";
import { planState } from "@/lib/plans";

const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };

export async function createFirm(_: FormState, data: FormData): Promise<FormState> {
  const parsed = z.object({ name: z.string().trim().min(2, "Enter your firm's name.").max(200) })
    .safeParse({ name: data.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { supabase, user } = await requireUser();
  const memberName = (user.user_metadata?.full_name as string | undefined) ?? null;
  const { data: orgId, error } = await supabase.rpc("create_organization", { org_name: parsed.data.name, member_name: memberName });
  if (error || !orgId) return { error: "Could not create the firm. Please try again." };
  (await cookies()).set(ORG_COOKIE, orgId as string, cookieOpts);
  redirect("/assistants?welcome=1");
}

export async function acceptInvitation(data: FormData) {
  const id = z.string().uuid().safeParse(data.get("invitation"));
  if (!id.success) return;
  const { supabase, user } = await requireUser();
  const { data: orgId, error } = await supabase.rpc("accept_invitation", {
    invitation: id.data, member_name: (user.user_metadata?.full_name as string | undefined) ?? null,
  });
  if (!error && orgId) {
    (await cookies()).set(ORG_COOKIE, orgId as string, cookieOpts);
    redirect("/dashboard");
  }
  redirect("/onboarding?error=invite");
}

export async function switchFirm(data: FormData) {
  const id = z.string().uuid().safeParse(data.get("org"));
  if (id.success) (await cookies()).set(ORG_COOKIE, id.data, cookieOpts);
  // requireWorkspace() ignores the cookie unless the user is a member.
  redirect("/dashboard");
}

export async function updateFirm(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  try { assertRole(ws, ADMIN_ROLES); } catch { return { error: "Only owners and admins can change firm settings." }; }
  const parsed = z.object({
    name: z.string().trim().min(2).max(200),
    default_jurisdiction: z.string().trim().max(100).optional(),
  }).safeParse({ name: data.get("name"), default_jurisdiction: data.get("default_jurisdiction") || undefined });
  if (!parsed.success) return { error: "Check the firm name." };
  const { error } = await ws.supabase.from("organizations")
    .update({ name: parsed.data.name, default_jurisdiction: parsed.data.default_jurisdiction ?? null })
    .eq("id", ws.org.id);
  if (error) return { error: "Could not save." };
  await audit(ws, "organization.updated", { type: "organization", id: ws.org.id });
  revalidatePath("/settings");
  return { ok: "Saved." };
}

export async function inviteMember(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  try { assertRole(ws, ADMIN_ROLES); } catch { return { error: "Only owners and admins can invite." }; }
  const parsed = z.object({
    email: z.string().trim().toLowerCase().email("Enter a valid email."),
    role: z.enum(["admin", "lawyer", "staff"]),
  }).safeParse({ email: data.get("email"), role: data.get("role") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [{ count: members }, { count: pending }] = await Promise.all([
    ws.supabase.from("memberships").select("user_id", { count: "exact", head: true }).eq("org_id", ws.org.id),
    ws.supabase.from("invitations").select("id", { count: "exact", head: true })
      .eq("org_id", ws.org.id).is("accepted_at", null).gt("expires_at", new Date().toISOString()),
  ]);
  const seat = canAddSeat(planState(ws.org), (members ?? 0) + (pending ?? 0));
  if (!seat.ok) return { error: seat.reason };

  const { data: inv, error } = await ws.supabase.from("invitations")
    .insert({ org_id: ws.org.id, email: parsed.data.email, role: parsed.data.role, invited_by: ws.user.id })
    .select("id").single();
  if (error || !inv) return { error: "Could not create the invitation." };
  await audit(ws, "invitation.created", { type: "invitation", id: inv.id }, { role: parsed.data.role });
  revalidatePath("/settings");
  return { ok: `Invitation created. Ask ${parsed.data.email} to sign up at LexOS with this email — the invitation appears after they sign in.` };
}

export async function removeMember(data: FormData) {
  const ws = await requireWorkspace();
  assertRole(ws, ADMIN_ROLES);
  const userId = z.string().uuid().parse(data.get("user"));
  if (userId === ws.user.id) return;
  await ws.supabase.from("memberships").delete().eq("org_id", ws.org.id).eq("user_id", userId);
  await audit(ws, "member.removed", { type: "user", id: userId });
  revalidatePath("/settings");
}

export async function revokeInvitation(data: FormData) {
  const ws = await requireWorkspace();
  assertRole(ws, ADMIN_ROLES);
  const id = z.string().uuid().parse(data.get("invitation"));
  await ws.supabase.from("invitations").delete().eq("org_id", ws.org.id).eq("id", id);
  await audit(ws, "invitation.revoked", { type: "invitation", id });
  revalidatePath("/settings");
}
