import { z } from "zod";
import { type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { jsonError, loadHire } from "@/lib/agents/api";
import { adapterFor, ProviderError } from "@/lib/avatars/adapters";
import { parseVoice, providerCredentials } from "@/lib/avatars/credentials";
import { DOCUMENT_BUCKET } from "@/lib/documents";
import { runtimeConfigured, runtimeFetch, RuntimeError } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Generate a talking-avatar video of a reply with the assistant's provider.
 * - leaptalk: synchronous MP4 (returned as video/mp4)
 * - heygen / did: async job → {jobId}; poll with GET ?job=
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const loaded = await loadHire((await params).id);
  if (loaded instanceof Response) return loaded;
  const { ws, hire } = loaded;
  const parsed = z.object({ text: z.string().trim().min(1).max(1200) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Nothing to animate (keep it under 1,200 characters).");
  const avatar = hire.avatar;
  if (!avatar?.provider) return jsonError("Set up this assistant's avatar in the Avatar studio first.", 409);
  const text = parsed.data.text;

  try {
    if (avatar.provider === "leaptalk") {
      if (!runtimeConfigured()) return jsonError("The LexOS agent runtime is not connected yet.", 503);
      if (!avatar.portrait_path) return jsonError("Add a portrait in the Avatar studio first.", 409);
      if (!avatar.consent?.confirmed) return jsonError("Confirm portrait consent in the Avatar studio first.", 409);
      const { data: img } = await ws.supabase.storage.from(DOCUMENT_BUCKET).download(avatar.portrait_path);
      if (!img) return jsonError("Portrait file not found.", 404);
      const form = new FormData();
      form.set("image", new Blob([await img.arrayBuffer()], { type: img.type || "image/png" }), "portrait.png");
      form.set("text", text);
      const voice = parseVoice(avatar.voice);
      if (voice.provider === "builtin" && voice.id) form.set("voice_name", voice.id);
      const res = await runtimeFetch("/v1/avatar/video", { method: "POST", body: form, timeoutMs: 280_000 });
      await audit(ws, "avatar.video_generated", { type: "agent_hire", id: hire.id }, { provider: "leaptalk" });
      return new Response(res.body, { headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store", "X-Avatar-Live": "leaptalk" } });
    }

    const adapter = adapterFor(avatar.provider);
    if (!adapter?.startVideo) return jsonError("This avatar provider does not render videos.", 400);
    const creds = await providerCredentials(ws, avatar.provider);
    if (!creds) return jsonError(`Connect ${avatar.provider} in the Avatar studio first.`, 409);

    let imageUrl: string | null = null;
    if (avatar.provider === "did") {
      if (!avatar.portrait_path) return jsonError("Add a portrait in the Avatar studio first.", 409);
      if (!avatar.consent?.confirmed) return jsonError("Confirm portrait consent in the Avatar studio first.", 409);
      const { data: signed } = await ws.supabase.storage.from(DOCUMENT_BUCKET).createSignedUrl(avatar.portrait_path, 900);
      imageUrl = signed?.signedUrl ?? null;
    }
    const voice = parseVoice(avatar.voice);
    const job = await adapter.startVideo(creds, {
      text, avatarId: avatar.provider_avatar_id, avatarKind: avatar.provider_avatar_kind ?? null,
      voiceId: avatar.provider === "heygen" ? (voice.provider === "heygen" ? voice.id : avatar.provider_voice_id ?? null) : voice.id,
      imageUrl,
    });
    await audit(ws, "avatar.video_started", { type: "agent_hire", id: hire.id }, { provider: avatar.provider });
    return Response.json({ jobId: job.jobId, provider: avatar.provider }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ProviderError || err instanceof RuntimeError) return jsonError(err.message, 502);
    console.error("avatar video failed", { name: (err as Error).name });
    return jsonError("The avatar service did not respond.", 502);
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const loaded = await loadHire((await params).id);
  if (loaded instanceof Response) return loaded;
  const { ws, hire } = loaded;
  const job = request.nextUrl.searchParams.get("job") ?? "";
  if (!/^[A-Za-z0-9_-]{4,120}$/.test(job)) return jsonError("Invalid job.");
  const provider = hire.avatar?.provider ?? "";
  const adapter = adapterFor(provider);
  const creds = adapter?.videoStatus ? await providerCredentials(ws, provider) : null;
  if (!adapter?.videoStatus || !creds) return jsonError("Provider not connected.", 409);
  try {
    return Response.json(await adapter.videoStatus(creds, job), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonError(err instanceof ProviderError ? err.message : "Status unavailable.", 502);
  }
}
