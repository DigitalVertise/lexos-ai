"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { hireAssistant } from "./assistants";
import { detectFirmBranding, saveBranding, savePortalSettings } from "./branding";
import { inviteMember, updateFirm } from "./firm";
import { createTask } from "./tasks";

/**
 * Record changes the workspace copilot can make. Each one runs only after the
 * user taps Confirm on the copilot's card, as the signed-in user: same
 * validation, row-level security, firm scoping and audit log as the forms.
 * They return a result for the copilot to read instead of redirecting.
 *
 * Admin changes (firm settings, team, assistants, branding, client portal)
 * reuse the existing settings actions, which refuse anyone who is not an
 * owner or admin of the firm: the copilot never has more rights than the
 * person using it.
 */
export type CopilotResult = { ok: true; message: string; id?: string; href?: string } | { ok: false; error: string };

const fail = (error: string): CopilotResult => ({ ok: false, error });

const taskInput = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).optional(),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
  matterId: z.string().uuid().optional(),
});

export async function copilotCreateTask(input: z.input<typeof taskInput>): Promise<CopilotResult> {
  const parsed = taskInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const form = new FormData();
  for (const [k, v] of Object.entries(parsed.data)) if (v) form.set(k, v);
  const state = await createTask(null, form);
  if (state?.error) return fail(state.error);
  return { ok: true, message: `Task added: ${parsed.data.title}`, href: parsed.data.matterId ? `/matters/${parsed.data.matterId}` : "/tasks" };
}

const clientInput = z.object({
  kind: z.enum(["individual", "organization"]),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().regex(/^[+\d][\d\s()-]{5,24}$/).optional(),
  notes: z.string().trim().max(5000).optional(),
});

export async function copilotCreateClient(input: z.input<typeof clientInput>): Promise<CopilotResult> {
  const parsed = clientInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const ws = await requireWorkspace();
  const { data: row, error } = await ws.supabase.from("clients")
    .insert({ ...parsed.data, org_id: ws.org.id, created_by: ws.user.id })
    .select("id").single();
  if (error || !row) return fail("Could not save the client.");
  await audit(ws, "client.created", { type: "client", id: row.id }, { via: "copilot" });
  revalidatePath("/clients");
  return { ok: true, message: `Client added: ${parsed.data.name}`, id: row.id, href: `/clients/${row.id}` };
}

const matterInput = z.object({
  title: z.string().trim().min(1).max(300),
  clientId: z.string().uuid(),
  matterType: z.string().trim().max(100).optional(),
  description: z.string().trim().max(10000).optional(),
  status: z.enum(["intake", "open", "on_hold"]).optional(),
});

export async function copilotCreateMatter(input: z.input<typeof matterInput>): Promise<CopilotResult> {
  const parsed = matterInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const m = parsed.data;
  const ws = await requireWorkspace();
  const { data: row, error } = await ws.supabase.from("matters").insert({
    title: m.title,
    client_id: m.clientId,
    matter_type: m.matterType ?? null,
    description: m.description ?? null,
    status: m.status ?? "open",
    jurisdiction: ws.org.default_jurisdiction,
    org_id: ws.org.id,
    number: 0, // assigned by the database trigger
    created_by: ws.user.id,
  }).select("id, number").single();
  // A client from another firm fails the composite foreign key, so it can't be linked.
  if (error || !row) return fail("Could not create the matter. Check the client.");
  await audit(ws, "matter.created", { type: "matter", id: row.id }, { via: "copilot" });
  revalidatePath("/matters");
  return { ok: true, message: `Matter #${row.number} created: ${m.title}`, id: row.id, href: `/matters/${row.id}` };
}

const statusInput = z.object({
  matterId: z.string().uuid(),
  status: z.enum(["intake", "open", "on_hold", "closed"]),
});

export async function copilotSetMatterStatus(input: z.input<typeof statusInput>): Promise<CopilotResult> {
  const parsed = statusInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const ws = await requireWorkspace();
  const { data: row, error } = await ws.supabase.from("matters").update({ status: parsed.data.status })
    .eq("id", parsed.data.matterId).eq("org_id", ws.org.id).select("id, title").maybeSingle();
  if (error || !row) return fail("Could not update the matter.");
  await audit(ws, "matter.updated", { type: "matter", id: row.id }, { status: parsed.data.status, via: "copilot" });
  revalidatePath(`/matters/${row.id}`);
  revalidatePath("/matters");
  return { ok: true, message: `"${row.title}" is now ${parsed.data.status.replace("_", " ")}.`, href: `/matters/${row.id}` };
}

// ── Admin: firm setup, team, assistants, branding, client portal ────────────

const ADMIN_ONLY = "Only owners and admins can change firm settings. Ask an admin of your firm.";

function formOf(values: Record<string, string | string[] | undefined>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(values)) {
    if (Array.isArray(v)) v.forEach((x) => form.append(k, x));
    else if (v !== undefined) form.set(k, v);
  }
  return form;
}

/** Settings actions that redirect on success: turn the redirect into a result. */
function redirectTarget(err: unknown): string | null {
  const digest = (err as { digest?: unknown })?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) return null;
  return digest.split(";")[2] ?? "/";
}

const firmInput = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  defaultJurisdiction: z.string().trim().max(100).optional(),
});

export async function copilotUpdateFirm(input: z.input<typeof firmInput>): Promise<CopilotResult> {
  const parsed = firmInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) return fail(ADMIN_ONLY);
  const state = await updateFirm(null, formOf({
    name: parsed.data.name ?? ws.org.name,
    default_jurisdiction: parsed.data.defaultJurisdiction ?? ws.org.default_jurisdiction ?? undefined,
  }));
  if (state?.error) return fail(state.error);
  return { ok: true, message: "Firm settings saved.", href: "/settings" };
}

const inviteInput = z.object({ email: z.string().trim().email(), role: z.enum(["admin", "lawyer", "staff"]) });

export async function copilotInviteMember(input: z.input<typeof inviteInput>): Promise<CopilotResult> {
  const parsed = inviteInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const state = await inviteMember(null, formOf(parsed.data));
  if (state?.error) return fail(state.error);
  return { ok: true, message: state?.ok ?? "Invitation created.", href: "/settings" };
}

const hireInput = z.object({
  agentKey: z.string().regex(/^[a-z_]{3,40}$/),
  name: z.string().trim().min(2).max(80).optional(),
  instructions: z.string().trim().max(4000).optional(),
});

export async function copilotHireAssistant(input: z.input<typeof hireInput>): Promise<CopilotResult> {
  const parsed = hireInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  try {
    const state = await hireAssistant(null, formOf({
      agent_key: parsed.data.agentKey, name: parsed.data.name, instructions: parsed.data.instructions,
    }));
    if (state?.error) return fail(state.error);
    return { ok: true, message: "Assistant hired.", href: "/assistants" };
  } catch (err) {
    const href = redirectTarget(err);
    if (!href) throw err;
    return { ok: true, message: "Assistant hired and ready on your AI team.", href };
  }
}

const hexColour = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/);
const brandingInput = z.object({
  website: z.string().trim().max(300).optional(),
  primary: hexColour.optional(),
  accent: hexColour.optional(),
  theme: z.enum(["light", "dark", "auto"]).optional(),
});

export async function copilotUpdateBranding(input: z.input<typeof brandingInput>): Promise<CopilotResult> {
  const parsed = brandingInput.safeParse(input);
  if (!parsed.success) return fail("Colours must look like #1d3a5f.");
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) return fail(ADMIN_ONLY);
  const b = parsed.data;
  // saveBranding replaces every field, so start from what the firm has now.
  const state = await saveBranding(null, formOf({
    website: b.website ?? ws.org.website_url ?? undefined,
    logo: ws.org.logo_url ?? undefined,
    primary: b.primary ?? ws.org.brand_primary ?? undefined,
    accent: b.accent ?? ws.org.brand_accent ?? undefined,
    theme: b.theme ?? ws.org.theme ?? "auto",
    swatch: ws.org.brand_colors ?? [],
  }));
  if (state?.error) return fail(state.error);
  return { ok: true, message: "Branding saved.", href: "/settings/branding" };
}

const detectInput = z.object({ website: z.string().trim().min(3).max(300) });

export async function copilotDetectBranding(input: z.input<typeof detectInput>): Promise<CopilotResult> {
  const parsed = detectInput.safeParse(input);
  if (!parsed.success) return fail("Enter the firm's website.");
  const state = await detectFirmBranding(null, formOf({ website: parsed.data.website }));
  if (state?.error) return fail(state.error);
  return { ok: true, message: state?.ok ?? "Website read. Review the logo and colours.", href: "/settings/branding" };
}

const portalInput = z.object({
  enabled: z.boolean().optional(),
  slug: z.string().trim().toLowerCase().optional(),
  welcome: z.string().trim().max(600).optional(),
});

export async function copilotUpdatePortal(input: z.input<typeof portalInput>): Promise<CopilotResult> {
  const parsed = portalInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) return fail(ADMIN_ONLY);
  const p = parsed.data;
  const slug = p.slug ?? ws.org.portal_slug;
  if (!slug) return fail("Choose a portal address first (letters, numbers or dashes).");
  const enabled = p.enabled ?? ws.org.portal_enabled;
  const state = await savePortalSettings(null, formOf({
    slug, enabled: enabled ? "on" : undefined, welcome: p.welcome ?? ws.org.portal_welcome ?? undefined,
  }));
  if (state?.error) return fail(state.error);
  return { ok: true, message: state?.ok ?? "Portal saved.", href: "/settings/branding" };
}
