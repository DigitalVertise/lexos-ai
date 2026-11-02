"use client";

import { Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TalkingPortrait } from "../talking-portrait";

/**
 * Talking presenters for the landing hero. Photos live in /public/presenters;
 * the voice is the browser's own speech (free, nothing leaves the device) and
 * the portrait's jaw moves while it speaks. Anchors are the lip line (0..1).
 */
interface Presenter {
  id: string;
  name: { en: string; ar: string };
  role: { en: string; ar: string };
  src: string;
  anchor: { x: number; y: number };
  gender: "female" | "male";
}

const PRESENTERS: Presenter[] = [
  { id: "layla", name: { en: "Layla", ar: "ليلى" }, role: { en: "Client intake", ar: "استقبال العملاء" }, src: "/presenters/layla.webp", anchor: { x: 0.449, y: 0.392 }, gender: "female" },
  { id: "omar", name: { en: "Omar", ar: "عمر" }, role: { en: "Contract drafting", ar: "صياغة العقود" }, src: "/presenters/omar.webp", anchor: { x: 0.262, y: 0.52 }, gender: "male" },
  { id: "sarah", name: { en: "Sarah", ar: "سارة" }, role: { en: "Legal research", ar: "البحث القانوني" }, src: "/presenters/sarah.webp", anchor: { x: 0.43, y: 0.47 }, gender: "female" },
  { id: "james", name: { en: "James", ar: "جيمس" }, role: { en: "Litigation support", ar: "دعم التقاضي" }, src: "/presenters/james.webp", anchor: { x: 0.486, y: 0.604 }, gender: "male" },
];

function script(p: Presenter, lang: "en" | "ar") {
  return lang === "ar"
    ? `مرحباً، أنا ${p.name.ar} من فريق ليكسوس للذكاء الاصطناعي، ${p.gender === "female" ? "متخصصة" : "متخصص"} في ${p.role.ar}. أعمل جنباً إلى جنب مع محاميكم: أستقبل مكالمات العملاء، وأصيغ العقود، وألخص ملفات القضايا باللغتين العربية والإنجليزية. كل ما أكتبه مسودة يراجعها فريقكم. ابدأ تجربتك المجانية اليوم.`
    : `Hi, I'm ${p.name.en}, your AI ${p.role.en.toLowerCase()} assistant at LexOS. I work alongside your lawyers: I take intake calls, draft contracts and summarise your matter files, in English and Arabic. Everything I write is a draft for your team to review. Start a free trial and hire your AI legal team today.`;
}

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

  useEffect(() => () => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); }, []);

  // Lip level: syllable-like oscillation while speaking, boosted on word boundaries.
  const level = () => {
    if (!speakingRef.current) return 0;
    const t = performance.now() / 1000;
    pulse.current *= 0.9;
    const base = 0.35 + 0.3 * Math.abs(Math.sin(t * 11)) + 0.2 * Math.abs(Math.sin(t * 6.3 + 1));
    return Math.min(0.55, 0.5 * base * (0.7 + pulse.current));
  };

  function stop() {
    window.speechSynthesis.cancel();
    speakingRef.current = false;
    setSpeaking(false);
  }

  function speak(who: Presenter = p) {
    if (!supported) return;
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
          <button type="button" onClick={() => (speaking ? stop() : speak())} disabled={!supported} aria-pressed={speaking}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink shadow-md shadow-accent/30 transition hover:scale-[1.03] disabled:opacity-50">
            {speaking ? <><Square size={13} fill="currentColor" /> Stop</> : <><Volume2 size={16} /> {lang === "ar" ? `استمع إلى ${p.name.ar}` : `Hear from ${p.name.en}`}</>}
          </button>
          <button type="button" onClick={() => { if (speaking) stop(); setLang((l) => (l === "en" ? "ar" : "en")); }}
            className="rounded-full px-3 py-2 text-xs font-medium text-muted hover:text-ink" aria-label="Switch language">
            {lang === "en" ? "عربي" : "EN"}
          </button>
        </div>
      </div>
      {!supported && <p className="absolute inset-x-0 bottom-[15%] text-center text-[11px] text-muted">Voice playback isn&apos;t available in this browser.</p>}
    </div>
  );
}
