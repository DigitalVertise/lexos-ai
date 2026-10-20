"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/form";
import { audit } from "@/lib/audit";
import { requireWorkspace } from "@/lib/auth";

const matterSchema = z.object({
  title: z.string().trim().min(1, "Enter a matter title.").max(300),
  client_id: z.string().uuid("Choose a client."),
  matter_type: z.string().trim().max(100).optional(),
  jurisdiction: z.string().trim().max(100).optional(),
  description: z.string().trim().max(10000).optional(),
  responsible_user_id: z.string().uuid().optional(),
  status: z.enum(["intake", "open", "on_hold", "closed"]).default("open"),
});

function readMatter(data: FormData) {
  const opt = (k: string) => (data.get(k) as string | null)?.trim() || undefined;
  return matterSchema.safeParse({
    title: data.get("title"), client_id: data.get("client_id"),
    matter_type: opt("matter_type"), jurisdiction: opt("jurisdiction"), description: opt("description"),
    responsible_user_id: opt("responsible_user_id"), status: opt("status"),
  });
}

async function assertMember(ws: Awaited<ReturnType<typeof requireWorkspace>>, userId?: string) {
  if (!userId) return true;
  const { data } = await ws.supabase.from("memberships").select("user_id").eq("org_id", ws.org.id).eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

export async function createMatter(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  const parsed = readMatter(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!(await assertMember(ws, parsed.data.responsible_user_id))) return { error: "Responsible lawyer must be a member of the firm." };
  const { data: row, error } = await ws.supabase.from("matters").insert({
    ...parsed.data,
    jurisdiction: parsed.data.jurisdiction ?? ws.org.default_jurisdiction,
    org_id: ws.org.id,
    number: 0, // assigned by the database trigger
    created_by: ws.user.id,
  }).select("id").single();
  // A client from another firm fails the composite foreign key, so it can't be linked.
  if (error || !row) return { error: "Could not create the matter. Check the client." };
  await audit(ws, "matter.created", { type: "matter", id: row.id });
  revalidatePath("/matters");
  redirect(`/matters/${row.id}`);
}

export async function updateMatter(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  const id = z.string().uuid().safeParse(data.get("id"));
  const parsed = readMatter(data);
  if (!id.success || !parsed.success) return { error: parsed.success ? "Invalid matter." : parsed.error.issues[0].message };
  if (!(await assertMember(ws, parsed.data.responsible_user_id))) return { error: "Responsible lawyer must be a member of the firm." };
  const { data: row, error } = await ws.supabase.from("matters").update({
    title: parsed.data.title,
    client_id: parsed.data.client_id,
    matter_type: parsed.data.matter_type ?? null,
    jurisdiction: parsed.data.jurisdiction ?? null,
    description: parsed.data.description ?? null,
    responsible_user_id: parsed.data.responsible_user_id ?? null,
    status: parsed.data.status,
  }).eq("id", id.data).eq("org_id", ws.org.id).select("id").maybeSingle();
  if (error || !row) return { error: "Could not save the matter." };
  await audit(ws, "matter.updated", { type: "matter", id: id.data }, { status: parsed.data.status });
  revalidatePath(`/matters/${id.data}`);
  revalidatePath("/matters");
  return { ok: "Saved." };
}
