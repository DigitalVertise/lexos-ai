import { type NextRequest } from "next/server";
import { PRESENTERS, presenterScript } from "@/lib/presenters";
import { runtimeConfigured, runtimeFetch } from "@/lib/runtime";

export const maxDuration = 60;

/**
 * Public, fixed-script intro audio for the landing-page presenters (natural
 * neural voices via the agent runtime). Only whitelisted presenter/language
 * pairs are accepted, so it cannot be used as a general TTS proxy; responses
 * are cached at the edge for a week.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("p");
  const lang = request.nextUrl.searchParams.get("lang") === "ar" ? "ar" : "en";
  const p = PRESENTERS.find((x) => x.id === id);
  if (!p) return Response.json({ error: "Unknown presenter" }, { status: 404 });
  if (!runtimeConfigured()) return Response.json({ error: "Voice unavailable" }, { status: 503 });
  try {
    const res = await runtimeFetch("/v1/voice/tts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: presenterScript(p, lang), voice: p.voice[lang] }),
      timeoutMs: 50_000,
    });
    const audio = await res.arrayBuffer();
    return new Response(audio, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400" },
    });
  } catch {
    return Response.json({ error: "Voice unavailable" }, { status: 503 });
  }
}
