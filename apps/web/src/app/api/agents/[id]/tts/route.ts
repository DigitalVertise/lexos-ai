import { z } from "zod";
import { type NextRequest } from "next/server";
import { jsonError, loadHire } from "@/lib/agents/api";
import { adapterFor } from "@/lib/avatars/adapters";
import { parseVoice, providerCredentials } from "@/lib/avatars/credentials";
import { runtimeConfigured, runtimeFetch } from "@/lib/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Speech for a reply: ElevenLabs when the assistant uses an ElevenLabs voice,
 * otherwise the runtime's free neural voices. 503 {fallback:"browser"} tells
 * the page to use the device's built-in speech instead.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const loaded = await loadHire((await params).id);
  if (loaded instanceof Response) return loaded;
  const { ws, hire } = loaded;
  const parsed = z.object({ text: z.string().trim().min(1).max(4000), voice: z.string().max(120).optional() })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Nothing to say.");
  const voice = parseVoice(parsed.data.voice ?? hire.avatar?.voice);

  try {
    if (voice.provider === "elevenlabs" && voice.id) {
      const creds = await providerCredentials(ws, "elevenlabs");
      const adapter = adapterFor("elevenlabs");
      if (creds && adapter?.tts) {
        const audio = await adapter.tts(creds, parsed.data.text, voice.id);
        return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Source": "elevenlabs" } });
      }
    }
    if (runtimeConfigured()) {
      const res = await runtimeFetch("/v1/voice/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: parsed.data.text, voice: voice.provider === "builtin" ? voice.id : null }),
        timeoutMs: 90_000,
      });
      return new Response(res.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Source": "lexos-neural" } });
    }
  } catch (err) {
    console.warn("tts failed", { name: (err as Error).name });
  }
  return Response.json({ error: "Speech service unavailable", fallback: "browser" }, { status: 503 });
}
