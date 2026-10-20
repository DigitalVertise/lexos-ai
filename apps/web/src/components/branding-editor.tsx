"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { applyUploadedLogo, detectFirmBranding, saveBranding, type DetectState } from "@/lib/actions/branding";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { SubmitButton } from "./form";
import { Button, Card, Field, Input, Notice, Select } from "./ui";

interface Props {
  orgId: string;
  website: string | null;
  logo: string | null;
  colors: string[];
  primary: string | null;
  accent: string | null;
  theme: "light" | "dark" | "auto";
}

const HEX = /^#[0-9a-f]{6}$/i;

export function BrandingEditor(props: Props) {
  const router = useRouter();
  const [detect, detectAction] = useActionState<DetectState, FormData>(detectFirmBranding, null);
  const [save, saveAction] = useActionState(saveBranding, null);
  const [logo, setLogo] = useState(props.logo ?? "");
  const [swatches, setSwatches] = useState<string[]>(props.colors);
  const [primary, setPrimary] = useState(props.primary ?? "");
  const [accent, setAccent] = useState(props.accent ?? "");
  const [custom, setCustom] = useState("#1d3a5f");
  const [upload, setUpload] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [lastDetect, setLastDetect] = useState<DetectState>(null);

  // Merge newly detected suggestions into the editor once per detection.
  if (detect !== lastDetect) {
    setLastDetect(detect);
    if (detect?.detected) {
      setSwatches((s) => [...new Set([...detect.detected!.colors, ...s])].slice(0, 12));
      if (!logo && detect.detected.logos[0]) setLogo(detect.detected.logos[0].url);
      if (!primary && detect.detected.colors[0]) setPrimary(detect.detected.colors[0]);
    }
  }

  async function onLogoFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setUpload({ tone: "bad", text: "Logos can be up to 2 MB." });
    const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" } as Record<string, string>)[file.type];
    if (!ext) return setUpload({ tone: "bad", text: "Use PNG, JPG, WebP or SVG." });
    const path = `${props.orgId}/logo-${crypto.randomUUID().slice(0, 12)}.${ext}`;
    const { error } = await supabaseBrowser().storage.from("branding").upload(path, file, { contentType: file.type, upsert: false });
    if (error) return setUpload({ tone: "bad", text: "Upload failed. (Has database update 0006 been run?)" });
    const fd = new FormData();
    fd.set("path", path);
    const res = await applyUploadedLogo(null, fd);
    if (res?.error) return setUpload({ tone: "bad", text: res.error });
    setLogo(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/${path}`);
    setUpload({ tone: "ok", text: "Logo uploaded." });
    router.refresh();
  }

  const preview = HEX.test(primary) ? primary : "#1d3a5f";

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <form action={detectAction} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Firm website" hint="We read the public homepage to suggest the logo and colours.">
            <Input name="website" type="url" inputMode="url" placeholder="https://yourfirm.com" defaultValue={props.website ?? ""} required />
          </Field>
          <SubmitButton pendingLabel="Reading website…">Detect branding</SubmitButton>
        </form>
        {detect?.error && <div className="mt-3"><Notice tone="bad">{detect.error}</Notice></div>}
        {detect?.ok && <div className="mt-3"><Notice tone="ok">{detect.ok}</Notice></div>}
        {detect?.detected && detect.detected.logos.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium">Logo options found — tap to use</p>
            <div className="flex flex-wrap gap-3">
              {detect.detected.logos.map((l) => (
                <button key={l.url} type="button" onClick={() => setLogo(l.url)}
                  className={`flex h-20 w-32 items-center justify-center rounded-lg border bg-white p-2 ${logo === l.url ? "border-accent ring-2 ring-accent" : "border-line"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={l.url} alt={`Logo option from ${l.source}`} className="max-h-full max-w-full object-contain" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <form action={saveAction} className="space-y-5">
          <input type="hidden" name="website" value={detect?.detected?.website ?? props.website ?? ""} />
          <div className="grid gap-4 sm:grid-cols-[1fr_160px] sm:items-end">
            <Field label="Logo" hint="Detected automatically, or paste a link, or upload your own.">
              <Input name="logo" type="url" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…/logo.png" />
            </Field>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Upload logo</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="w-full text-sm" onChange={(e) => onLogoFile(e.target.files?.[0])} />
            </label>
          </div>
          {upload && <Notice tone={upload.tone}>{upload.text}</Notice>}

          <div>
            <p className="mb-2 text-sm font-medium">Colours</p>
            {swatches.length === 0 && <p className="text-sm text-muted">No colours yet. Detect them from your website or add one below.</p>}
            <div className="flex flex-wrap gap-2">
              {swatches.map((c) => (
                <div key={c} className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1 pr-2">
                  <input type="hidden" name="swatch" value={c} />
                  <span className="h-7 w-7 rounded-md border border-line" style={{ background: c }} aria-hidden />
                  <span className="font-mono text-xs">{c}</span>
                  <button type="button" className="text-xs text-accent" onClick={() => setPrimary(c)}>Main</button>
                  <button type="button" className="text-xs text-accent" onClick={() => setAccent(c)}>Accent</button>
                  <button type="button" aria-label={`Remove ${c}`} className="text-xs text-muted" onClick={() => setSwatches((s) => s.filter((x) => x !== c))}>✕</button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Pick a colour" className="h-9 w-12 rounded border border-line" />
              <Input value={custom} onChange={(e) => setCustom(e.target.value)} className="w-28 font-mono" aria-label="Colour code" />
              <Button type="button" variant="secondary" disabled={!HEX.test(custom)}
                onClick={() => setSwatches((s) => [...new Set([...s, custom.toLowerCase()])].slice(0, 12))}>Add colour</Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Main colour (buttons, links)">
              <div className="flex gap-2">
                <input type="color" value={HEX.test(primary) ? primary : "#1d3a5f"} onChange={(e) => setPrimary(e.target.value)} className="h-9 w-12 rounded border border-line" aria-label="Main colour" />
                <Input name="primary" value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="#1d3a5f" className="font-mono" />
              </div>
            </Field>
            <Field label="Accent colour">
              <div className="flex gap-2">
                <input type="color" value={HEX.test(accent) ? accent : "#a3802f"} onChange={(e) => setAccent(e.target.value)} className="h-9 w-12 rounded border border-line" aria-label="Accent colour" />
                <Input name="accent" value={accent} onChange={(e) => setAccent(e.target.value)} placeholder="#a3802f" className="font-mono" />
              </div>
            </Field>
            <Field label="Theme">
              <Select name="theme" defaultValue={props.theme}>
                <option value="auto">Automatic (follows device)</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </Field>
          </div>

          <div className="rounded-lg border border-line p-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-muted">Preview</p>
            <div className="flex flex-wrap items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {logo && <img src={logo} alt="Logo preview" className="h-10 max-w-40 object-contain" referrerPolicy="no-referrer" />}
              <span className="rounded-lg px-3.5 py-2 text-sm font-medium" style={{ background: preview, color: contrastInk(preview) }}>Primary button</span>
              <span className="text-sm font-medium" style={{ color: preview }}>Link colour</span>
              {HEX.test(accent) && <span className="rounded px-2 py-0.5 text-xs" style={{ background: accent, color: contrastInk(accent) }}>Accent</span>}
            </div>
          </div>

          <SubmitButton>Save branding</SubmitButton>
          {save?.error && <Notice tone="bad">{save.error}</Notice>}
          {save?.ok && <Notice tone="ok">{save.ok}</Notice>}
        </form>
      </Card>
    </div>
  );
}

function contrastInk(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05 / (l + 0.05)) >= ((l + 0.05) / 0.0611) ? "#ffffff" : "#111111";
}
