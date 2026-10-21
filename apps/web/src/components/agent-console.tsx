"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Speaker } from "./speaker";
import { TalkingPortrait } from "./talking-portrait";
import { VideoWithFallback } from "./video-with-fallback";
import { Badge, Button, Card, Field, Notice, Select, Textarea } from "./ui";

type Mode = "task" | "chat" | "voice" | "avatar";
interface Msg { role: "user" | "assistant"; content: string }

interface Props {
  hireId: string;
  assistantName: string;
  matter: { id: string; ref: string } | null;
  disabledReason: string | null;
  avatar: {
    provider: string;
    providerName: string;
    kind: string;
    portraitUrl: string | null;
    anchor: { x: number; y: number } | null;
    voice: string | null;
    previewImage: string | null;
  } | null;
  initialMode?: Mode;
  /** The existing one-off task runner. */
  taskRunner: ReactNode;
}

type SR = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

function recognition(): SR | null {
  if (typeof window === "undefined") return null;
  const C = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;
  return C ? new C() : null;
}

export function AgentConsole({ initialMode = "task", hireId, assistantName, matter, disabledReason, avatar, taskRunner }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState<"en-US" | "ar-AE">("en-US");
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<{ url: string; provider: string } | null>(null);
  const [videoBusy, setVideoBusy] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const speaker = useMemo(() => new Speaker(hireId, avatar?.voice ?? null), [hireId, avatar?.voice]);
  const recRef = useRef<SR | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const srSupported = useSyncExternalStore(() => () => undefined, () => recognition() !== null, () => false);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages]);
  useEffect(() => () => speaker.stop(), [speaker]);

  const spoken = mode === "voice" || mode === "avatar";

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    speaker.unlock();
    setError(null);
    setVideo(null);
    const history: Msg[] = [...messages, { role: "user", content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    let reply = "";
    try {
      const res = await fetch(`/api/agents/${hireId}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, matterId: matter?.id ?? null, mode: mode === "task" ? "chat" : mode, messages: history.slice(-30) }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "The assistant could not answer.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += decoder.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: reply }]);
      }
    } catch (err) {
      setMessages(history);
      setError((err as Error).message);
      setBusy(false);
      return;
    }
    setBusy(false);
    if (spoken && reply) {
      if (avatar?.kind === "realtime" && avatar.provider === "livetalking") {
        await fetch(`/api/agents/${hireId}/realtime`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "say", text: reply.slice(0, 3000) }) });
      } else {
        await speaker.speak(reply, { lang });
      }
    }
  }

  function toggleMic() {
    if (listening) { recRef.current?.stop(); return; }
    const rec = recognition();
    if (!rec) { setError("Voice input isn't supported in this browser. Type instead, or use Safari / Chrome."); return; }
    speaker.unlock();
    speaker.stop();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      setInput((finalText + interim).trim());
    };
    rec.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") setError(e.error === "not-allowed" ? "Microphone permission was denied." : "Voice input stopped."); };
    rec.onend = () => { setListening(false); if (finalText.trim()) void send(finalText); };
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  async function hdVideo() {
    const last = [...messages].reverse().find((m) => m.role === "assistant" && m.content);
    if (!last || !avatar) return;
    setVideoBusy(avatar.provider === "leaptalk" ? "Rendering with LeapTalk (open source, free GPU — 20–90 s)…" : `Rendering with ${avatar.providerName}…`);
    setError(null);
    const res = await fetch(`/api/agents/${hireId}/video`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: last.content.slice(0, 1200) }),
    });
    if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; setVideoBusy(null); setError(j.error ?? "Video failed."); return; }
    if ((res.headers.get("content-type") ?? "").startsWith("video/")) {
      setVideo({ url: URL.createObjectURL(await res.blob()), provider: avatar.providerName });
      setVideoBusy(null);
      return;
    }
    const { jobId } = (await res.json()) as { jobId: string };
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const s = await fetch(`/api/agents/${hireId}/video?job=${encodeURIComponent(jobId)}`);
      const j = (await s.json().catch(() => ({}))) as { status?: string; url?: string; error?: string };
      if (j.status === "completed" && j.url) { setVideo({ url: j.url, provider: avatar.providerName }); setVideoBusy(null); return; }
      if (j.status === "failed" || !s.ok) { setVideoBusy(null); setError(j.error ?? "The provider could not render this video."); return; }
    }
    setVideoBusy(null);
    setError("Still rendering. Try again in a few minutes.");
  }

  const [realtimeUrl, setRealtimeUrl] = useState<string | null>(null);
  async function openRealtime() {
    const res = await fetch(`/api/agents/${hireId}/realtime`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "session" }) });
    const j = (await res.json().catch(() => ({}))) as { url?: string; token?: string; error?: string };
    if (!res.ok) return setError(j.error ?? "Could not start the live session.");
    if (j.url) setRealtimeUrl(j.url);
    else setError("Simli session created. Live Simli streaming in the browser is in beta and not enabled yet — use the built-in portrait or a video provider meanwhile.");
  }

  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-44">
          <Field label="Work with the assistant">
            <Select value={mode} onChange={(e) => { setMode(e.target.value as Mode); setError(null); speaker.stop(); speaker.unlock(); }} aria-label="Mode">
              <option value="task">Task — one-off draft or review</option>
              <option value="chat">Chat — conversation</option>
              <option value="voice">Voice — talk and listen</option>
              <option value="avatar">Avatar — talking assistant</option>
            </Select>
          </Field>
        </div>
        {mode !== "task" && (
          <>
            <div className="min-w-32">
              <Field label="Language">
                <Select value={lang} onChange={(e) => setLang(e.target.value as "en-US" | "ar-AE")}>
                  <option value="en-US">English</option>
                  <option value="ar-AE">العربية</option>
                </Select>
              </Field>
            </div>
            <Button variant="secondary" type="button" onClick={() => { speaker.stop(); setMessages([]); setVideo(null); setConversationId(crypto.randomUUID()); }}>New conversation</Button>
          </>
        )}
      </Card>

      {mode === "task" ? taskRunner : (
        <div className={mode === "avatar" ? "grid gap-4 md:grid-cols-[300px_minmax(0,1fr)]" : ""}>
          {mode === "avatar" && (
            <Card className="p-3">
              {!avatar ? (
                <p className="p-2 text-sm text-muted">No avatar yet. <Link className="text-accent" href={`/studio/${hireId}`}>Set one up in the Avatar studio</Link>.</p>
              ) : realtimeUrl ? (
                <div>
                  <Badge tone="ok">Live — {avatar.providerName} real-time session</Badge>
                  <iframe src={realtimeUrl} title="Live avatar" allow="autoplay; microphone" className="mt-2 aspect-square w-full rounded-xl border-0" />
                </div>
              ) : video ? (
                <div>
                  <Badge tone="ok">Live — generated by {video.provider}</Badge>
                  <VideoWithFallback src={video.url} poster={avatar.portraitUrl ?? avatar.previewImage} className="mt-2" label={`${assistantName} video reply`} />
                </div>
              ) : avatar.portraitUrl ? (
                <div>
                  <TalkingPortrait src={avatar.portraitUrl} anchor={avatar.anchor} level={speaker.level} />
                  <p className="mt-1 text-[11px] text-muted">Built-in portrait animation (approximate lip movement)</p>
                </div>
              ) : avatar.previewImage ? (
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={avatar.previewImage} alt="" className="w-full rounded-xl" referrerPolicy="no-referrer" />
                  <p className="mt-1 text-[11px] text-muted">Provider preview image. Use “Video of last reply” for a live render.</p>
                </div>
              ) : <p className="p-2 text-sm text-muted">Add a portrait in the <Link className="text-accent" href={`/studio/${hireId}`}>Avatar studio</Link>.</p>}
              {avatar && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {avatar.kind === "video" && (
                    <Button type="button" variant="secondary" disabled={!messages.some((m) => m.role === "assistant" && m.content) || Boolean(videoBusy)} onClick={hdVideo}>
                      Video of last reply
                    </Button>
                  )}
                  {avatar.kind === "realtime" && !realtimeUrl && <Button type="button" variant="secondary" onClick={openRealtime}>Start live session</Button>}
                  {video && <Button type="button" variant="secondary" onClick={() => setVideo(null)}>Back to portrait</Button>}
                </div>
              )}
              {videoBusy && <p className="mt-2 text-xs text-muted">{videoBusy}</p>}
            </Card>
          )}

          <Card className="flex min-h-80 flex-col p-4">
            <div className="flex-1 space-y-3 overflow-y-auto" aria-live="polite">
              {messages.length === 0 && (
                <p className="text-sm text-muted">
                  {mode === "chat" ? `Ask ${assistantName} anything${matter ? ` about ${matter.ref}` : ""}.` : `Tap the microphone and speak, or type. ${assistantName} answers out loud.`}
                </p>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "ml-10 rounded-lg bg-surface-2 p-3" : "mr-6 rounded-lg border border-line p-3"}>
                  <p className="mb-1 text-xs font-medium text-muted">{m.role === "user" ? "You" : assistantName}</p>
                  <p className="whitespace-pre-wrap text-sm">{m.content || (busy && i === messages.length - 1 ? "…" : "")}</p>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            {error && <div className="mt-3"><Notice tone="bad">{error}</Notice></div>}
            {disabledReason ? <div className="mt-3"><Notice tone="warn">{disabledReason}</Notice></div> : (
              <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
                {spoken && (
                  <Button type="button" variant={listening ? "danger" : "secondary"} onClick={toggleMic} aria-pressed={listening}
                    title={srSupported ? "Speak" : "Voice input not supported in this browser"} disabled={busy}>
                    {listening ? "■ Stop" : "🎤"}
                  </Button>
                )}
                <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} maxLength={8000} className="flex-1"
                  placeholder={listening ? "Listening…" : "Type a message"} dir="auto"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && mode === "chat") { e.preventDefault(); void send(input); } }} />
                <Button type="submit" disabled={busy || !input.trim()}>{busy ? "…" : "Send"}</Button>
              </form>
            )}
            <p className="mt-2 text-xs text-muted">Drafts for lawyer review. Conversations are saved privately to your account{matter ? ` and linked to ${matter.ref}` : ""}.</p>
          </Card>
        </div>
      )}
    </div>
  );
}
