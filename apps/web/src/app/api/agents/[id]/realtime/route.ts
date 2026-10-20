import { z } from "zod";
import { type NextRequest } from "next/server";
import { jsonError, loadHire } from "@/lib/agents/api";
import { adapterFor, ProviderError } from "@/lib/avatars/adapters";
import { providerCredentials } from "@/lib/avatars/credentials";

export const dynamic = "force-dynamic";

/** Real-time avatar sessions (Simli token, LiveTalking/MuseTalk page) and "say this" for LiveTalking. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const loaded = await loadHire((await params).id);
  if (loaded instanceof Response) return loaded;
  const { ws, hire } = loaded;
  const parsed = z.discriminatedUnion("action", [
    z.object({ action: z.literal("session") }),
    z.object({ action: z.literal("say"), text: z.string().trim().min(1).max(3000), session: z.string().regex(/^\d{1,12}$/).optional() }),
  ]).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request.");
  const provider = hire.avatar?.provider ?? "";
  const adapter = adapterFor(provider);
  const creds = adapter ? await providerCredentials(ws, provider) : null;
  if (!adapter || !creds) return jsonError("Connect a real-time avatar provider in the Avatar studio first.", 409);
  try {
    if (parsed.data.action === "session") {
      if (!adapter.realtimeSession) return jsonError("This provider is not real-time.", 400);
      return Response.json(await adapter.realtimeSession(creds, { avatarId: hire.avatar?.provider_avatar_id ?? "" }), { headers: { "Cache-Control": "no-store" } });
    }
    if (!adapter.say) return jsonError("This provider speaks from the browser.", 400);
    await adapter.say(creds, { text: parsed.data.text, session: parsed.data.session });
    return Response.json({ ok: true });
  } catch (err) {
    return jsonError(err instanceof ProviderError ? err.message : "The avatar service did not respond.", 502);
  }
}
