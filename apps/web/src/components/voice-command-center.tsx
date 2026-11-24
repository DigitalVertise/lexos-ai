"use client";

import { AudioLines, Mic, MicOff, Send, Square, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Speaker } from "./speaker";
import type { FloatingAgent } from "./floating-assistant";

type Lang = "en-US" | "ar-AE";
type Message = { role: "user" | "assistant"; content: string };
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null;
};

function makeRecognition(): Recognition | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Constructor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Constructor ? new Constructor() : null;
}

/** Neutral, voice-first assistant surface. Uses the app's existing authenticated agent and TTS APIs. */
export function VoiceCommandCenter({ agents, disabledReason = null }: {
  agents: FloatingAgent[]; disabledReason?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const agent = agents.find((item) => item.id === agentId) ?? agents[0] ?? null;
  const [lang, setLang] = useState<Lang>("en-US");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const speaker = useMemo(() => new Speaker(agent?.id ?? "", agent?.voice ?? null), [agent?.id, agent?.voice]);
  const recognitionRef = useRef<Recognition | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const voiceSupported = useSyncExternalStore(() => () => undefined, () => makeRecognition() !== null, () => false);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, open]);
  useEffect(() => () => { recognitionRef.current?.stop(); speaker.stop(); }, [speaker]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function stopSpeaking() { speaker.stop(); setSpeaking(false); }

  function resetConversation() {
    recognitionRef.current?.stop();
    stopSpeaking();
    setMessages([]);
    setInput("");
    setError(null);
    setConversationId(crypto.randomUUID());
  }

  async function sendMessage(raw: string) {
    const content = raw.trim();
    if (!content || busy || !agent || disabledReason) return;
    speaker.unlock();
    stopSpeaking();
    setError(null);
    const history: Message[] = [...messages, { role: "user", content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    let answer = "";
    try {
      const response = await fetch(`/api/agents/${agent.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, matterId: null, mode: "voice", messages: history.slice(-30) }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "The assistant could not respond. Please try again.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: answer }]);
      }
    } catch (cause) {
      setMessages(history);
      setError((cause as Error).message);
      setBusy(false);
      return;
    }
    setBusy(false);
    if (answer && !muted) {
      setSpeaking(true);
      try { await speaker.speak(answer, { lang }); }
      catch { setError("Text response received, but audio playback is unavailable."); }
      finally { setSpeaking(false); }
    }
  }

  function toggleMicrophone() {
    if (listening) { recognitionRef.current?.stop(); return; }
    const recognition = makeRecognition();
    if (!recognition) {
      setError("Voice input is not supported in this browser. Use Safari or Chrome, or type your message.");
      return;
    }
    speaker.unlock();
    stopSpeaking();
    setError(null);
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    let finalText = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      setInput((finalText + interim).trim());
    };
    recognition.onerror = (event) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        setError(event.error === "not-allowed" ? "Microphone permission was denied." : "Voice capture stopped.");
      }
    };
    recognition.onend = () => {
      setListening(false);
      if (finalText.trim()) void sendMessage(finalText);
    };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  return (
    <>
      {open && (
        <section role="dialog" aria-label="Voice assistant"
          className="fixed inset-x-3 bottom-20 z-50 flex h-[min(76dvh,700px)] flex-col overflow-hidden rounded-[28px] border border-line bg-surface text-ink shadow-2xl shadow-black/50 sm:inset-x-auto sm:right-5 sm:w-[410px]">
          <header className="flex items-center gap-3 border-b border-line/70 px-4 py-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-accent/15 text-accent"><AudioLines className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Voice assistant</p>
              <p className="text-[11px] text-muted">{speaking ? "Speaking" : listening ? "Listening" : busy ? "Thinking" : "Ready"}</p>
            </div>
            {agents.length > 1 && <select aria-label="Choose assistant" value={agent?.id ?? ""} onChange={(event) => { setAgentId(event.target.value); resetConversation(); }}
              className="max-w-32 rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs">
              {agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>}
            <button type="button" onClick={() => setLang((value) => value === "en-US" ? "ar-AE" : "en-US")}
              className="rounded-lg border border-line px-2 py-1.5 text-xs text-muted" aria-label="Switch language">{lang === "en-US" ? "EN" : "عربي"}</button>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-surface-2"><X className="h-4 w-4" /></button>
          </header>

          <div className="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-5 py-6">
            <div className="relative grid h-36 w-36 place-items-center">
              {(listening || speaking || busy) && <span className="absolute inset-0 animate-ping rounded-full border border-accent/30 motion-reduce:animate-none" />}
              <span className={`absolute inset-3 rounded-full bg-accent/10 blur-xl ${listening || speaking ? "opacity-100" : "opacity-50"}`} />
              <div className={`relative grid h-28 w-28 place-items-center rounded-full border border-accent/30 bg-gradient-to-br from-accent/25 to-surface shadow-[0_0_55px_-18px_var(--accent)] ${listening ? "ring-4 ring-accent/20" : ""}`}>
                {speaking ? <AudioLines className="h-11 w-11 text-accent" /> : listening ? <Mic className="h-11 w-11 text-accent" /> : <Sparkles className="h-11 w-11 text-accent" />}
              </div>
            </div>
            <div className="text-center">
              <p className="text-base font-semibold">{listening ? "I'm listening" : speaking ? "Speaking" : busy ? "Thinking…" : "How can I help?"}</p>
              <p className="mt-1 max-w-xs text-xs text-muted">{agent ? `Connected to ${agent.name}` : "No assistant is available yet"}</p>
            </div>
            {messages.length > 0 && (
              <div className="max-h-48 w-full space-y-2 overflow-y-auto rounded-2xl border border-line/70 bg-surface-2/40 p-3">
                {messages.slice(-6).map((message, index) => (
                  <div key={index} className={`whitespace-pre-wrap text-sm ${message.role === "user" ? "text-right text-accent" : "text-ink"}`} dir="auto">
                    <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-muted">{message.role === "user" ? "You" : "Assistant"}</span>
                    {message.content || (busy ? "…" : "")}
                  </div>
                ))}
                <div ref={endRef} />
              </div>
            )}
            {error && <p role="alert" className="w-full rounded-xl border border-bad/40 bg-bad/10 p-3 text-xs">{error}</p>}
            {disabledReason && <p className="w-full rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-warn">{disabledReason}</p>}
          </div>

          <div className="border-t border-line/70 p-3">
            <div className="mb-2 flex items-center justify-center gap-4">
              <button type="button" onClick={() => setMuted((value) => !value)} title={muted ? "Enable voice responses" : "Mute voice responses"}
                className="grid h-10 w-10 place-items-center rounded-full border border-line text-muted hover:text-ink">
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <button type="button" onClick={toggleMicrophone} disabled={!!disabledReason || busy || !voiceSupported}
                aria-label={listening ? "Stop listening" : "Start listening"} aria-pressed={listening}
                className={`grid h-[68px] w-[68px] place-items-center rounded-full shadow-lg transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40 ${listening ? "bg-bad text-white" : "bg-accent text-accent-ink"}`}>
                {listening ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
              </button>
              <button type="button" onClick={stopSpeaking} disabled={!speaking}
                title="Stop audio" className="grid h-10 w-10 place-items-center rounded-full border border-line text-muted hover:text-ink disabled:opacity-30">
                <Square className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); void sendMessage(input); }} className="flex items-center gap-2">
              <input value={input} onChange={(event) => setInput(event.target.value)} dir="auto"
                placeholder={listening ? "Listening…" : lang === "ar-AE" ? "اكتب رسالة…" : "Or type a message…"}
                maxLength={8000} className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 text-sm outline-none focus:border-accent" />
              <button type="submit" disabled={!input.trim() || busy || !!disabledReason} aria-label="Send message"
                className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-accent-ink disabled:opacity-40"><Send className="h-4 w-4" /></button>
            </form>
            <p className="mt-2 text-center text-[10px] text-muted">Voice and text conversations are handled by your selected assistant</p>
          </div>
        </section>
      )}
      <button type="button" onClick={() => { speaker.unlock(); setOpen((value) => !value); }}
        aria-expanded={open} aria-label={open ? "Close voice assistant" : "Open voice assistant"}
        className="fixed bottom-5 right-4 z-50 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-surface px-4 py-3 text-sm font-semibold text-ink shadow-xl shadow-black/30 transition hover:-translate-y-0.5 hover:border-accent sm:right-5">
        <span className="relative grid h-7 w-7 place-items-center rounded-full bg-accent text-accent-ink"><AudioLines className="h-4 w-4" /></span>
        {open ? "Close" : "Voice"}
      </button>
    </>
  );
}
