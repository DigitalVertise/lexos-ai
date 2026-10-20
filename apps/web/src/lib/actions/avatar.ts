"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/form";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { adapterFor, ProviderError } from "@/lib/avatars/adapters";
import { PROVIDERS, providerMeta } from "@/lib/avatars/providers";
import { hasEncryptionKey } from "@/lib/crypto";
import { deleteConnection, saveConnection, type Provider } from "@/lib/integrations/store";
import type { AgentHire, AvatarConfig } from "@/lib/types";

const CONNECTABLE = PROVIDERS.filter((p) => p.credentials.length > 0).map((p) => p.id) as [string, ...string[]];

export async function connectAvatarProvider(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) return { error: "Only owners and admins can connect providers." };
  if (!hasEncryptionKey()) return { error: "Secure storage is not enabled on this server." };
  const p = z.object({
    provider: z.enum(CONNECTABLE),
    apiKey: z.string().trim().min(8).max(400).optional(),
    url: z.string().trim().url().max(300).optional(),
  }).safeParse({ provider: data.get("provider"), apiKey: (data.get("apiKey") as string) || undefined, url: (data.get("url") as string) || undefined });
  if (!p.success) return { error: "Fill in the provider's key or address." };
  const meta = providerMeta(p.data.provider)!;
  const creds = { apiKey: p.data.apiKey, url: p.data.url };
  if (meta.credentials.includes("apiKey") && !creds.apiKey) return { error: `Paste your ${meta.name} API key.` };
  if (meta.credentials.includes("url") && !creds.url) return { error: "Enter the server's https address." };
  let label: string;
  try {
    label = await adapterFor(p.data.provider)!.validate(creds);
  } catch (err) {
    return { error: err instanceof ProviderError ? `${meta.name} rejected the details: ${err.message}` : `${meta.name} did not respond.` };
  }
  const ok = await saveConnection(ws.supabase, ws.org.id, p.data.provider as Provider, creds, label, null);
  if (!ok) return { error: "Could not save (has database update 0006 been run?)." };
  await audit(ws, "integration.connected", undefined, { provider: p.data.provider });
  revalidatePath("/studio", "layout");
  return { ok: `${meta.name} connected (${label}).` };
}

export async function disconnectAvatarProvider(data: FormData) {
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) return;
  const provider = z.enum(CONNECTABLE).parse(data.get("provider"));
  await deleteConnection(ws.supabase, ws.org.id, provider as Provider);
  await audit(ws, "integration.disconnected", undefined, { provider });
  revalidatePath("/studio", "layout");
}

async function loadHireForEdit(id: string) {
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) return { error: "Only owners and admins can change avatars." } as const;
  const { data: hire } = await ws.supabase.from("agent_hires").select("*").eq("id", id).eq("org_id", ws.org.id).maybeSingle<AgentHire>();
  if (!hire) return { error: "Assistant not found." } as const;
  return { ws, hire } as const;
}

const unit = z.coerce.number().min(0).max(1);

export async function saveAvatarSettings(_: FormState, data: FormData): Promise<FormState> {
  const p = z.object({
    hireId: z.string().uuid(),
    provider: z.enum(PROVIDERS.map((x) => x.id) as [string, ...string[]]),
    voice: z.string().max(120).optional(),
    avatarId: z.string().max(200).optional(),
    avatarKind: z.string().max(40).optional(),
    preview: z.string().url().max(1000).optional(),
    anchorX: unit.optional(),
    anchorY: unit.optional(),
  }).safeParse({
    hireId: data.get("hireId"), provider: data.get("provider"),
    voice: (data.get("voice") as string) || undefined,
    avatarId: (data.get("avatarId") as string) || undefined,
    avatarKind: (data.get("avatarKind") as string) || undefined,
    preview: (data.get("preview") as string) || undefined,
    anchorX: data.get("anchorX") || undefined, anchorY: data.get("anchorY") || undefined,
  });
  if (!p.success) return { error: "Invalid avatar settings." };
  const loaded = await loadHireForEdit(p.data.hireId);
  if ("error" in loaded) return { error: loaded.error };
  const { ws, hire } = loaded;
  const avatar: AvatarConfig = {
    ...(hire.avatar ?? {}),
    provider: p.data.provider,
    voice: p.data.voice ?? null,
    provider_avatar_id: p.data.avatarId ?? null,
    provider_avatar_kind: p.data.avatarKind ?? null,
    provider_preview_url: p.data.preview ?? null,
    anchor: p.data.anchorX !== undefined && p.data.anchorY !== undefined ? { x: p.data.anchorX, y: p.data.anchorY } : hire.avatar?.anchor ?? null,
  };
  const { error } = await ws.supabase.from("agent_hires").update({ avatar }).eq("id", hire.id).eq("org_id", ws.org.id);
  if (error) return { error: error.code === "42703" ? "Avatars need database update 0006." : "Could not save the avatar." };
  await audit(ws, "avatar.updated", { type: "agent_hire", id: hire.id }, { provider: p.data.provider });
  revalidatePath(`/studio/${hire.id}`);
  revalidatePath(`/assistants/${hire.id}`);
  return { ok: "Avatar saved." };
}

/** After the browser uploads a portrait to private storage, attach it (consent required for real photos). */
export async function registerPortrait(_: FormState, data: FormData): Promise<FormState> {
  const p = z.object({ hireId: z.string().uuid(), path: z.string().max(300), consent: z.literal("on") })
    .safeParse({ hireId: data.get("hireId"), path: data.get("path"), consent: data.get("consent") });
  if (!p.success) return { error: "Tick the consent box to use this photo." };
  const loaded = await loadHireForEdit(p.data.hireId);
  if ("error" in loaded) return { error: loaded.error };
  const { ws, hire } = loaded;
  if (!new RegExp(`^${ws.org.id}/avatars/${hire.id}/portrait-[a-z0-9-]{6,40}\\.(png|jpe?g)$`).test(p.data.path)) return { error: "Invalid upload." };
  const avatar: AvatarConfig = {
    ...(hire.avatar ?? { provider: "builtin" }), portrait_path: p.data.path, portrait_source: "upload", anchor: null,
    consent: { confirmed: true, by: ws.user.id, at: new Date().toISOString() },
  };
  const { error } = await ws.supabase.from("agent_hires").update({ avatar }).eq("id", hire.id).eq("org_id", ws.org.id);
  if (error) return { error: error.code === "42703" ? "Avatars need database update 0006." : "Could not save the portrait." };
  await audit(ws, "avatar.portrait_uploaded", { type: "agent_hire", id: hire.id });
  revalidatePath(`/studio/${hire.id}`);
  return { ok: "Portrait saved. Now tap the centre of the mouth to set the lip anchor." };
}
