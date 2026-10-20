"use client";

import { useRouter } from "next/navigation";
import { useActionState, useMemo, useRef, useState } from "react";
import { registerPortrait, saveAvatarSettings } from "@/lib/actions/avatar";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { AvatarConfig } from "@/lib/types";
import { SubmitButton } from "./form";
import { Speaker } from "./speaker";
import { AnchorPicker, TalkingPortrait } from "./talking-portrait";
import { Badge, Button, Card, Field, Input, Notice, Select } from "./ui";

export interface Library {
  provider: "heygen" | "elevenlabs";
  avatars: { id: string; name: string; previewUrl?: string | null; kind?: string }[];
  voices: { id: string; name: string; language?: string | null; previewAudio?: string | null }[];
  error: string | null;
}

interface Props {
  hireId: string;
  hireName: string;
  orgId: string;
  canEdit: boolean;
  avatar: AvatarConfig | null;
  portraitUrl: string | null;
  providers: { id: string; name: string; kind: string; usesPortrait: boolean; available: boolean }[];
  builtinVoices: { id: string; label: string }[];
  libraries: Library[];
  runtime: boolean;
}

type Preview =
  | { kind: "idle" }
  | { kind: "demo" }
  | { kind: "working"; note: string }
  | { kind: "live-video"; url: string; provider: string }
  | { kind: "error"; text: string };

export function AvatarStudio(p: Props) {
  const router = useRouter();
  const [saveState, saveAction] = useActionState(saveAvatarSettings, null);
  const [portraitState, portraitAction] = useActionState(registerPortrait, null);
  const [provider, setProvider] = useState(p.avatar?.provider ?? "builtin");
  const [voice, setVoice] = useState(p.avatar?.voice ?? "");
  const [anchor, setAnchor] = useState(p.avatar?.anchor ?? null);
  const [avatarId, setAvatarId] = useState(p.avatar?.provider_avatar_id ?? "");
  const [avatarKind, setAvatarKind] = useState(p.avatar?.provider_avatar_kind ?? "");
  const [previewImg, setPreviewImg] = useState(p.avatar?.provider_preview_url ?? "");
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [description, setDescription] = useState("");
  const [preview, setPreview] = useState<Preview>({ kind: "idle" });
  const speaker = useMemo(() => new Speaker(p.hireId, voice || null), [p.hireId, voice]);
  const fileRef = useRef<HTMLInputElement>(null);

  const meta = p.providers.find((x) => x.id === provider);
  const heygen = p.libraries.find((l) => l.provider === "heygen");
  const eleven = p.libraries.find((l) => l.provider === "elevenlabs");
  const sample = `Hello, I'm ${p.hireName}. I can help your team with today's matters.`;

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) return setMsg({ tone: "bad", text: "Use a PNG or JPG photo." });
    if (file.size > 6 * 1024 * 1024) return setMsg({ tone: "bad", text: "Photos can be up to 6 MB." });
    setBusy("upload");
    const path = `${p.orgId}/avatars/${p.hireId}/portrait-${crypto.randomUUID().slice(0, 12)}.${file.type === "image/png" ? "png" : "jpg"}`;
    const { error } = await supabaseBrowser().storage.from("documents").upload(path, file, { contentType: file.type, upsert: false });
    setBusy(null);
    if (error) return setMsg({ tone: "bad", text: "Upload failed. Please try again." });
    setPendingPath(path);
    setMsg({ tone: "ok", text: "Uploaded. Confirm consent below to use it." });
  }

  async function generate() {
    setBusy("generate");
    setMsg(null);
    const res = await fetch(`/api/agents/${p.hireId}/portrait`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description }),
    });
    setBusy(null);
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return setMsg({ tone: "bad", text: j.error ?? "Portrait generation failed." });
    setMsg({ tone: "ok", text: "AI portrait created. Tap the centre of the mouth to set the lip anchor, then save." });
    router.refresh();
  }

  async function demoPreview() {
    speaker.unlock();
    setPreview({ kind: "demo" });
    await speaker.speak(sample);
  }

  async function livePreview() {
    speaker.unlock();
    setPreview({ kind: "working", note: provider === "leaptalk" ? "Rendering on the free open-source GPU (20–90 s)…" : "Sent to provider, rendering…" });
    const res = await fetch(`/api/agents/${p.hireId}/video`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: sample }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      return setPreview({ kind: "error", text: j.error ?? "Generation failed." });
    }
    if ((res.headers.get("content-type") ?? "").startsWith("video/")) {
      return setPreview({ kind: "live-video", url: URL.createObjectURL(await res.blob()), provider: meta?.name ?? provider });
    }
    const { jobId } = (await res.json()) as { jobId: string };
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const s = await fetch(`/api/agents/${p.hireId}/video?job=${encodeURIComponent(jobId)}`);
      const j = (await s.json().catch(() => ({}))) as { status?: string; url?: string; error?: string };
      if (j.status === "completed" && j.url) return setPreview({ kind: "live-video", url: j.url, provider: meta?.name ?? provider });
      if (j.status === "failed" || !s.ok) return setPreview({ kind: "error", text: j.error ?? "The provider could not render this video." });
    }
    setPreview({ kind: "error", text: "Still rendering after 5 minutes. Try again later." });
  }

  const canLive = meta && (meta.kind === "video") && meta.available;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <Card className="p-5">
          <p className="text-sm font-medium">1. Portrait</p>
          <p className="mt-1 text-xs text-muted">Used by the built-in portrait, LeapTalk and D-ID. HeyGen and Simli use their own avatars (step 3).</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              {p.portraitUrl ? (
                <AnchorPicker src={p.portraitUrl} value={anchor} onChange={(v) => p.canEdit && setAnchor(v)} />
              ) : (
                <div className="flex aspect-square w-full max-w-sm items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted">No portrait yet</div>
              )}
              {p.portraitUrl && <p className="mt-2 text-xs text-muted">{anchor ? `Lip anchor set (${Math.round(anchor.x * 100)}%, ${Math.round(anchor.y * 100)}%). ` : ""}Tap the centre of the mouth to {anchor ? "move" : "set"} the lip anchor.</p>}
              {p.avatar?.portrait_source && <p className="mt-1 text-xs text-muted">Source: {p.avatar.portrait_source === "generated" ? "AI-generated fictional person" : "uploaded photo (consent recorded)"}</p>}
            </div>
            {p.canEdit && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium">Generate an AI portrait</p>
                  <p className="text-xs text-muted">Creates a fictional person (FLUX, open source). Real or famous people are refused.</p>
                  <Input className="mt-2" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. friendly Emirati woman in her 30s, navy blazer" maxLength={400} />
                  <Button className="mt-2" type="button" variant="secondary" disabled={busy !== null || description.trim().length < 3 || !p.runtime} onClick={generate}>
                    {busy === "generate" ? "Generating… (up to a minute)" : "Generate portrait"}
                  </Button>
                  {!p.runtime && <p className="mt-1 text-xs text-warn">Needs the LexOS agent runtime (being connected). Upload a photo meanwhile.</p>}
                </div>
                <div>
                  <p className="text-sm font-medium">Or upload a photo</p>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="mt-2 w-full text-sm" onChange={(e) => upload(e.target.files?.[0])} />
                  {busy === "upload" && <p className="text-xs text-muted">Uploading…</p>}
                  {pendingPath && (
                    <form action={portraitAction} className="mt-2 space-y-2 rounded-lg border border-line p-3">
                      <input type="hidden" name="hireId" value={p.hireId} />
                      <input type="hidden" name="path" value={pendingPath} />
                      <label className="flex items-start gap-2 text-xs">
                        <input type="checkbox" name="consent" required className="mt-0.5" />
                        <span>I confirm this is my own photo, or the person shown has given written permission for it to be used as a talking AI avatar for this firm.</span>
                      </label>
                      <SubmitButton>Use this photo</SubmitButton>
                    </form>
                  )}
                  {portraitState?.error && <Notice tone="bad">{portraitState.error}</Notice>}
                  {portraitState?.ok && <Notice tone="ok">{portraitState.ok}</Notice>}
                </div>
                {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
              </div>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <form action={saveAction} className="space-y-4">
            <input type="hidden" name="hireId" value={p.hireId} />
            {anchor && <><input type="hidden" name="anchorX" value={anchor.x} /><input type="hidden" name="anchorY" value={anchor.y} /></>}
            <input type="hidden" name="avatarId" value={avatarId} />
            <input type="hidden" name="avatarKind" value={avatarKind} />
            <input type="hidden" name="preview" value={previewImg} />

            <Field label="2. Provider">
              <Select name="provider" value={provider} onChange={(e) => setProvider(e.target.value)} disabled={!p.canEdit}>
                {p.providers.filter((x) => x.kind !== "voice").map((x) => (
                  <option key={x.id} value={x.id} disabled={!x.available}>{x.name}{x.available ? "" : " — connect in Avatar studio"}</option>
                ))}
              </Select>
            </Field>

            {provider === "heygen" && (
              <div>
                <p className="text-sm font-medium">3. HeyGen avatar</p>
                {heygen?.error && <Notice tone="bad">HeyGen: {heygen.error}</Notice>}
                <div className="mt-2 grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                  {(heygen?.avatars ?? []).map((a) => (
                    <button key={a.id} type="button" onClick={() => { setAvatarId(a.id); setAvatarKind(a.kind ?? "avatar"); setPreviewImg(a.previewUrl ?? ""); }}
                      className={`overflow-hidden rounded-lg border text-left ${avatarId === a.id ? "border-accent ring-2 ring-accent" : "border-line"}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {a.previewUrl ? <img src={a.previewUrl} alt="" className="aspect-square w-full object-cover" referrerPolicy="no-referrer" /> : <div className="aspect-square bg-surface-2" />}
                      <p className="truncate px-1 py-0.5 text-[11px]">{a.name}</p>
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted">Images are HeyGen’s own previews from your account.</p>
              </div>
            )}
            {provider === "simli" && (
              <Field label="3. Simli face ID" hint="From your Simli dashboard (Faces).">
                <Input value={avatarId} onChange={(e) => setAvatarId(e.target.value)} maxLength={200} disabled={!p.canEdit} />
              </Field>
            )}

            <Field label={provider === "heygen" ? "4. HeyGen voice" : "Voice"}>
              <Select name="voice" value={voice} onChange={(e) => setVoice(e.target.value)} disabled={!p.canEdit}>
                {provider === "heygen" ? (
                  <>
                    <option value="">Choose a HeyGen voice…</option>
                    {(heygen?.voices ?? []).map((v) => <option key={v.id} value={`heygen:${v.id}`}>{v.name}{v.language ? ` (${v.language})` : ""}</option>)}
                  </>
                ) : (
                  <>
                    <option value="">Automatic (English or Arabic by text)</option>
                    <optgroup label="LexOS neural voices (free)">
                      {p.builtinVoices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </optgroup>
                    {eleven && eleven.voices.length > 0 && (
                      <optgroup label="ElevenLabs (your account)">
                        {eleven.voices.map((v) => <option key={v.id} value={`elevenlabs:${v.id}`}>{v.name}</option>)}
                      </optgroup>
                    )}
                  </>
                )}
              </Select>
            </Field>
            {eleven?.error && <Notice tone="bad">ElevenLabs: {eleven.error}</Notice>}

            {p.canEdit && <SubmitButton>Save avatar</SubmitButton>}
            {saveState?.error && <Notice tone="bad">{saveState.error}</Notice>}
            {saveState?.ok && <Notice tone="ok">{saveState.ok}</Notice>}
          </form>
        </Card>
      </div>

      <aside className="space-y-4">
        <Card className="p-4">
          <p className="text-sm font-medium">Preview</p>
          <div className="mt-3">
            {preview.kind === "live-video" ? (
              <div>
                <Badge tone="ok">Live — generated by {preview.provider} just now</Badge>
                <video src={preview.url} controls autoPlay playsInline className="mt-2 w-full rounded-xl" />
              </div>
            ) : p.portraitUrl ? (
              <div>
                {preview.kind === "demo" && <Badge tone="warn">Demo preview — built-in animation in your browser, not provider-generated</Badge>}
                <TalkingPortrait src={p.portraitUrl} anchor={anchor} level={speaker.level} className="mt-2 w-full rounded-xl bg-surface-2" />
              </div>
            ) : previewImg ? (
              <div>
                <Badge>Provider preview image — not a generated video</Badge>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewImg} alt="" className="mt-2 w-full rounded-xl" referrerPolicy="no-referrer" />
              </div>
            ) : (
              <p className="text-sm text-muted">Add a portrait or pick a provider avatar to preview.</p>
            )}
            {preview.kind === "working" && <p className="mt-2 text-sm text-muted">{preview.note}</p>}
            {preview.kind === "error" && <div className="mt-2"><Notice tone="bad">{preview.text}</Notice></div>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={demoPreview} disabled={!p.portraitUrl}>Demo preview (free)</Button>
            <Button type="button" onClick={livePreview} disabled={!canLive || preview.kind === "working"}>Generate live preview</Button>
          </div>
          <p className="mt-2 text-xs text-muted">
            “Demo” uses the built-in in-browser animation. “Live” calls {meta?.name ?? "the provider"} for real and may use your provider credits.
            Save first so the live preview uses your latest settings.
          </p>
        </Card>
      </aside>
    </div>
  );
}
