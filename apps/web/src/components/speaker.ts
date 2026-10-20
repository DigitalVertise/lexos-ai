"use client";

import { audioLevelMeter, syntheticLevel } from "./talking-portrait";

/**
 * Plays an assistant's reply aloud and exposes a live mouth level for avatars.
 * Order: server voice (ElevenLabs or LexOS neural voices) → the device's own
 * speech engine. iOS needs unlock() inside a tap before audio can play later.
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

export class Speaker {
  private audio: HTMLAudioElement | null = null;
  private meter: { level: () => number; close: () => void } | null = null;
  private speakingSynth = false;
  private synthLevel = syntheticLevel(() => this.speakingSynth);
  source: "server" | "device" | null = null;

  constructor(private hireId: string, private voice?: string | null) {}

  /** Call from a click/tap handler. */
  unlock() {
    if (typeof window === "undefined") return;
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = "auto";
      (this.audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      this.audio.crossOrigin = "anonymous";
    }
    // A silent play() inside the gesture unlocks this element on iOS.
    this.audio.src = silentWav();
    void this.audio.play().then(() => this.audio?.pause()).catch(() => undefined);
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
  }

  level = (): number => (this.meter && this.audio && !this.audio.paused ? this.meter.level() : this.synthLevel());

  stop() {
    this.audio?.pause();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    this.speakingSynth = false;
  }

  async speak(text: string, opts: { lang?: string } = {}): Promise<void> {
    this.stop();
    const clean = text.replace(/[#*_`>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 3800);
    if (!clean) return;
    try {
      const res = await fetch(`/api/agents/${this.hireId}/tts`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, voice: this.voice ?? undefined }),
      });
      if (res.ok && (res.headers.get("content-type") ?? "").startsWith("audio/")) {
        const blob = await res.blob();
        if (!this.audio) this.unlock();
        const audio = this.audio!;
        audio.src = URL.createObjectURL(blob);
        if (!this.meter) { try { this.meter = audioLevelMeter(audio); } catch { this.meter = null; } }
        this.source = "server";
        await audio.play();
        await new Promise<void>((resolve) => { audio.onended = () => resolve(); audio.onerror = () => resolve(); audio.onpause = () => resolve(); });
        return;
      }
    } catch { /* fall through to the device voice */ }
    await this.deviceSpeak(clean, opts.lang);
  }

  private deviceSpeak(text: string, lang?: string): Promise<void> {
    if (!("speechSynthesis" in window)) return Promise.resolve();
    this.source = "device";
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const arabic = /[؀-ۿ]/.test(text);
      u.lang = lang ?? (arabic ? "ar-AE" : "en-US");
      const v = window.speechSynthesis.getVoices().find((x) => x.lang.startsWith(u.lang.slice(0, 2)));
      if (v) u.voice = v;
      u.onstart = () => { this.speakingSynth = true; };
      u.onend = u.onerror = () => { this.speakingSynth = false; resolve(); };
      window.speechSynthesis.speak(u);
    });
  }
}
