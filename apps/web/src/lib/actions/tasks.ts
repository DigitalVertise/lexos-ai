"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/form";
import { parseSuggestedTasks } from "@/lib/agents/prompt";
import { audit } from "@/lib/audit";
import { LAWYER_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { dubaiDateToUtc } from "@/lib/dates";

const taskSchema = z.object({
  title: z.string().trim().min(1, "Enter a task title.").max(300),
  description: z.string().trim().max(4000).optional(),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "Invalid date.").optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  matterId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
});

export async function createTask(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  const parsed = taskSchema.safeParse({
    title: data.get("title"),
    description: data.get("description") || undefined,
    due: data.get("due") || undefined,
    priority: data.get("priority") || undefined,
    matterId: data.get("matterId") || undefined,
    assigneeId: data.get("assigneeId") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const t = parsed.data;
  let dueAt: string | null = null;
  try { dueAt = t.due ? dubaiDateToUtc(t.due) : null; } catch { return { error: "That date does not exist." }; }

  if (t.assigneeId) {
    const { data: member } = await ws.supabase.from("memberships").select("user_id")
      .eq("org_id", ws.org.id).eq("user_id", t.assigneeId).maybeSingle();
    if (!member) return { error: "The assignee is not a member of this firm." };
  }
  const { data: task, error } = await ws.supabase.from("tasks").insert({
    org_id: ws.org.id,
    matter_id: t.matterId ?? null,
    title: t.title,
    description: t.description ?? null,
    due_at: dueAt,
    priority: t.priority,
    assignee_id: t.assigneeId ?? null,
    created_by: ws.user.id,
  }).select("id").single();
  // A matter from another firm fails the composite foreign key / RLS check.
  if (error || !task) return { error: "Could not create the task." };
  await audit(ws, "task.created", { type: "task", id: task.id });
  revalidatePath("/tasks");
  if (t.matterId) revalidatePath(`/matters/${t.matterId}`);
  revalidatePath("/dashboard");
  return { ok: "Task added." };
}

export async function toggleTask(data: FormData) {
  const ws = await requireWorkspace();
  const id = z.string().uuid().parse(data.get("id"));
  const done = data.get("done") === "1";
  await ws.supabase.from("tasks")
    .update({ status: done ? "done" : "open", completed_at: done ? new Date().toISOString() : null })
    .eq("id", id).eq("org_id", ws.org.id);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  const matterId = data.get("matterId");
  if (typeof matterId === "string" && matterId) revalidatePath(`/matters/${matterId}`);
}

export async function deleteTask(data: FormData) {
  const ws = await requireWorkspace();
  if (!hasRole(ws, LAWYER_ROLES)) return;
  const id = z.string().uuid().parse(data.get("id"));
  await ws.supabase.from("tasks").delete().eq("id", id).eq("org_id", ws.org.id);
  await audit(ws, "task.deleted", { type: "task", id });
  revalidatePath("/tasks");
}

function safeDue(value: string | null | undefined): string | null {
  if (!value) return null;
  try { return dubaiDateToUtc(value); } catch { return null; }
}

/**
 * Add the tasks proposed by the Deadline & Task Planner. The tasks are
 * re-read from the saved output on the server — never taken from the browser.
 */
export async function addSuggestedTasks(data: FormData): Promise<string> {
  const ws = await requireWorkspace();
  const ids = z.object({ matterId: z.string().uuid(), outputId: z.string().uuid() })
    .safeParse({ matterId: data.get("matterId"), outputId: data.get("outputId") });
  if (!ids.success) return "Could not add tasks.";
  const { data: output } = await ws.supabase.from("ai_outputs").select("output, matter_id")
    .eq("id", ids.data.outputId).eq("org_id", ws.org.id).maybeSingle();
  if (!output || output.matter_id !== ids.data.matterId) return "Could not find those suggestions.";
  const parsed = parseSuggestedTasks(output.output);
  if (!parsed || parsed.tasks.length === 0) return "No tasks to add.";

  const rows = parsed.tasks.map((t) => ({
    org_id: ws.org.id,
    matter_id: ids.data.matterId,
    title: t.title,
    description: [t.description, t.basis ? `Basis (AI suggestion — verify): ${t.basis}` : null].filter(Boolean).join("\n\n") || null,
    due_at: safeDue(t.due_date),
    priority: t.priority,
    created_by: ws.user.id,
  }));
  const { error } = await ws.supabase.from("tasks").insert(rows);
  if (error) return "Could not add tasks.";
  await audit(ws, "task.bulk_created_from_ai", { type: "ai_output", id: ids.data.outputId }, { count: rows.length });
  revalidatePath(`/matters/${ids.data.matterId}`);
  revalidatePath("/tasks");
  return `${rows.length} tasks added to the matter.`;
}
