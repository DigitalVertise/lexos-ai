"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireWorkspace } from "@/lib/auth";
import { createTask } from "./tasks";

/**
 * Record changes the workspace copilot can make. Each one runs only after the
 * user taps Confirm on the copilot's card, as the signed-in user: same
 * validation, row-level security, firm scoping and audit log as the forms.
 * They return a result for the copilot to read instead of redirecting.
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
