"use client";

import { useCallback, useState, type ReactNode } from "react";

/**
 * Hero "AI agent" panel. The poster image is always layered on top and only fades out once
 * the video fires "playing". With no URL, or on error, the poster stays.
 */
export function HeroMedia({ videoUrl, poster, alt, children }: { videoUrl?: string; poster: string; alt: string; children?: ReactNode }) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  const attach = useCallback((el: HTMLVideoElement | null) => {
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.removeAttribute("autoplay");
      el.pause();
      return;
    }
    el.muted = true;
    if (!el.paused && el.currentTime > 0) setPlaying(true);
    else el.play().catch(() => {});
  }, []);

  const showVideo = Boolean(videoUrl) && !failed;

  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl border border-line bg-surface shadow-[0_40px_90px_-40px_rgba(24,119,242,0.55)]">
      {showVideo && (
        <video
          ref={attach}
          src={videoUrl}
          className="absolute inset-0 h-full w-full object-cover"
          playsInline
          muted
          autoPlay
          loop
          preload="auto"
          onPlaying={() => setPlaying(true)}
          onError={() => setFailed(true)}
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={poster}
        alt={alt}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${playing ? "opacity-0" : "opacity-100"}`}
        draggable={false}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg/50 via-transparent to-transparent" />
      {children}
    </div>
  );
}
