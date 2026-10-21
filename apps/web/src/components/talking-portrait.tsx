"use client";

import { useEffect, useRef } from "react";

/**
 * Built-in talking portrait: draws the portrait on a canvas and opens the jaw
 * below the lip anchor in time with the audio level. Approximate lip movement
 * (no viseme model) — instant, free and private: nothing leaves the browser.
 */
export function TalkingPortrait({ src, anchor, level, className }: {
  src: string;
  anchor: { x: number; y: number } | null | undefined;
  /** Returns the current speech level 0..1 (read every frame). */
  level: () => number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  useEffect(() => { levelRef.current = level; }, [level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.src = src;
    let raf = 0;
    let open = 0;
    const start = performance.now();

    const draw = () => {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      if (!img.complete || !img.naturalWidth) { raf = requestAnimationFrame(draw); return; }
      const t = (performance.now() - start) / 1000;
      const bob = Math.sin(t * 1.3) * H * 0.002;           // idle breathing
      const target = Math.min(1, Math.max(0, levelRef.current()));
      open += (target - open) * (target > open ? 0.55 : 0.25); // fast open, slower close
      ctx.drawImage(img, 0, bob, W, H);
      const a = anchor ?? { x: 0.5, y: 0.66 };
      const ax = a.x * W, ay = a.y * H + bob;
      const drop = open * H * 0.032;
      if (drop > 0.4) {
        // Mouth cavity.
        ctx.save();
        ctx.fillStyle = "rgba(40, 14, 16, 0.9)";
        ctx.beginPath();
        ctx.ellipse(ax, ay + drop * 0.45, W * 0.065, drop * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // Lower lip + chin moved down inside a soft elliptical mask.
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(ax, ay + H * 0.1, W * 0.19, H * 0.12, 0, 0, Math.PI * 2);
        ctx.clip();
        const sy = a.y * img.naturalHeight; // source row of the lip line
        ctx.drawImage(img, 0, sy, img.naturalWidth, img.naturalHeight - sy, 0, ay + drop, W, H - a.y * H);
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };

    const fit = () => {
      const w = canvas.clientWidth || 320;
      const ratio = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(w * ratio * dpr);
      canvas.style.height = `${Math.round(w * ratio)}px`;
    };
    img.onload = fit;
    window.addEventListener("resize", fit);
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", fit); };
  }, [src, anchor]);

  return <canvas ref={canvasRef} className={className ?? "w-full rounded-xl bg-surface-2"} role="img" aria-label="Talking assistant portrait" />;
}

/** Audio-level meter for an <audio> element (Web Audio analyser). */
export function audioLevelMeter(audio: HTMLAudioElement): { level: () => number; close: () => void } {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const source = ctx.createMediaElementSource(audio);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  analyser.connect(ctx.destination);
  const data = new Uint8Array(analyser.fftSize);
  void ctx.resume();
  return {
    level: () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
      return Math.min(1, Math.sqrt(sum / data.length) * 5.5);
    },
    close: () => { void ctx.close(); },
  };
}

/** Speech-like envelope when only the device's built-in speech is available (no audio stream to analyse). */
export function syntheticLevel(isSpeaking: () => boolean): () => number {
  return () => {
    if (!isSpeaking()) return 0;
    const t = performance.now() / 1000;
    return Math.max(0, 0.45 + 0.35 * Math.sin(t * 17) * Math.sin(t * 5.3) + 0.2 * Math.sin(t * 29));
  };
}

/** Tap on the portrait to set the lip anchor (relative 0..1 coordinates). */
export function AnchorPicker({ src, value, onChange }: { src: string; value: { x: number; y: number } | null; onChange: (v: { x: number; y: number }) => void }) {
  return (
    <div className="relative inline-block w-full max-w-sm select-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src} alt="Portrait — tap the centre of the mouth" className="w-full cursor-crosshair rounded-xl"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onChange({ x: +((e.clientX - r.left) / r.width).toFixed(4), y: +((e.clientY - r.top) / r.height).toFixed(4) });
        }}
      />
      {value && (
        <span aria-hidden className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow"
          style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%` }} />
      )}
    </div>
  );
}
