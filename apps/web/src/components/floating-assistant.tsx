"use client";

import { Captions, MessageSquare, Mic, MicOff, Send, Square, Video, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Speaker } from "./speaker";
import { TalkingPortrait } from "./talking-portrait";

/**
 * Plug-and-play floating assistant: a launcher button plus a chat window with
 * Chat, Voice and Video modes. Talks to the firm's hired assistants through
 * the existing /api/agents/[id]/chat and /tts routes (same auth, limits and
 * saved history as the assistant pages). Voice pattern: tap to talk, the
 * agent replies out loud, and talking again interrupts it.
 */
export interface FloatingAgent {
  id: string;
  name: string;
  voice: string | null;
  portraitUrl: string | null;
  anchor: { x: number; y: number } | null;
}

type Mode = "chat" | "voice" | "video";
type Lang = "en-US" | "ar-AE";
interface Msg { role: "user" | "assistant"; content: string }

type SR = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

function recognition(): SR | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return C ? new C() : null;
}

const MODES: { id: Mode; label: string; icon: typeof MessageSquare }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "voice", label: "Voice", icon: Mic },
  { id: "video", label: "Video", icon: Video },
];

export function FloatingAssistant({ agents, disabledReason = null }: { agents: FloatingAgent[]; disabledReason?: string | null }) {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const agent = agents.find((a) => a.id === agentId) ?? agents[0] ?? null;
  const [mode, setMode] = useState<Mode>("chat");
  const [lang, setLang] = useState<Lang>("en-US");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const speaker = useMemo(() => new Speaker(agent?.id ?? "", agent?.voice ?? null), [agent?.id, agent?.voice]);
  const recRef = useRef<SR | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const srSupported = useSyncExternalStore(() => () => undefined, () => recognition() !== null, () => false);
  const spoken = mode !== "chat";

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [messages, open]);
  useEffect(() => () => speaker.stop(), [speaker]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function stopSpeaking() { speaker.stop(); setSpeaking(false); }

  function reset() {
    stopSpeaking();
    recRef.current?.stop();
    setMessages([]);
    setError(null);
    setConversationId(crypto.randomUUID());
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy || !agent) return;
    speaker.unlock();
    stopSpeaking();
    setError(null);
    const history: Msg[] = [...messages, { role: "user", content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    let reply = "";
    try {
      const res = await fetch(`/api/agents/${agent.id}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, matterId: null, mode: mode === "video" ? "avatar" : mode, messages: history.slice(-30) }),
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
      setSpeaking(true);
      try { await speaker.speak(reply, { lang }); } finally { setSpeaking(false); }
    }
  }

  function toggleMic() {
    if (listening) { recRef.current?.stop(); return; }
    const rec = recognition();
    if (!rec) { setError("Voice input isn't supported in this browser. Type instead, or use Safari or Chrome."); return; }
    speaker.unlock();
    stopSpeaking(); // barge-in: talking interrupts the assistant
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

  const placeholder = listening ? "Listening…" : lang === "ar-AE" ? "اكتب رسالتك" : "Type a message";

  return (
    <>
      {open && (
        <section role="dialog" aria-label={`${agent?.name ?? "LexOS"} assistant`}
          className="fixed inset-x-3 bottom-20 z-50 flex h-[72dvh] max-h-[660px] flex-col overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-2xl shadow-black/50 sm:inset-x-auto sm:right-5 sm:w-[400px]">
          <header className="flex items-center gap-2 border-b border-line/70 px-3 py-2.5">
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${speaking ? "animate-pulse bg-ok" : busy ? "bg-warn" : "bg-accent"}`} />
            {agents.length > 1 ? (
              <select value={agent?.id} onChange={(e) => { setAgentId(e.target.value); reset(); }} aria-label="Assistant"
                className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface-2 px-2 py-1 text-sm font-semibold">
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            ) : <p className="min-w-0 flex-1 truncate text-sm font-semibold">{agent?.name ?? "LexOS assistant"}</p>}
            <button type="button" onClick={() => setLang((l) => (l === "en-US" ? "ar-AE" : "en-US"))} title="Language"
              className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink">{lang === "en-US" ? "EN" : "ع"}</button>
            <button type="button" onClick={reset} title="New conversation" className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink">New</button>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant"
              className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"><X className="h-4 w-4" aria-hidden /></button>
          </header>

          <nav className="grid grid-cols-3 gap-1 border-b border-line/70 p-1.5" aria-label="Mode">
            {MODES.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" aria-pressed={mode === id}
                onClick={() => { speaker.unlock(); stopSpeaking(); setMode(id); setError(null); }}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium ${mode === id ? "bg-accent text-accent-ink" : "text-muted hover:bg-surface-2 hover:text-ink"}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              </button>
            ))}
          </nav>

          {!agent ? (
            <div className="flex-1 p-5 text-sm text-muted">
              No assistants hired yet. <Link className="text-accent" href="/assistants" onClick={() => setOpen(false)}>Hire one from the AI Team</Link> to start talking.
            </div>
          ) : (
            <>
              {mode === "video" && (
                <div className="border-b border-line/70 bg-surface-2/40 p-3">
                  {agent.portraitUrl ? (
                    <div className="mx-auto w-40"><TalkingPortrait src={agent.portraitUrl} anchor={agent.anchor} level={speaker.level} /></div>
                  ) : (
                    <p className="text-center text-xs text-muted">
                      No portrait for {agent.name} yet. <Link className="text-accent" href={`/studio/${agent.id}`} onClick={() => setOpen(false)}>Add one in the Avatar studio</Link>. Replies are still spoken.
                    </p>
                  )}
                </div>
              )}

              <div className="flex-1 space-y-2.5 overflow-y-auto p-3" aria-live="polite">
                {messages.length === 0 && (
                  <p className="text-sm text-muted">
                    {mode === "chat" ? `Hi, I'm ${agent.name}. How can I help?` : `Tap the microphone and speak. ${agent.name} answers out loud — tap again or start talking to interrupt.`}
                  </p>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "ml-auto rounded-br-sm bg-accent text-accent-ink" : "rounded-bl-sm bg-surface-2"}`} dir="auto">
                    {m.content || (busy && i === messages.length - 1 ? "…" : "")}
                  </div>
                ))}
                {error && <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs">{error}</p>}
                <div ref={endRef} />
              </div>

              {disabledReason ? (
                <p className="border-t border-line/70 p-3 text-xs text-warn">{disabledReason}</p>
              ) : (
                <form className="flex items-end gap-2 border-t border-line/70 p-2.5" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
                  {spoken && (
                    <button type="button" onClick={toggleMic} aria-pressed={listening} disabled={busy}
                      title={srSupported ? (listening ? "Stop and send" : "Talk") : "Voice input not supported in this browser"}
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${listening ? "animate-pulse bg-bad text-white" : "bg-accent text-accent-ink"} disabled:opacity-50`}>
                      {listening ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
                    </button>
                  )}
                  <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={8000} dir="auto" placeholder={placeholder}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
                    className="max-h-28 min-h-10 flex-1 resize-none rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent" />
                  {speaking ? (
                    <button type="button" onClick={stopSpeaking} title="Stop speaking" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-ink">
                      <Square className="h-3.5 w-3.5" fill="currentColor" aria-hidden />
                    </button>
                  ) : (
                    <button type="submit" disabled={busy || !input.trim()} title="Send" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-accent-ink disabled:opacity-50">
                      <Send className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </form>
              )}
              <p className="flex items-center gap-1 px-3 pb-2 text-[10px] text-muted"><Captions className="h-3 w-3" aria-hidden /> Drafts for lawyer review · saved privately to your account</p>
            </>
          )}
        </section>
      )}

      <button type="button" onClick={() => { speaker.unlock(); setOpen((o) => !o); }} aria-expanded={open} aria-label={open ? "Close assistant" : "Open assistant"}
        className="fixed bottom-5 right-4 z-50 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-3 text-sm font-semibold text-accent-ink shadow-lg shadow-accent/30 transition-transform hover:scale-105 sm:right-5">
        {open ? <X className="h-4 w-4" aria-hidden /> : (
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70 motion-reduce:hidden" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
          </span>
        )}
        {open ? "Close" : <><MessageSquare className="h-4 w-4" aria-hidden /> Ask LexOS</>}
      </button>
    </>
  );
}
