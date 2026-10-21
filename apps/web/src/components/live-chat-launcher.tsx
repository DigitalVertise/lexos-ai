"use client";

import { Mic, X } from "lucide-react";
import { useState } from "react";
import { EmbeddedApp } from "./embedded-app";

/** Floating "Talk to LexOS" button that opens the live voice/video assistant. */
export function LiveChatLauncher({ src, label = "Talk to LexOS" }: { src: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && (
        <div className="fixed inset-x-3 bottom-20 z-50 h-[70dvh] max-h-[640px] sm:inset-x-auto sm:right-5 sm:w-[400px]">
          <div className="relative h-full shadow-2xl shadow-black/50">
            <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant"
              className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70">
              <X className="h-4 w-4" aria-hidden />
            </button>
            <EmbeddedApp src={src} title="Live assistant" allow="microphone; camera; autoplay; clipboard-write" className="h-full" />
          </div>
        </div>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="fixed bottom-5 right-4 z-50 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-semibold text-accent-ink shadow-lg shadow-accent/30 transition-transform hover:scale-105 sm:right-5">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70 motion-reduce:hidden" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
        </span>
        <Mic className="h-4 w-4" aria-hidden /> {open ? "Close" : label}
      </button>
    </>
  );
}
