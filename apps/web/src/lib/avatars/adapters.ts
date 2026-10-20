import "server-only";
import type { ProviderId } from "./providers";

/**
 * Provider-independent adapter layer. Each adapter only implements what the
 * provider really supports; callers check `capabilities` first. Nothing here
 * fakes output: without credentials the methods are simply unavailable.
 */

export interface Credentials { apiKey?: string; url?: string }
export interface LibraryItem { id: string; name: string; previewUrl?: string | null; previewAudio?: string | null; kind?: string; language?: string | null }
export interface VideoJob { jobId: string }
export interface VideoStatus { status: "pending" | "processing" | "completed" | "failed"; url?: string | null; error?: string | null }
export interface StartVideo { text: string; avatarId?: string | null; avatarKind?: string | null; voiceId?: string | null; imageUrl?: string | null }

export class ProviderError extends Error {}

export interface Adapter {
  validate(c: Credentials): Promise<string>;           // returns an account label
  listAvatars?(c: Credentials): Promise<LibraryItem[]>;
  listVoices?(c: Credentials): Promise<LibraryItem[]>;
  startVideo?(c: Credentials, input: StartVideo): Promise<VideoJob>;
  videoStatus?(c: Credentials, jobId: string): Promise<VideoStatus>;
  tts?(c: Credentials, text: string, voiceId: string): Promise<ArrayBuffer>;
  realtimeSession?(c: Credentials, input: { avatarId: string }): Promise<{ token?: string; url?: string }>;
  say?(c: Credentials, input: { text: string; session?: string }): Promise<void>;
}

async function call<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(init.timeoutMs ?? 30_000) });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = (json as { message?: string; error?: { message?: string } | string; detail?: unknown } | null);
    const detail = typeof msg?.error === "string" ? msg.error : msg?.error?.message ?? msg?.message ?? "";
    throw new ProviderError(`${new URL(url).hostname} ${res.status}${detail ? `: ${String(detail).slice(0, 160)}` : ""}`);
  }
  return json as T;
}

const need = (v: string | undefined, what: string) => { if (!v) throw new ProviderError(`${what} missing`); return v; };

// ---------------------------------------------------------------- HeyGen
const HEYGEN = "https://api.heygen.com";
const heygen: Adapter = {
  async validate(c) {
    await call(`${HEYGEN}/v2/avatars`, { headers: { "X-Api-Key": need(c.apiKey, "API key"), Accept: "application/json" } });
    return "HeyGen account";
  },
  async listAvatars(c) {
    const r = await call<{ data?: { avatars?: { avatar_id: string; avatar_name?: string; preview_image_url?: string }[];
      talking_photos?: { talking_photo_id: string; talking_photo_name?: string; preview_image_url?: string }[] } }>(
      `${HEYGEN}/v2/avatars`, { headers: { "X-Api-Key": need(c.apiKey, "API key"), Accept: "application/json" } });
    return [
      ...(r.data?.avatars ?? []).map((a) => ({ id: a.avatar_id, name: a.avatar_name ?? a.avatar_id, previewUrl: a.preview_image_url ?? null, kind: "avatar" })),
      ...(r.data?.talking_photos ?? []).map((a) => ({ id: a.talking_photo_id, name: a.talking_photo_name ?? a.talking_photo_id, previewUrl: a.preview_image_url ?? null, kind: "talking_photo" })),
    ].slice(0, 120);
  },
  async listVoices(c) {
    const r = await call<{ data?: { voices?: { voice_id: string; name?: string; language?: string; preview_audio?: string }[] } }>(
      `${HEYGEN}/v2/voices`, { headers: { "X-Api-Key": need(c.apiKey, "API key"), Accept: "application/json" } });
    return (r.data?.voices ?? []).slice(0, 300).map((v) => ({ id: v.voice_id, name: v.name ?? v.voice_id, language: v.language ?? null, previewAudio: v.preview_audio ?? null }));
  },
  async startVideo(c, input) {
    const avatarId = need(input.avatarId ?? undefined, "HeyGen avatar");
    const character = input.avatarKind === "talking_photo"
      ? { type: "talking_photo", talking_photo_id: avatarId }
      : { type: "avatar", avatar_id: avatarId, avatar_style: "normal" };
    const r = await call<{ data?: { video_id?: string } }>(`${HEYGEN}/v2/video/generate`, {
      method: "POST",
      headers: { "X-Api-Key": need(c.apiKey, "API key"), "Content-Type": "application/json" },
      body: JSON.stringify({
        video_inputs: [{ character, voice: { type: "text", input_text: input.text, voice_id: need(input.voiceId ?? undefined, "HeyGen voice") } }],
        dimension: { width: 720, height: 720 },
      }),
    });
    return { jobId: need(r.data?.video_id, "video id") };
  },
  async videoStatus(c, jobId) {
    const r = await call<{ data?: { status?: string; video_url?: string; error?: { message?: string } | null } }>(
      `${HEYGEN}/v1/video_status.get?video_id=${encodeURIComponent(jobId)}`, { headers: { "X-Api-Key": need(c.apiKey, "API key") } });
    const s = r.data?.status;
    return {
      status: s === "completed" ? "completed" : s === "failed" ? "failed" : s === "processing" ? "processing" : "pending",
      url: r.data?.video_url ?? null, error: r.data?.error?.message ?? null,
    };
  },
};

// ---------------------------------------------------------------- D-ID
const DID = "https://api.d-id.com";
const didAuth = (c: Credentials) => `Basic ${Buffer.from(`${need(c.apiKey, "API key")}:`).toString("base64")}`;
const did: Adapter = {
  async validate(c) {
    await call(`${DID}/credits`, { headers: { Authorization: didAuth(c), Accept: "application/json" } });
    return "D-ID account";
  },
  async startVideo(c, input) {
    const r = await call<{ id?: string }>(`${DID}/talks`, {
      method: "POST",
      headers: { Authorization: didAuth(c), "Content-Type": "application/json" },
      body: JSON.stringify({
        source_url: need(input.imageUrl ?? undefined, "portrait"),
        script: { type: "text", input: input.text, provider: { type: "microsoft", voice_id: input.voiceId || "en-US-AndrewMultilingualNeural" } },
      }),
    });
    return { jobId: need(r.id, "talk id") };
  },
  async videoStatus(c, jobId) {
    const r = await call<{ status?: string; result_url?: string; error?: { description?: string } }>(
      `${DID}/talks/${encodeURIComponent(jobId)}`, { headers: { Authorization: didAuth(c) } });
    const s = r.status;
    return {
      status: s === "done" ? "completed" : s === "error" || s === "rejected" ? "failed" : s === "started" ? "processing" : "pending",
      url: r.result_url ?? null, error: r.error?.description ?? null,
    };
  },
};

// ---------------------------------------------------------------- ElevenLabs
const ELEVEN = "https://api.elevenlabs.io";
const elevenlabs: Adapter = {
  async validate(c) {
    const r = await call<{ subscription?: { tier?: string } }>(`${ELEVEN}/v1/user`, { headers: { "xi-api-key": need(c.apiKey, "API key") } });
    return `ElevenLabs (${r.subscription?.tier ?? "account"})`;
  },
  async listVoices(c) {
    const r = await call<{ voices?: { voice_id: string; name?: string; preview_url?: string; labels?: { language?: string } }[] }>(
      `${ELEVEN}/v1/voices`, { headers: { "xi-api-key": need(c.apiKey, "API key") } });
    return (r.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name ?? v.voice_id, previewAudio: v.preview_url ?? null, language: v.labels?.language ?? null }));
  },
  async tts(c, text, voiceId) {
    const res = await fetch(`${ELEVEN}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(60_000),
      headers: { "xi-api-key": need(c.apiKey, "API key"), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
    });
    if (!res.ok) throw new ProviderError(`ElevenLabs ${res.status}`);
    return res.arrayBuffer();
  },
};

// ---------------------------------------------------------------- Simli
const simli: Adapter = {
  async validate(c) {
    need(c.apiKey, "API key");
    return "Simli account (key saved — verified when a session starts)";
  },
  async realtimeSession(c, input) {
    const r = await call<{ session_token?: string; detail?: string }>("https://api.simli.ai/compose/token", {
      method: "POST",
      headers: { "x-simli-api-key": need(c.apiKey, "API key"), "Content-Type": "application/json" },
      body: JSON.stringify({ faceId: need(input.avatarId, "Simli face ID"), apiVersion: "v2", handleSilence: true, maxSessionLength: 900, maxIdleTime: 120 }),
    });
    return { token: need(r.session_token, "session token") };
  },
};

// ---------------------------------------------------------------- LiveTalking / MuseTalk (self-hosted)
export function liveTalkingBase(raw: string | undefined): URL {
  let u: URL;
  try { u = new URL(need(raw, "server address")); } catch { throw new ProviderError("Enter the server's https address."); }
  if (u.protocol !== "https:") throw new ProviderError("The server must use https:// (browsers block microphone and video on http).");
  return u;
}
const livetalking: Adapter = {
  async validate(c) {
    const base = liveTalkingBase(c.url);
    const res = await fetch(base, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!res || res.status >= 500) throw new ProviderError("The LiveTalking server did not answer.");
    return base.host;
  },
  async realtimeSession(c) {
    const base = liveTalkingBase(c.url);
    return { url: new URL("webrtcapi.html", base.href.endsWith("/") ? base : `${base.href}/`).toString() };
  },
  async say(c, input) {
    const base = liveTalkingBase(c.url);
    await call(new URL("human", base.href.endsWith("/") ? base : `${base.href}/`).toString(), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: input.text, type: "echo", interrupt: true, sessionid: Number(input.session ?? 0) }),
    });
  },
};

export const ADAPTERS: Partial<Record<ProviderId, Adapter>> = { heygen, did, elevenlabs, simli, livetalking };
export const adapterFor = (id: string) => ADAPTERS[id as ProviderId];
