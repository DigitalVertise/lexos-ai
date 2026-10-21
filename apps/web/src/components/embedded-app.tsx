"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cx } from "./ui";

/**
 * Embeds a companion app with a visible fallback. Some browsers (iPhone Safari)
 * block sign-in cookies inside embedded apps on another domain, so an
 * "Open in new tab" button is always offered and the frame shows a notice if
 * it hasn't loaded in time.
 */
export function EmbeddedApp({ src, title, allow, className }: { src: string; title: string; allow?: string; className?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={cx("relative overflow-hidden rounded-xl border border-line bg-surface", className)}>
      <iframe
        src={src}
        title={title}
        allow={allow ?? "clipboard-write"}
        className={cx("h-full w-full border-0 transition-opacity duration-500", loaded ? "opacity-100" : "opacity-0")}
        onLoad={() => setLoaded(true)}
        referrerPolicy="strict-origin-when-cross-origin"
      />
      {!loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden />
          <p className="text-sm text-muted">{slow ? `${title} is taking a while to open here.` : `Opening ${title}…`}</p>
          {slow && (
            <a href={src} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink">
              Open in new tab <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
