"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/form";
import { catalogAgent, CUSTOM_AGENT_KEY } from "@/lib/agents/catalog";
import { runAssistant } from "@/lib/agents/run";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { canHire } from "@/lib/entitlements";
import { planState } from "@/lib/plans";

export async function hireAssistant(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) return { error: "Only owners and admins can hire assistants." };

  const parsed = z.object({
    agent_key: z.string().regex(/^[a-z_]{3,40}$/),
    name: z.string().trim().min(2).max(80).optional(),
    instructions: z.string().trim().max(4000).optional(),
  }).safeParse({
    agent_key: data.get("agent_key"),
    name: data.get("name") || undefined,
    instructions: data.get("instructions") || undefined,
  });
  if (!parsed.success) return { error: "Check the assistant details." };
  const { agent_key } = parsed.data;

  const isCustom = agent_key === CUSTOM_AGENT_KEY;
  const agent = catalogAgent(agent_key);
  if (!isCustom && !agent) return { error: "Unknown assistant." };
  if (isCustom && (!parsed.data.name || !parsed.data.instructions || parsed.data.instructions.length < 40)) {
    return { error: "Give your custom assistant a name and describe its role in at least a few sentences." };
  }

  // Package check on the server, against the database — never the browser.
  const { data: existing } = await ws.supabase.from("agent_hires").select("agent_key").eq("org_id", ws.org.id);
  const decision = canHire(planState(ws.org), existing ?? [], agent_key);
  if (!decision.ok) return { error: decision.reason };

  const { data: hire, error } = await ws.supabase.from("agent_hires").insert({
    org_id: ws.org.id,
    agent_key,
    name: isCustom ? parsed.data.name! : agent!.name,
    instructions: parsed.data.instructions ?? null,
    hired_by: ws.user.id,
  }).select("id").single();
  if (error || !hire) {
    return { error: error?.code === "23505" ? "This assistant is already on your team." : "Could not hire the assistant." };
  }
  await audit(ws, "assistant.hired", { type: "agent_hire", id: hire.id }, { agent: agent_key });
  revalidatePath("/assistants");
  redirect(`/assistants/${hire.id}`);
}

export async function updateAssistant(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) return { error: "Only owners and admins can change assistants." };
  const parsed = z.object({
    id: z.string().uuid(),
    instructions: z.string().trim().max(4000),
    status: z.enum(["active", "paused"]),
  }).safeParse({ id: data.get("id"), instructions: data.get("instructions") ?? "", status: data.get("status") });
  if (!parsed.success) return { error: "Check the details." };

  const { data: hire } = await ws.supabase.from("agent_hires").select("agent_key")
    .eq("id", parsed.data.id).eq("org_id", ws.org.id).maybeSingle();
  if (!hire) return { error: "Assistant not found." };
  if (hire.agent_key === CUSTOM_AGENT_KEY && parsed.data.instructions.length < 40) {
    return { error: "A custom assistant needs a role description." };
  }
  const { error } = await ws.supabase.from("agent_hires")
    .update({ instructions: parsed.data.instructions || null, status: parsed.data.status })
    .eq("id", parsed.data.id).eq("org_id", ws.org.id);
  if (error) return { error: "Could not save." };
  await audit(ws, "assistant.updated", { type: "agent_hire", id: parsed.data.id }, { status: parsed.data.status });
  revalidatePath(`/assistants/${parsed.data.id}`);
  return { ok: "Saved." };
}

export async function releaseAssistant(data: FormData) {
  const ws = await requireWorkspace();
  if (!hasRole(ws, ADMIN_ROLES)) return;
  const id = z.string().uuid().parse(data.get("id"));
  // Past outputs stay on the matters (agent_hire_id is set to null).
  await ws.supabase.from("agent_hires").delete().eq("id", id).eq("org_id", ws.org.id);
  await audit(ws, "assistant.released", { type: "agent_hire", id });
  revalidatePath("/assistants");
  redirect("/assistants");
}

export type RunState =
  | { status: "idle" }
  | { status: "error"; error: string }
  | { status: "done"; outputId: string; text: string; tasks: { title: string; description?: string | null; due_date?: string | null; priority: string; basis?: string | null }[] | null; warnings: string[]; matterId: string | null };

export async function runAssistantAction(_: RunState, data: FormData): Promise<RunState> {
  const ws = await requireWorkspace();
  const parsed = z.object({
    hireId: z.string().uuid(),
    matterId: z.string().uuid().nullable(),
    documentIds: z.array(z.string().uuid()).max(5),
    request: z.string(),
  }).safeParse({
    hireId: data.get("hireId"),
    matterId: data.get("matterId") || null,
    documentIds: data.getAll("documentIds"),
    request: data.get("request") ?? "",
  });
  if (!parsed.success) return { status: "error", error: "Check the request." };
  const result = await runAssistant(ws, parsed.data);
  if (!result.ok) return { status: "error", error: result.error };
  if (parsed.data.matterId) revalidatePath(`/matters/${parsed.data.matterId}`);
  return {
    status: "done",
    outputId: result.outputId,
    text: result.text,
    tasks: result.tasks?.tasks ?? null,
    warnings: result.tasks?.warnings ?? [],
    matterId: parsed.data.matterId,
  };
}
