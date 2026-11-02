"use client";

import { Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TalkingPortrait } from "../talking-portrait";

/**
 * Talking presenter for the landing hero. Uses the browser's own voice (free,
 * nothing leaves the device), with lip movement driven while it speaks.
 * Set NEXT_PUBLIC_HERO_AVATAR_URL (+ optional _ANCHOR "x,y" in 0..1) to use a
 * real photo instead of the built-in illustrated presenter.
 */
const SCRIPT = {
  en: "Hi, I'm Layla from LexOS. I work alongside your lawyers: I take intake calls, draft contracts and summarise your matter files, in English and Arabic. Everything I write is a draft for your team to review. Start a free trial and hire your AI legal team today.",
  ar: "مرحباً، أنا ليلى من ليكسوس. أعمل جنباً إلى جنب مع محاميكم: أستقبل مكالمات العملاء، وأصيغ العقود، وألخص ملفات القضايا باللغتين العربية والإنجليزية. كل ما أكتبه مسودة يراجعها فريقكم. ابدأ تجربتك المجانية اليوم.",
};

export function HeroAvatar() {
  const photo = process.env.NEXT_PUBLIC_HERO_AVATAR_URL || "";
  const anchorEnv = (process.env.NEXT_PUBLIC_HERO_AVATAR_ANCHOR || "").split(",").map(Number);
  const anchor = anchorEnv.length === 2 && anchorEnv.every((n) => n >= 0 && n <= 1) ? { x: anchorEnv[0], y: anchorEnv[1] } : null;

  const [speaking, setSpeaking] = useState(false);
  const supported = useSyncExternalStore(() => () => undefined, () => "speechSynthesis" in window, () => true);
  const [lang, setLang] = useState<"en" | "ar">("en");
  const pulse = useRef(0);
  const mouthRef = useRef<SVGEllipseElement>(null);
  const speakingRef = useRef(false);

  useEffect(() => () => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); }, []);

  // Lip level: syllable-like oscillation while speaking, boosted on word boundaries.
  const level = () => {
    if (!speakingRef.current) return 0;
    const t = performance.now() / 1000;
    pulse.current *= 0.9;
    const base = 0.35 + 0.3 * Math.abs(Math.sin(t * 11)) + 0.2 * Math.abs(Math.sin(t * 6.3 + 1));
    return Math.min(1, base * (0.7 + pulse.current));
  };

  // Drive the illustrated mouth.
  useEffect(() => {
    if (photo) return;
    let raf = 0;
    let open = 0;
    const tick = () => {
      const target = level();
      open += (target - open) * (target > open ? 0.5 : 0.25);
      mouthRef.current?.setAttribute("ry", (1.2 + open * 7).toFixed(2));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [photo]);

  function stop() {
    window.speechSynthesis.cancel();
    speakingRef.current = false;
    setSpeaking(false);
  }

  function speak() {
    if (!supported) return;
    if (speaking) { stop(); return; }
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(SCRIPT[lang]);
    u.lang = lang === "ar" ? "ar-AE" : "en-US";
    u.rate = 1;
    const voices = synth.getVoices();
    const want = lang === "ar" ? /^ar/i : /^en/i;
    const female = /female|samantha|zira|jenny|aria|salma|hoda|laila|zariyah|google uk english female|serena|karen|moira|tessa/i;
    u.voice = voices.find((v) => want.test(v.lang) && female.test(v.name)) ?? voices.find((v) => want.test(v.lang)) ?? null;
    u.onstart = () => { speakingRef.current = true; setSpeaking(true); };
    u.onboundary = () => { pulse.current = 0.5; };
    u.onend = u.onerror = () => { speakingRef.current = false; setSpeaking(false); };
    synth.speak(u);
  }

  return (
    <div className="absolute inset-0">
      {photo ? (
        <TalkingPortrait src={photo} anchor={anchor} level={level} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <Presenter mouthRef={mouthRef} speaking={speaking} />
      )}

      <div className="absolute inset-x-0 bottom-[22%] z-10 flex justify-center sm:bottom-[21%]">
        <div className="glass flex items-center gap-1 rounded-full p-1 shadow-lg">
          <button type="button" onClick={speak} disabled={!supported} aria-pressed={speaking}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink shadow-md shadow-accent/30 transition hover:scale-[1.03] disabled:opacity-50">
            {speaking ? <><Square size={13} fill="currentColor" /> Stop</> : <><Volume2 size={16} /> {lang === "ar" ? "استمع إلى ليلى" : "Hear from Layla"}</>}
          </button>
          <button type="button" onClick={() => { if (speaking) stop(); setLang((l) => (l === "en" ? "ar" : "en")); }}
            className="pointer-events-auto rounded-full px-3 py-2 text-xs font-medium text-muted hover:text-ink" aria-label="Switch language">
            {lang === "en" ? "عربي" : "EN"}
          </button>
        </div>
      </div>
      {!supported && <p className="absolute inset-x-0 bottom-[17%] text-center text-[11px] text-muted">Voice playback isn&apos;t available in this browser.</p>}
    </div>
  );
}

/** Illustrated professional presenter (navy suit), with blinking eyes and an animatable mouth. */
function Presenter({ mouthRef, speaking }: { mouthRef: React.RefObject<SVGEllipseElement | null>; speaking: boolean }) {
  return (
    <svg viewBox="0 0 400 500" className="absolute inset-0 h-full w-full" role="img" aria-label="Layla, a LexOS AI legal assistant" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="ha-bg" cx="50%" cy="38%" r="70%">
          <stop offset="0" stopColor="#1d3a78" /><stop offset="0.6" stopColor="#0f1f45" /><stop offset="1" stopColor="#0a1530" />
        </radialGradient>
        <linearGradient id="ha-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e9b996" /><stop offset="1" stopColor="#d49e7a" /></linearGradient>
        <linearGradient id="ha-hair" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2b1d17" /><stop offset="1" stopColor="#120c0a" /></linearGradient>
        <linearGradient id="ha-suit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a5aa8" /><stop offset="1" stopColor="#1d2f63" /></linearGradient>
        <radialGradient id="ha-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#5aa0ff" stopOpacity=".35" /><stop offset="1" stopColor="#5aa0ff" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="400" height="500" fill="url(#ha-bg)" />
      {/* soft office windows */}
      <g opacity=".12" fill="#9cc2ff">
        <rect x="24" y="60" width="60" height="150" rx="4" /><rect x="96" y="60" width="60" height="150" rx="4" />
        <rect x="244" y="60" width="60" height="150" rx="4" /><rect x="316" y="60" width="60" height="150" rx="4" />
      </g>
      <circle cx="200" cy="200" r={speaking ? 150 : 135} fill="url(#ha-glow)" style={{ transition: "r .4s" }} />

      <g className="ha-breathe"><g transform="translate(40 46) scale(0.8)">
        {/* hair back */}
        <path d="M120 210 C112 122 160 84 205 86 C260 88 294 130 286 212 C284 246 292 270 300 292 C276 300 252 296 240 286 L160 286 C148 296 124 300 100 292 C108 270 118 246 120 210Z" fill="url(#ha-hair)" />
        {/* neck */}
        <path d="M176 262 L176 312 C186 324 214 324 224 312 L224 262Z" fill="#cf9a76" />
        {/* body / suit */}
        <path d="M40 640 C42 430 100 344 176 318 L200 352 L224 318 C300 344 358 430 360 640Z" fill="url(#ha-suit)" />
        {/* blouse */}
        <path d="M176 318 L200 352 L224 318 L214 312 L200 330 L186 312Z" fill="#f4f6fb" />
        <path d="M190 330 L200 352 L200 640 L194 640 Z" fill="#e6eaf3" opacity=".6" />
        {/* lapels */}
        <path d="M176 318 L152 360 L184 380 L200 352Z" fill="#2a4386" />
        <path d="M224 318 L248 360 L216 380 L200 352Z" fill="#2a4386" />
        {/* lapel pin (scales of justice in gold) */}
        <circle cx="244" cy="372" r="5" fill="#e8c168" />
        {/* face */}
        <ellipse cx="200" cy="198" rx="64" ry="78" fill="url(#ha-skin)" />
        {/* ears */}
        <ellipse cx="137" cy="204" rx="8" ry="14" fill="#d49e7a" /><ellipse cx="263" cy="204" rx="8" ry="14" fill="#d49e7a" />
        <circle cx="137" cy="216" r="2.6" fill="#e8c168" /><circle cx="263" cy="216" r="2.6" fill="#e8c168" />
        {/* hair front / fringe */}
        <path d="M134 196 C128 130 170 104 210 108 C250 112 276 140 268 190 C256 150 226 134 196 138 C170 142 148 160 134 196Z" fill="url(#ha-hair)" />
        {/* brows */}
        <path d="M164 176 Q178 168 192 174" stroke="#2b1d17" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M208 174 Q222 168 236 176" stroke="#2b1d17" strokeWidth="4" fill="none" strokeLinecap="round" />
        {/* eyes */}
        <g className="ha-blink">
          <ellipse cx="178" cy="194" rx="9" ry="6.5" fill="#fff" /><ellipse cx="222" cy="194" rx="9" ry="6.5" fill="#fff" />
          <circle cx="179" cy="194" r="4.6" fill="#3a2418" /><circle cx="223" cy="194" r="4.6" fill="#3a2418" />
          <circle cx="180.6" cy="192.4" r="1.4" fill="#fff" /><circle cx="224.6" cy="192.4" r="1.4" fill="#fff" />
        </g>
        <path d="M168 189 Q178 184 188 189" stroke="#2b1d17" strokeWidth="2" fill="none" />
        <path d="M212 189 Q222 184 232 189" stroke="#2b1d17" strokeWidth="2" fill="none" />
        {/* nose */}
        <path d="M200 200 Q196 220 192 226 Q200 230 208 226" stroke="#b9805e" strokeWidth="2" fill="none" strokeLinecap="round" />
        {/* cheeks */}
        <ellipse cx="166" cy="224" rx="10" ry="6" fill="#e58f86" opacity=".25" /><ellipse cx="234" cy="224" rx="10" ry="6" fill="#e58f86" opacity=".25" />
        {/* mouth: inner (animated) + lips */}
        <ellipse ref={mouthRef} cx="200" cy="246" rx="12" ry="1.2" fill="#6b2a2a" />
        <path d="M184 244 Q192 239 200 242 Q208 239 216 244" stroke="#b5535a" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M186 247 Q200 256 214 247" stroke="#b5535a" strokeWidth="3" fill="none" strokeLinecap="round" />
      </g></g>
    </svg>
  );
}
