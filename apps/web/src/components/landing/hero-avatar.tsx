"use client";

import { Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PRESENTERS, presenterScript as script, type Presenter } from "@/lib/presenters";
import { TalkingPortrait, audioLevelMeter } from "../talking-portrait";

/**
 * Talking presenters for the landing hero. Photos live in /public/presenters;
 * the voice is the browser's own speech (free, nothing leaves the device) and
 * the portrait's jaw moves while it speaks. Anchors are the lip line (0..1).
 */
const FEMALE = /female|samantha|zira|jenny|aria|salma|hoda|laila|zariyah|serena|karen|moira|tessa|victoria|fiona/i;
const MALE = /male|daniel|david|alex|fred|guy|ryan|hamed|naayf|tarik|maged|thomas|oliver|george/i;

export function HeroAvatar() {
  const [index, setIndex] = useState(0);
  const p = PRESENTERS[index];
  const [speaking, setSpeaking] = useState(false);
  const [lang, setLang] = useState<"en" | "ar">("en");
  const supported = useSyncExternalStore(() => () => undefined, () => "speechSynthesis" in window, () => true);
  const pulse = useRef(0);
  const speakingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const meterRef = useRef<{ level: () => number; close: () => void } | null>(null);

  useEffect(() => () => { audioRef.current?.pause(); meterRef.current?.close(); if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); }, []);

  // Lip level: syllable-like oscillation while speaking, boosted on word boundaries.
  const level = () => {
    if (!speakingRef.current) return 0;
    if (meterRef.current) return Math.min(0.6, meterRef.current.level() * 0.75);
    const t = performance.now() / 1000;
    pulse.current *= 0.9;
    const base = 0.35 + 0.3 * Math.abs(Math.sin(t * 11)) + 0.2 * Math.abs(Math.sin(t * 6.3 + 1));
    return Math.min(0.55, 0.5 * base * (0.7 + pulse.current));
  };

  function stopAudio() {
    audioRef.current?.pause();
    audioRef.current = null;
    meterRef.current?.close();
    meterRef.current = null;
  }

  function stop() {
    stopAudio();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    speakingRef.current = false;
    setSpeaking(false);
  }

  /** Natural neural voice from the server; falls back to the device voice if it fails. */
  function speak(who: Presenter = p) {
    stop();
    const audio = new Audio(`/api/presenter-voice?p=${who.id}&lang=${lang}`);
    audio.crossOrigin = "anonymous";
    (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    audioRef.current = audio;
    try { meterRef.current = audioLevelMeter(audio); } catch { meterRef.current = null; }
    const done = () => { if (audioRef.current === audio) { stopAudio(); speakingRef.current = false; setSpeaking(false); } };
    audio.onplaying = () => { speakingRef.current = true; setSpeaking(true); };
    audio.onended = done;
    audio.onerror = () => { if (audioRef.current === audio) { stopAudio(); deviceSpeak(who); } };
    speakingRef.current = true;
    setSpeaking(true);
    audio.play().catch(() => { if (audioRef.current === audio) { stopAudio(); deviceSpeak(who); } });
  }

  function deviceSpeak(who: Presenter) {
    if (!supported) { speakingRef.current = false; setSpeaking(false); return; }
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(script(who, lang));
    u.lang = lang === "ar" ? "ar-AE" : "en-US";
    const voices = synth.getVoices().filter((v) => (lang === "ar" ? /^ar/i : /^en/i).test(v.lang));
    const pref = who.gender === "female" ? FEMALE : MALE;
    u.voice = voices.find((v) => pref.test(v.name) && !(who.gender === "male" && /female/i.test(v.name))) ?? voices[0] ?? null;
    if (!u.voice || !pref.test(u.voice.name)) u.pitch = who.gender === "male" ? 0.85 : 1.1;
    u.onstart = () => { speakingRef.current = true; setSpeaking(true); };
    u.onboundary = () => { pulse.current = 0.5; };
    u.onend = u.onerror = () => { speakingRef.current = false; setSpeaking(false); };
    synth.speak(u);
  }

  function choose(i: number) {
    if (speaking) stop();
    setIndex(i);
  }

  return (
    <div className="absolute inset-0">
      <TalkingPortrait key={p.id} src={p.src} anchor={p.anchor} level={level} className="absolute inset-0 h-full w-full" />

      <div className="absolute inset-x-0 bottom-[21%] z-10 flex flex-col items-center gap-2">
        <div className="glass flex items-center gap-1.5 rounded-full p-1 shadow-lg" role="radiogroup" aria-label="Choose a presenter">
          {PRESENTERS.map((x, i) => (
            <button key={x.id} type="button" role="radio" aria-checked={i === index} onClick={() => choose(i)} title={`${x.name.en} — ${x.role.en}`}
              className={`h-8 w-8 overflow-hidden rounded-full border-2 transition ${i === index ? "border-accent" : "border-transparent opacity-70 hover:opacity-100"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={x.src} alt={x.name.en} className="h-full w-full object-cover object-top" />
            </button>
          ))}
        </div>
        <div className="glass flex items-center gap-1 rounded-full p-1 shadow-lg">
          <button type="button" onClick={() => (speaking ? stop() : speak())} aria-pressed={speaking}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink shadow-md shadow-accent/30 transition hover:scale-[1.03] disabled:opacity-50">
            {speaking ? <><Square size={13} fill="currentColor" /> Stop</> : <><Volume2 size={16} /> {lang === "ar" ? `استمع إلى ${p.name.ar}` : `Hear from ${p.name.en}`}</>}
          </button>
          <button type="button" onClick={() => { if (speaking) stop(); setLang((l) => (l === "en" ? "ar" : "en")); }}
            className="rounded-full px-3 py-2 text-xs font-medium text-muted hover:text-ink" aria-label="Switch language">
            {lang === "en" ? "عربي" : "EN"}
          </button>
        </div>
      </div>
      
    </div>
  );
}
