"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/form";
import { audit } from "@/lib/audit";
import { LAWYER_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { appUrl } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";

const slugRe = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

// ---------------------------------------------------------------------------
// Client side (portal visitors)
// ---------------------------------------------------------------------------

export async function requestPortalLink(_: FormState, data: FormData): Promise<FormState> {
  const p = z.object({ slug: z.string().regex(slugRe), email: z.string().trim().toLowerCase().email("Enter a valid email.") })
    .safeParse({ slug: data.get("slug"), email: data.get("email") });
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  await supabase.auth.signInWithOtp({
    email: p.data.email,
    options: { emailRedirectTo: `${appUrl()}/auth/callback?next=/portal/${p.data.slug}`, shouldCreateUser: true },
  });
  // Same answer whether or not the email has access.
  return { ok: "Check your email for a sign-in link. It works once and expires in an hour." };
}

export async function sendPortalMessage(_: FormState, data: FormData): Promise<FormState> {
  const p = z.object({
    slug: z.string().regex(slugRe),
    clientId: z.string().uuid(),
    matterId: z.string().uuid().optional(),
    body: z.string().trim().min(1, "Write a message.").max(5000),
  }).safeParse({
    slug: data.get("slug"), clientId: data.get("clientId"),
    matterId: (data.get("matterId") as string) || undefined, body: data.get("body"),
  });
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Please sign in again." };
  const { data: overview } = await supabase.rpc("portal_overview", { p_slug: p.data.slug });
  const ov = overview as { authorized?: boolean; org_id?: string; clients?: { id: string }[] } | null;
  const orgClient = ov?.authorized && ov.org_id && ov.clients?.some((c) => c.id === p.data.clientId);
  if (!orgClient) return { error: "You do not have access to this portal." };
  // RLS re-checks that this user is that client and the matter belongs to them.
  const { error } = await supabase.from("portal_messages").insert({
    org_id: ov!.org_id, client_id: p.data.clientId, matter_id: p.data.matterId ?? null,
    sender: "client", body: p.data.body, created_by: auth.user.id,
  });
  if (error) return { error: "Could not send your message." };
  revalidatePath(`/portal/${p.data.slug}`);
  return { ok: "Message sent. The firm will reply here." };
}

export async function portalSignOut(data: FormData) {
  const slug = String(data.get("slug") ?? "");
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect(slugRe.test(slug) ? `/portal/${slug}` : "/");
}

// ---------------------------------------------------------------------------
// Firm side
// ---------------------------------------------------------------------------

export async function invitePortalClient(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  if (!hasRole(ws, LAWYER_ROLES)) return { error: "Only owners, admins and lawyers can invite clients." };
  const p = z.object({ clientId: z.string().uuid(), email: z.string().trim().toLowerCase().email("Enter a valid email.") })
    .safeParse({ clientId: data.get("clientId"), email: data.get("email") });
  if (!p.success) return { error: p.error.issues[0].message };
  if (!ws.org.portal_slug || !ws.org.portal_enabled) return { error: "Switch the client portal on first (Settings → Branding & client portal)." };
  const { data: client } = await ws.supabase.from("clients").select("id").eq("id", p.data.clientId).eq("org_id", ws.org.id).maybeSingle();
  if (!client) return { error: "Client not found." };
  const { error } = await ws.supabase.from("portal_access").upsert(
    { org_id: ws.org.id, client_id: client.id, email: p.data.email, invited_by: ws.user.id, revoked_at: null },
    { onConflict: "org_id,client_id,email" },
  );
  if (error) return { error: "Could not give portal access." };
  await audit(ws, "portal.access_granted", { type: "client", id: client.id });
  revalidatePath(`/clients/${client.id}`);
  return { ok: `Access granted. Send ${p.data.email} the portal link: ${appUrl()}/portal/${ws.org.portal_slug} — they sign in with that email.` };
}

export async function revokePortalAccess(data: FormData) {
  const ws = await requireWorkspace();
  if (!hasRole(ws, LAWYER_ROLES)) return;
  const id = z.string().uuid().parse(data.get("id"));
  const clientId = z.string().uuid().parse(data.get("clientId"));
  await ws.supabase.from("portal_access").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("org_id", ws.org.id);
  await audit(ws, "portal.access_revoked", { type: "client", id: clientId });
  revalidatePath(`/clients/${clientId}`);
}

export async function setDocumentShared(data: FormData) {
  const ws = await requireWorkspace();
  if (!hasRole(ws, LAWYER_ROLES)) return;
  const p = z.object({ id: z.string().uuid(), matterId: z.string().uuid(), shared: z.enum(["true", "false"]) })
    .parse({ id: data.get("id"), matterId: data.get("matterId"), shared: data.get("shared") });
  await ws.supabase.from("documents").update({ shared_with_client: p.shared === "true" }).eq("id", p.id).eq("org_id", ws.org.id);
  await audit(ws, p.shared === "true" ? "document.shared_with_client" : "document.unshared", { type: "document", id: p.id });
  revalidatePath(`/matters/${p.matterId}`);
}

export async function replyToClient(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  const p = z.object({
    clientId: z.string().uuid(), matterId: z.string().uuid().optional(),
    body: z.string().trim().min(1, "Write a reply.").max(5000),
  }).safeParse({ clientId: data.get("clientId"), matterId: (data.get("matterId") as string) || undefined, body: data.get("body") });
  if (!p.success) return { error: p.error.issues[0].message };
  const { error } = await ws.supabase.from("portal_messages").insert({
    org_id: ws.org.id, client_id: p.data.clientId, matter_id: p.data.matterId ?? null,
    sender: "firm", body: p.data.body, created_by: ws.user.id,
  });
  if (error) return { error: "Could not send the reply." };
  await ws.supabase.from("portal_messages").update({ read_at: new Date().toISOString() })
    .eq("org_id", ws.org.id).eq("client_id", p.data.clientId).eq("sender", "client").is("read_at", null);
  await audit(ws, "portal.reply_sent", { type: "client", id: p.data.clientId });
  revalidatePath(`/clients/${p.data.clientId}`);
  return { ok: "Reply sent. The client sees it in their portal." };
}
