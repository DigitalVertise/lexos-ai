"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { FormState } from "@/components/form";
import { audit } from "@/lib/audit";
import { LAWYER_ROLES, hasRole, requireWorkspace } from "@/lib/auth";

const clientSchema = z.object({
  kind: z.enum(["individual", "organization"]),
  name: z.string().trim().min(1, "Enter the client's name.").max(200),
  email: z.string().trim().toLowerCase().email("Invalid email.").optional(),
  phone: z.string().trim().regex(/^[+\d][\d\s()-]{5,24}$/, "Invalid phone number.").optional(),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(5000).optional(),
});

function readClient(data: FormData) {
  const opt = (k: string) => (data.get(k) as string | null)?.trim() || undefined;
  return clientSchema.safeParse({
    kind: data.get("kind"), name: data.get("name"),
    email: opt("email"), phone: opt("phone"), address: opt("address"), notes: opt("notes"),
  });
}

export async function createClient(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  const parsed = readClient(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { data: row, error } = await ws.supabase.from("clients")
    .insert({ ...parsed.data, org_id: ws.org.id, created_by: ws.user.id })
    .select("id").single();
  if (error || !row) return { error: "Could not save the client." };
  await audit(ws, "client.created", { type: "client", id: row.id });
  revalidatePath("/clients");
  const next = data.get("next");
  redirect(typeof next === "string" && next === "matter" ? `/matters/new?client=${row.id}` : `/clients/${row.id}`);
}

export async function updateClient(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  const id = z.string().uuid().safeParse(data.get("id"));
  const parsed = readClient(data);
  if (!id.success || !parsed.success) return { error: parsed.success ? "Invalid client." : parsed.error.issues[0].message };
  const fields = {
    kind: parsed.data.kind, name: parsed.data.name,
    email: parsed.data.email ?? null, phone: parsed.data.phone ?? null,
    address: parsed.data.address ?? null, notes: parsed.data.notes ?? null,
  };
  const { data: row, error } = await ws.supabase.from("clients")
    .update(fields).eq("id", id.data).eq("org_id", ws.org.id).select("id").maybeSingle();
  if (error || !row) return { error: "Could not save the client." };
  await audit(ws, "client.updated", { type: "client", id: id.data });
  revalidatePath(`/clients/${id.data}`);
  return { ok: "Saved." };
}

export async function deleteClient(data: FormData) {
  const ws = await requireWorkspace();
  if (!hasRole(ws, LAWYER_ROLES)) return;
  const id = z.string().uuid().parse(data.get("id"));
  // Fails (foreign key) if the client still has matters — intentional.
  const { error } = await ws.supabase.from("clients").delete().eq("id", id).eq("org_id", ws.org.id);
  if (error) redirect(`/clients/${id}?error=has_matters`);
  await audit(ws, "client.deleted", { type: "client", id });
  revalidatePath("/clients");
  redirect("/clients");
}
