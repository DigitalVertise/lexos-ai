"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/form";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { BrandingError, detectBranding, HEX, normaliseWebsite, type DetectedBranding } from "@/lib/branding";
import { env } from "@/lib/env";

export type DetectState = (FormState & { detected?: DetectedBranding }) | null;

/** Fetch the firm's public website and suggest a logo and colours. Saves the website URL. */
export async function detectFirmBranding(_: DetectState, data: FormData): Promise<DetectState> {
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) return { error: "Only owners and admins can change branding." };
  const raw = String(data.get("website") ?? "").trim();
  if (!raw) return { error: "Enter the firm's website." };
  try {
    const detected = await detectBranding(raw);
    const patch: Record<string, unknown> = { website_url: detected.website };
    if (detected.colors.length) patch.brand_colors = detected.colors;
    if (!ws.org.logo_url && detected.logos[0]) patch.logo_url = detected.logos[0].url;
    if (!ws.org.brand_primary && detected.colors[0]) patch.brand_primary = detected.colors[0];
    const { error } = await ws.supabase.from("organizations").update(patch).eq("id", ws.org.id);
    if (error) return { error: error.code === "42703" ? "Run database update 0006 first (see Settings)." : "Could not save the website." };
    await audit(ws, "branding.detected", undefined, { logos: detected.logos.length, colors: detected.colors.length });
    revalidatePath("/", "layout");
    return {
      ok: `Found ${detected.logos.length} logo option${detected.logos.length === 1 ? "" : "s"} and ${detected.colors.length} colour${detected.colors.length === 1 ? "" : "s"}. Review them below.`,
      detected,
    };
  } catch (err) {
    if (err instanceof BrandingError) return { error: err.message };
    return { error: "The website could not be read. You can still set the logo and colours manually." };
  }
}

const hex = z.string().trim().regex(HEX, "Colours must look like #1d3a5f.").transform((v) => v.toLowerCase());

export async function saveBranding(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) return { error: "Only owners and admins can change branding." };
  const opt = (k: string) => (String(data.get(k) ?? "").trim() || undefined);
  const parsed = z.object({
    website: z.string().optional(),
    logo: z.string().url().refine((u) => u.startsWith("https://"), "Logo must be an https:// link.").optional(),
    primary: hex.optional(),
    accent: hex.optional(),
    theme: z.enum(["light", "dark", "auto"]),
    swatches: z.array(hex).max(12),
  }).safeParse({
    website: opt("website"), logo: opt("logo"), primary: opt("primary"), accent: opt("accent"),
    theme: data.get("theme") ?? "auto",
    swatches: data.getAll("swatch").map(String).filter(Boolean),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  let website: string | null = null;
  if (parsed.data.website) {
    try { website = normaliseWebsite(parsed.data.website).toString().replace(/\/$/, ""); } catch (e) { return { error: (e as Error).message }; }
  }
  const { error } = await ws.supabase.from("organizations").update({
    website_url: website,
    logo_url: parsed.data.logo ?? null,
    brand_primary: parsed.data.primary ?? null,
    brand_accent: parsed.data.accent ?? null,
    theme: parsed.data.theme,
    brand_colors: [...new Set(parsed.data.swatches)],
  }).eq("id", ws.org.id);
  if (error) return { error: error.code === "42703" ? "Run database update 0006 first (see Settings)." : "Could not save branding." };
  await audit(ws, "branding.updated");
  revalidatePath("/", "layout");
  return { ok: "Branding saved." };
}

/** After the browser uploads a logo to the public branding bucket, store its public URL. */
export async function applyUploadedLogo(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) return { error: "Only owners and admins can change branding." };
  const path = String(data.get("path") ?? "");
  if (!new RegExp(`^${ws.org.id}/logo-[a-z0-9-]{6,40}\\.(png|jpe?g|webp|svg)$`).test(path)) return { error: "Invalid upload." };
  const url = `${env().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/${path}`;
  const { error } = await ws.supabase.from("organizations").update({ logo_url: url }).eq("id", ws.org.id);
  if (error) return { error: "Could not save the logo." };
  await audit(ws, "branding.logo_uploaded");
  revalidatePath("/", "layout");
  return { ok: "Logo updated." };
}

// ---------------------------------------------------------------------------
// Portal settings
// ---------------------------------------------------------------------------

const RESERVED = new Set(["admin", "api", "app", "login", "signup", "portal", "www", "lexos", "settings", "embed"]);

export async function savePortalSettings(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) return { error: "Only owners and admins can change the portal." };
  const parsed = z.object({
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, "Use 3–48 letters, numbers or dashes."),
    enabled: z.boolean(),
    welcome: z.string().trim().max(600).optional(),
  }).safeParse({ slug: data.get("slug"), enabled: data.get("enabled") === "on", welcome: String(data.get("welcome") ?? "") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (RESERVED.has(parsed.data.slug)) return { error: "That address is reserved. Choose another." };
  const { error } = await ws.supabase.from("organizations").update({
    portal_slug: parsed.data.slug, portal_enabled: parsed.data.enabled, portal_welcome: parsed.data.welcome ?? null,
  }).eq("id", ws.org.id);
  if (error?.code === "23505") return { error: "That portal address is taken. Choose another." };
  if (error) return { error: error.code === "42703" ? "Run database update 0006 first (see Settings)." : "Could not save the portal." };
  await audit(ws, "portal.settings_updated", undefined, { enabled: parsed.data.enabled });
  revalidatePath("/settings/branding");
  return { ok: parsed.data.enabled ? "Portal is live." : "Portal saved (switched off)." };
}
