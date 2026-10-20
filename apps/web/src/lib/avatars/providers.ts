/**
 * Avatar / voice provider catalogue (metadata only — safe for the browser).
 * Server-side calls live in ./adapters.ts. Every provider is optional; the
 * built-in portrait works with no account at all.
 */

export type ProviderId = "builtin" | "leaptalk" | "heygen" | "did" | "simli" | "livetalking" | "elevenlabs";

export type CredentialField = "apiKey" | "url";

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  /** live-local: animated in the browser · video: renders an MP4 per reply · realtime: streaming WebRTC · voice: speech only */
  kind: "live-local" | "video" | "realtime" | "voice";
  free: boolean;
  credentials: CredentialField[];
  usesPortrait: boolean;      // animates the firm's own portrait image
  providerAvatars: boolean;   // has its own avatar library (IDs + preview images)
  providerVoices: boolean;    // has its own voice library
  docs: string;
  summary: string;
  maturity: "stable" | "beta";
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "builtin", name: "Built-in talking portrait", kind: "live-local", free: true, credentials: [],
    usesPortrait: true, providerAvatars: false, providerVoices: false, maturity: "stable",
    docs: "", summary: "Instant and free. Your portrait’s mouth moves with the voice, right in the browser. Approximate lip movement, not a generated video.",
  },
  {
    id: "leaptalk", name: "LeapTalk (open source, Hugging Face)", kind: "video", free: true, credentials: [],
    usesPortrait: true, providerAvatars: false, providerVoices: false, maturity: "beta",
    docs: "https://huggingface.co/spaces/hugging-apps/leaptalk-talking-head",
    summary: "Open-source (Apache-2.0) model that turns your portrait + the reply’s audio into a realistic lip-synced video. Free GPU quota per day; ~20–60 s per clip.",
  },
  {
    id: "heygen", name: "HeyGen", kind: "video", free: false, credentials: ["apiKey"],
    usesPortrait: false, providerAvatars: true, providerVoices: true, maturity: "beta",
    docs: "https://docs.heygen.com", summary: "Studio-quality avatar videos from HeyGen’s avatar and voice library (your HeyGen plan and credits).",
  },
  {
    id: "did", name: "D-ID", kind: "video", free: false, credentials: ["apiKey"],
    usesPortrait: true, providerAvatars: false, providerVoices: false, maturity: "beta",
    docs: "https://docs.d-id.com", summary: "Animates your own portrait into a talking video using D-ID credits.",
  },
  {
    id: "simli", name: "Simli (real-time)", kind: "realtime", free: false, credentials: ["apiKey"],
    usesPortrait: false, providerAvatars: true, providerVoices: false, maturity: "beta",
    docs: "https://docs.simli.com", summary: "Real-time WebRTC face that speaks as the reply plays. Needs a Simli face ID.",
  },
  {
    id: "livetalking", name: "MuseTalk / LiveTalking (self-hosted)", kind: "realtime", free: true, credentials: ["url"],
    usesPortrait: false, providerAvatars: false, providerVoices: false, maturity: "beta",
    docs: "https://github.com/lipku/LiveTalking",
    summary: "Open-source real-time digital human (MuseTalk, Wav2Lip, ER-NeRF) over WebRTC on your own GPU server. Enter its https address.",
  },
  {
    id: "elevenlabs", name: "ElevenLabs (voices)", kind: "voice", free: false, credentials: ["apiKey"],
    usesPortrait: false, providerAvatars: false, providerVoices: true, maturity: "beta",
    docs: "https://elevenlabs.io/docs", summary: "Premium natural voices for spoken replies with any avatar.",
  },
];

export const providerMeta = (id: string | null | undefined) => PROVIDERS.find((p) => p.id === id);

/** Free neural voices served by the LexOS agent runtime (edge-tts). */
export const BUILTIN_VOICES = [
  { id: "en-US-AndrewMultilingualNeural", label: "Andrew (English, US, male)" },
  { id: "en-US-AvaMultilingualNeural", label: "Ava (English, US, female)" },
  { id: "en-GB-RyanNeural", label: "Ryan (English, UK, male)" },
  { id: "en-GB-SoniaNeural", label: "Sonia (English, UK, female)" },
  { id: "ar-AE-HamdanNeural", label: "Hamdan (Arabic, UAE, male)" },
  { id: "ar-AE-FatimaNeural", label: "Fatima (Arabic, UAE, female)" },
  { id: "ar-EG-ShakirNeural", label: "Shakir (Arabic, Egypt, male)" },
  { id: "ar-EG-SalmaNeural", label: "Salma (Arabic, Egypt, female)" },
];
