"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { LButton } from "./buttons";

const LINKS = [
  { href: "#features", label: "Features" },
  { href: "#team", label: "AI Team" },
  { href: "#workspace", label: "Workspace" },
  { href: "#pricing", label: "Pricing" },
];

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-display text-lg font-bold">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-extrabold text-accent-ink btn-glow">L</span>
      <span>Lex<span className="text-accent">OS</span> AI</span>
    </Link>
  );
}

export function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="nav-glass sticky top-0 z-50">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-ink">{l.label}</a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <LButton href="/login" variant="ghost">Sign in</LButton>
          <LButton href="/signup">Start free trial</LButton>
        </div>
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="grid h-10 w-10 place-items-center rounded-lg border border-line text-ink md:hidden"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open && (
        <div className="border-t border-line bg-bg/95 px-4 pb-5 pt-3 md:hidden">
          <nav aria-label="Mobile" className="flex flex-col">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-lg px-2 py-3 text-base text-ink">{l.label}</a>
            ))}
          </nav>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <LButton href="/login" variant="outline">Sign in</LButton>
            <LButton href="/signup">Start free trial</LButton>
          </div>
        </div>
      )}
    </header>
  );
}
