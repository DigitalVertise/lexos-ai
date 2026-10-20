"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/form";
import { audit } from "@/lib/audit";
import { LAWYER_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { ALLOWED_MIME, DOCUMENT_BUCKET, isValidStoragePath, MAX_UPLOAD_BYTES, storagePathFor } from "@/lib/documents";

const fileMeta = z.object({
  matterId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  mime: z.string().refine((m) => ALLOWED_MIME.has(m), "This file type is not allowed. Use PDF, Word, Excel, text or an image."),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES, "Files can be up to 25 MB."),
});

/** Step 1: authorize the upload and hand back the private storage path. */
export async function prepareUpload(input: { matterId: string; filename: string; mime: string; size: number }):
  Promise<{ ok: true; documentId: string; path: string } | { ok: false; error: string }> {
  const ws = await requireWorkspace();
  const parsed = fileMeta.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { data: matter } = await ws.supabase.from("matters").select("id")
    .eq("id", parsed.data.matterId).eq("org_id", ws.org.id).maybeSingle();
  if (!matter) return { ok: false, error: "Matter not found." };
  const documentId = crypto.randomUUID();
  return { ok: true, documentId, path: storagePathFor(ws.org.id, documentId, parsed.data.filename) };
}

/** Step 2 (after the browser uploaded with its own session — storage RLS applies): record it. */
export async function registerUpload(input: {
  matterId: string; documentId: string; path: string; title: string; mime: string; size: number;
}): Promise<{ ok: boolean; error?: string }> {
  const ws = await requireWorkspace();
  const parsed = fileMeta.extend({
    documentId: z.string().uuid(), path: z.string().max(400), title: z.string().trim().min(1).max(300),
  }).safeParse({ ...input, filename: input.path.split("/").pop() ?? "" });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (!isValidStoragePath(d.path, ws.org.id, d.documentId)) return { ok: false, error: "Invalid upload." };

  const { data: objects } = await ws.supabase.storage.from(DOCUMENT_BUCKET).list(`${ws.org.id}/${d.documentId}`);
  const object = objects?.find((o) => `${ws.org.id}/${d.documentId}/${o.name}` === d.path);
  if (!object) return { ok: false, error: "The upload did not complete. Please try again." };

  const { error } = await ws.supabase.from("documents").insert({
    id: d.documentId,
    org_id: ws.org.id,
    matter_id: d.matterId,
    title: d.title,
    source: "upload",
    storage_path: d.path,
    mime_type: d.mime,
    size_bytes: (object.metadata?.size as number | undefined) ?? d.size,
    created_by: ws.user.id,
  });
  if (error) {
    await ws.supabase.storage.from(DOCUMENT_BUCKET).remove([d.path]);
    return { ok: false, error: "Could not save the document." };
  }
  await audit(ws, "document.uploaded", { type: "document", id: d.documentId }, { mime: d.mime, size: d.size });
  revalidatePath(`/matters/${d.matterId}`);
  return { ok: true };
}

export async function addLink(_: FormState, data: FormData): Promise<FormState> {
  const ws = await requireWorkspace();
  const parsed = z.object({
    matterId: z.string().uuid(),
    title: z.string().trim().min(1, "Enter a title.").max(300),
    url: z.string().trim().url("Enter a valid link.").refine((u) => u.startsWith("https://"), "Links must start with https://"),
  }).safeParse({ matterId: data.get("matterId"), title: data.get("title"), url: data.get("url") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { data: row, error } = await ws.supabase.from("documents").insert({
    org_id: ws.org.id, matter_id: parsed.data.matterId, title: parsed.data.title,
    source: "link", url: parsed.data.url, created_by: ws.user.id,
  }).select("id").single();
  if (error || !row) return { error: "Could not add the link." };
  await audit(ws, "document.linked", { type: "document", id: row.id });
  revalidatePath(`/matters/${parsed.data.matterId}`);
  return { ok: "Link added." };
}

export async function setDocumentStatus(data: FormData) {
  const ws = await requireWorkspace();
  const p = z.object({ id: z.string().uuid(), status: z.enum(["draft", "final", "archived"]), matterId: z.string().uuid() })
    .parse({ id: data.get("id"), status: data.get("status"), matterId: data.get("matterId") });
  await ws.supabase.from("documents").update({ status: p.status }).eq("id", p.id).eq("org_id", ws.org.id);
  await audit(ws, "document.status_changed", { type: "document", id: p.id }, { status: p.status });
  revalidatePath(`/matters/${p.matterId}`);
}

export async function deleteDocument(data: FormData) {
  const ws = await requireWorkspace();
  if (!hasRole(ws, LAWYER_ROLES)) return;
  const id = z.string().uuid().parse(data.get("id"));
  const { data: doc } = await ws.supabase.from("documents").select("storage_path, matter_id")
    .eq("id", id).eq("org_id", ws.org.id).maybeSingle();
  if (!doc) return;
  if (doc.storage_path) await ws.supabase.storage.from(DOCUMENT_BUCKET).remove([doc.storage_path]);
  await ws.supabase.from("documents").delete().eq("id", id).eq("org_id", ws.org.id);
  await audit(ws, "document.deleted", { type: "document", id });
  revalidatePath(`/matters/${doc.matter_id}`);
}
