"use client";

import { syntheticLevel } from "./talking-portrait";

/**
 * Plays an assistant's reply aloud and exposes a live mouth level for avatars.
 * Order: server voice (ElevenLabs or LexOS neural voices) → the device's own
 * speech engine.
 *
 * Mobile Safari only lets a page make sound after a tap, so unlock() must be
 * called inside a click/tap handler. It (1) plays silence on the shared audio
 * element, (2) creates and resumes the AudioContext used for the lip-sync
 * meter, and (3) speaks an empty utterance so later speechSynthesis calls
 * outside the gesture are allowed.
 */

/** 0.05 s of silence as a valid WAV data URI (used to unlock audio on iOS). */
function silentWav(): string {
  const rate = 8000, n = 400, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  let bin = ""; new Uint8Array(buf).forEach((b) => { bin += String.fromCharCode(b); });
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/** Max time to wait for the server voice before using the device voice instead. */
const SERVER_VOICE_TIMEOUT_MS = 12_000;

/** Split text into sentence-sized chunks (Chrome stops long utterances after ~15 s). */
export function speechChunks(text: string, max = 220): string[] {
  const parts = text.match(/[^.!?؟。\n]+[.!?؟。]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + p).length > max && cur) { out.push(cur.trim()); cur = ""; }
    if (p.length > max) {
      for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max).trim());
    } else cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

export class Speaker {
  private audio: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private speakingSynth = false;
  private playingAudio = false;
  private cancelled = 0;
  private synthLevel = syntheticLevel(() => this.speakingSynth || this.playingAudio);
  source: "server" | "device" | null = null;

  constructor(private hireId: string, private voice?: string | null) {}

  /** Call from a click/tap handler, before anything async. */
  unlock() {
    if (typeof window === "undefined") return;
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = "auto";
      (this.audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      this.audio.setAttribute("playsinline", "");
    }
    if (this.audio.paused) {
      this.audio.src = silentWav();
      void this.audio.play().then(() => this.audio?.pause()).catch(() => undefined);
    }
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state !== "running") void this.ctx.resume().catch(() => undefined);
    } catch { this.ctx = null; }
    if ("speechSynthesis" in window) {
      const synth = window.speechSynthesis;
      synth.getVoices();
      if (!synth.speaking) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        try { synth.speak(u); } catch { /* ignore */ }
      }
    }
  }

  /** Attach the lip-sync analyser only when the context is running; otherwise audio would be silent. */
  private attachMeter() {
    if (this.analyser || !this.ctx || !this.audio || this.ctx.state !== "running") return;
    try {
      const source = this.ctx.createMediaElementSource(this.audio);
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyser.connect(this.ctx.destination);
      this.analyser = analyser;
      this.data = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    } catch { this.analyser = null; }
  }

  level = (): number => {
    if (this.analyser && this.data && this.playingAudio) {
      this.analyser.getByteTimeDomainData(this.data);
      let sum = 0;
      for (const v of this.data) { const x = (v - 128) / 128; sum += x * x; }
      return Math.min(1, Math.sqrt(sum / this.data.length) * 5.5);
    }
    return this.synthLevel();
  };

  get speaking(): boolean { return this.playingAudio || this.speakingSynth; }

  stop() {
    this.cancelled++;
    if (this.audio && !this.audio.paused) this.audio.pause();
    this.playingAudio = false;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    this.speakingSynth = false;
  }

  async speak(text: string, opts: { lang?: string } = {}): Promise<void> {
    this.stop();
    const run = this.cancelled;
    const clean = text.replace(/[#*_`>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 3800);
    if (!clean) return;
    const blob = await this.serverVoice(clean);
    if (run !== this.cancelled) return;
    if (blob) {
      const played = await this.playBlob(blob);
      if (played) return;
    }
    if (run !== this.cancelled) return;
    await this.deviceSpeak(clean, opts.lang, run);
  }

  private async serverVoice(text: string): Promise<Blob | null> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), SERVER_VOICE_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/agents/${this.hireId}/tts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: this.voice ?? undefined }), signal: ctl.signal,
      });
      if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("audio/")) return null;
      const blob = await res.blob();
      return blob.size > 200 ? blob : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async playBlob(blob: Blob): Promise<boolean> {
    if (!this.audio) this.unlock();
    const audio = this.audio;
    if (!audio) return false;
    const url = URL.createObjectURL(blob);
    audio.src = url;
    this.attachMeter();
    try {
      await audio.play();
    } catch {
      URL.revokeObjectURL(url);
      return false; // autoplay blocked or decode error → device voice
    }
    this.source = "server";
    this.playingAudio = true;
    await new Promise<void>((resolve) => {
      const done = () => { audio.onended = audio.onerror = audio.onpause = null; resolve(); };
      audio.onended = done; audio.onerror = done; audio.onpause = done;
    });
    this.playingAudio = false;
    URL.revokeObjectURL(url);
    return true;
  }

  private async deviceSpeak(text: string, lang: string | undefined, run: number): Promise<void> {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    this.source = "device";
    const arabic = /[؀-ۿ]/.test(text);
    const want = lang ?? (arabic ? "ar-AE" : "en-US");
    const voices = await this.voices();
    const voice = voices.find((x) => x.lang.replace("_", "-") === want)
      ?? voices.find((x) => x.lang.startsWith(want.slice(0, 2)) && /natural|premium|enhanced|google|siri/i.test(x.name))
      ?? voices.find((x) => x.lang.startsWith(want.slice(0, 2)));
    for (const chunk of speechChunks(text)) {
      if (run !== this.cancelled) return;
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.lang = want;
        if (voice) u.voice = voice;
        u.rate = 1;
        // Safety net: some engines never fire onend.
        const guard = setTimeout(() => { this.speakingSynth = false; resolve(); }, 4000 + chunk.length * 120);
        u.onstart = () => { this.speakingSynth = true; };
        u.onend = u.onerror = () => { clearTimeout(guard); this.speakingSynth = false; resolve(); };
        synth.speak(u);
        if (synth.paused) synth.resume();
      });
    }
  }

  private voices(): Promise<SpeechSynthesisVoice[]> {
    const synth = window.speechSynthesis;
    const now = synth.getVoices();
    if (now.length) return Promise.resolve(now);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(synth.getVoices()), 1200);
      synth.addEventListener("voiceschanged", () => { clearTimeout(t); resolve(synth.getVoices()); }, { once: true });
    });
  }
}
