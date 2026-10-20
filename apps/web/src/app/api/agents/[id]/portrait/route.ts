import { z } from "zod";
import { type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { jsonError, loadHire } from "@/lib/agents/api";
import { ADMIN_ROLES, hasRole } from "@/lib/auth";
import { DOCUMENT_BUCKET } from "@/lib/documents";
import { runtimeConfigured, runtimeFetch, RuntimeError } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** GET: short-lived link to the assistant's portrait (members only). */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const loaded = await loadHire((await params).id);
  if (loaded instanceof Response) return loaded;
  const path = loaded.hire.avatar?.portrait_path;
  if (!path) return new Response("No portrait", { status: 404 });
  const { data } = await loaded.ws.supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, 600);
  if (!data) return new Response("Not found", { status: 404 });
  return Response.redirect(data.signedUrl, 302);
}

/** POST {description}: generate a fictional AI portrait (FLUX via the runtime) and store it privately. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const loaded = await loadHire((await params).id);
  if (loaded instanceof Response) return loaded;
  const { ws, hire } = loaded;
  if (!hasRole(ws, ADMIN_ROLES)) return jsonError("Only owners and admins can change avatars.", 403);
  const parsed = z.object({ description: z.string().trim().min(3).max(400) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Describe the person in a few words.");
  if (!runtimeConfigured()) return jsonError("AI portraits need the LexOS agent runtime (not connected yet). Upload a photo instead.", 503);
  try {
    const res = await runtimeFetch("/v1/avatar/portrait", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: parsed.data.description }), timeoutMs: 150_000,
    });
    const png = await res.arrayBuffer();
    const path = `${ws.org.id}/avatars/${hire.id}/portrait-${crypto.randomUUID().slice(0, 12)}.png`;
    const { error } = await ws.supabase.storage.from(DOCUMENT_BUCKET).upload(path, png, { contentType: "image/png", upsert: false });
    if (error) return jsonError("Could not store the portrait.", 500);
    const avatar = { ...(hire.avatar ?? { provider: "builtin" }), portrait_path: path, portrait_source: "generated" as const, anchor: null,
      consent: { confirmed: true, by: ws.user.id, at: new Date().toISOString() } }; // AI-generated fictional person
    const { error: upErr } = await ws.supabase.from("agent_hires").update({ avatar }).eq("id", hire.id).eq("org_id", ws.org.id);
    if (upErr) return jsonError(upErr.code === "42703" ? "Avatars need database update 0006." : "Could not save the avatar.", 500);
    await audit(ws, "avatar.portrait_generated", { type: "agent_hire", id: hire.id });
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err instanceof RuntimeError ? err.message : "Portrait generation failed.", 502);
  }
}
