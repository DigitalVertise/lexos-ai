"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

/**
 * Video that keeps a still image on screen until playback has really started.
 * If autoplay is blocked (common on iPhone when the video has sound) or the
 * file fails, the image stays and a play button appears.
 */
type Props = { src: string; poster: string | null | undefined; className?: string; label?: string };

/** Remounts per source so state resets cleanly. */
export function VideoWithFallback(props: Props) {
  return <VideoInner key={props.src} {...props} />;
}

function VideoInner({ src, poster, className, label = "Assistant video" }: {
  src: string;
  poster: string | null | undefined;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const p = v.play();
    if (p) p.catch(() => setBlocked(true));
    // If nothing has started after a few seconds, offer the play button.
    const t = setTimeout(() => { if (v.paused) setBlocked(true); }, 4000);
    return () => clearTimeout(t);
  }, [src]);

  function tapPlay() {
    const v = ref.current;
    if (!v) return;
    setBlocked(false);
    v.play().catch(() => {
      // Last resort on strict autoplay policies: start muted, user can unmute.
      v.muted = true;
      v.play().catch(() => setBlocked(true));
    });
  }

  return (
    <div className={cx("relative min-h-56 overflow-hidden rounded-xl bg-surface-2", className)}>
      <video
        ref={ref}
        src={src}
        poster={poster ?? undefined}
        playsInline
        controls={playing}
        preload="auto"
        aria-label={label}
        className={cx("block w-full transition-opacity duration-500", playing ? "opacity-100" : "opacity-0")}
        onPlaying={() => { setPlaying(true); setBlocked(false); }}
        onWaiting={() => undefined}
        onError={() => { setFailed(true); setPlaying(false); }}
      />
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center">
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" referrerPolicy="no-referrer" />
          ) : <div className="absolute inset-0 bg-gradient-to-br from-accent/30 to-surface-2" />}
          {failed ? (
            <span className="relative rounded-full bg-black/60 px-3 py-1 text-xs text-white">Video unavailable — showing image</span>
          ) : blocked ? (
            <button type="button" onClick={tapPlay} aria-label="Play video"
              className="relative flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-lg transition-transform hover:scale-105">
              <svg viewBox="0 0 24 24" className="ml-1 h-6 w-6" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
            </button>
          ) : (
            <span className="relative flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-xs text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> Loading video…
            </span>
          )}
        </div>
      )}
    </div>
  );
}
