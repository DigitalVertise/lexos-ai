import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { CSSProperties } from "react";
import type { Organization } from "./types";

// ---------------------------------------------------------------------------
// Theme: firm colours applied as CSS variables
// ---------------------------------------------------------------------------

export const HEX = /^#[0-9a-f]{6}$/i;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Text colour that reads on top of a brand colour. */
export function inkOn(hex: string): string {
  return contrast(hex, "#ffffff") >= contrast(hex, "#111111") ? "#ffffff" : "#111111";
}

/** CSS variables for a firm. Only overrides what the firm chose. */
export function brandStyle(org: Pick<Organization, "brand_primary" | "brand_accent">): CSSProperties {
  const style: Record<string, string> = {};
  if (org.brand_primary && HEX.test(org.brand_primary)) {
    style["--accent"] = org.brand_primary;
    style["--accent-ink"] = inkOn(org.brand_primary);
    style["--ring"] = org.brand_primary;
  }
  if (org.brand_accent && HEX.test(org.brand_accent)) style["--gold"] = org.brand_accent;
  return style as CSSProperties;
}

export function themeAttr(theme: Organization["theme"] | null | undefined): "light" | "dark" | undefined {
  return theme === "light" || theme === "dark" ? theme : undefined;
}

// ---------------------------------------------------------------------------
// Website detection (logo + colours) — with SSRF protection
// ---------------------------------------------------------------------------

export class BrandingError extends Error {}

const MAX_HTML = 1_500_000;
const MAX_CSS = 600_000;

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::" || v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true;
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? privateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Normalises a firm website to https://host[/path] and rejects anything not public. */
export function normaliseWebsite(raw: string): URL {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`); } catch { throw new BrandingError("Enter a valid website address."); }
  if (u.protocol === "http:") u.protocol = "https:";
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) throw new BrandingError("Use a normal https:// website address.");
  if (!u.hostname.includes(".") || isIP(u.hostname)) throw new BrandingError("Use the firm's domain name, not an IP address.");
  u.hash = "";
  return u;
}

async function assertPublicHost(host: string) {
  const addrs = await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new BrandingError("That website could not be found.");
  if (addrs.some((a) => privateAddress(a.address))) throw new BrandingError("That address is not a public website.");
}

/** Fetch with manual redirects (each hop re-checked), size cap and timeout. */
async function safeFetch(url: URL, maxBytes: number, accept: string): Promise<{ text: string; url: URL }> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (current.protocol !== "https:") throw new BrandingError("The website redirected to an insecure address.");
    await assertPublicHost(current.hostname);
    const res = await fetch(current, {
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(8000),
      headers: { Accept: accept, "User-Agent": "LexOS-Branding/1.0 (+https://lexos-ai-digitalvertises-projects.vercel.app)" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current);
      continue;
    }
    if (!res.ok || !res.body) throw new BrandingError(`The website answered ${res.status}.`);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    await reader.cancel().catch(() => undefined);
    const buf = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.length, size - off)), off); off += c.length; if (off >= size) break; }
    return { text: new TextDecoder().decode(buf), url: current };
  }
  throw new BrandingError("Too many redirects.");
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(1).find(Boolean) ?? null;

export interface LogoCandidate { url: string; source: string; score: number }

/** Logo candidates from HTML, best first. Pure (tested). */
export function findLogos(html: string, base: URL): LogoCandidate[] {
  const out: LogoCandidate[] = [];
  const push = (raw: string | null, source: string, score: number) => {
    if (!raw || raw.startsWith("data:")) return;
    try {
      const u = new URL(raw.trim(), base);
      if (u.protocol === "https:" || u.protocol === "http:") { u.protocol = "https:"; out.push({ url: u.toString(), source, score }); }
    } catch { /* ignore */ }
  };
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const hay = `${attr(tag, "class") ?? ""} ${attr(tag, "id") ?? ""} ${attr(tag, "alt") ?? ""} ${attr(tag, "src") ?? ""}`.toLowerCase();
    if (/logo|brand/.test(hay)) push(attr(tag, "src") ?? attr(tag, "data-src"), "img", /\.svg(\?|$)/i.test(attr(tag, "src") ?? "") ? 95 : 90);
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (attr(tag, "rel") ?? "").toLowerCase();
    if (rel.includes("apple-touch-icon")) push(attr(tag, "href"), "apple-touch-icon", 70);
    else if (rel.includes("icon") && /\.(svg|png)(\?|$)/i.test(attr(tag, "href") ?? "")) push(attr(tag, "href"), "icon", 55);
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
    if (key === "og:logo") push(attr(tag, "content"), "og:logo", 85);
    if (key === "og:image") push(attr(tag, "content"), "og:image", 40);
  }
  const seen = new Set<string>();
  return out.sort((a, b) => b.score - a.score).filter((c) => !seen.has(c.url) && seen.add(c.url)).slice(0, 6);
}

function toHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Brand colours from HTML/CSS text, most used first; greys and near-white/black dropped. Pure (tested). */
export function extractColors(text: string, themeColor?: string | null): string[] {
  const counts = new Map<string, number>();
  const add = (hex: string, weight = 1) => {
    const h = hex.toLowerCase();
    const [r, g, b] = rgb(h);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat < 0.18 || max < 40 || (min > 225)) return; // greys, black, white
    counts.set(h, (counts.get(h) ?? 0) + weight);
  };
  if (themeColor && HEX.test(themeColor)) add(themeColor, 50);
  for (const m of text.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const v = m[1];
    add(v.length === 3 ? `#${v.split("").map((c) => c + c).join("")}` : `#${v}`);
  }
  for (const m of text.matchAll(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi)) add(toHex(+m[1], +m[2], +m[3]));
  // Merge near-duplicates so swatches are distinct.
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  const distinct: string[] = [];
  for (const h of ranked) {
    const [r, g, b] = rgb(h);
    if (distinct.every((d) => { const [x, y, z] = rgb(d); return Math.abs(r - x) + Math.abs(g - y) + Math.abs(b - z) > 60; })) distinct.push(h);
    if (distinct.length >= 8) break;
  }
  return distinct;
}

export interface DetectedBranding {
  website: string;
  title: string | null;
  logos: LogoCandidate[];
  colors: string[];
}

export async function detectBranding(raw: string): Promise<DetectedBranding> {
  const start = normaliseWebsite(raw);
  const { text: html, url } = await safeFetch(start, MAX_HTML, "text/html,application/xhtml+xml");
  const themeTag = (html.match(/<meta\b[^>]*name\s*=\s*["']theme-color["'][^>]*>/i) ?? [])[0];
  const themeColor = themeTag ? attr(themeTag, "content") : null;
  let cssText = (html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? []).join("\n");
  cssText += (html.match(/style\s*=\s*"[^"]*"/gi) ?? []).join("\n");
  // First same-site stylesheet carries most brand colours.
  const sheet = (html.match(/<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/gi) ?? []).map((t) => attr(t, "href")).find(Boolean);
  if (sheet) {
    try {
      const cssUrl = new URL(sheet, url);
      if (cssUrl.hostname === url.hostname || cssUrl.hostname.endsWith(`.${url.hostname.replace(/^www\./, "")}`)) {
        cssText += (await safeFetch(cssUrl, MAX_CSS, "text/css")).text;
      }
    } catch { /* colours are best-effort */ }
  }
  const title = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? null;
  return {
    website: `${url.origin}${url.pathname === "/" ? "" : url.pathname}`,
    title,
    logos: findLogos(html, url),
    colors: extractColors(cssText, themeColor),
  };
}
