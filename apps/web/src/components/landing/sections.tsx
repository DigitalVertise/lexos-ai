import type { ReactNode } from "react";
import {
  BarChart3, BookOpenCheck, CalendarClock, ClipboardCheck, FileSearch, FileText, Gavel, Globe2, Languages,
  LayoutDashboard, MessageSquareText, Mic, Plus, Receipt, ShieldCheck, Video, Workflow, UserPlus, ListChecks, SendHorizontal,
} from "lucide-react";
import { CATALOG } from "@/lib/agents/catalog";
import { Badge, Card } from "@/components/ui";
import { LButton } from "./buttons";
import { Reveal } from "./reveal";
import { Logo } from "./navbar";

export function SectionHead({ eyebrow, title, sub, center = true }: { eyebrow: string; title: ReactNode; sub?: string; center?: boolean }) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-xl"}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">{eyebrow}</p>
      <h2 className="font-display mt-3 text-3xl font-bold leading-tight sm:text-4xl">{title}</h2>
      {sub && <p className="mt-3 text-base text-muted sm:text-lg">{sub}</p>}
    </div>
  );
}

/* ───────── Trust strip ───────── */
const CITIES = ["Dubai", "Abu Dhabi", "Cairo", "Riyadh", "Doha", "Sharjah", "Alexandria", "Jeddah"];
export function TrustStrip() {
  const row = [...CITIES, ...CITIES];
  return (
    <section aria-label="Where LexOS is built for" className="border-y border-line bg-surface/40 py-8">
      <p className="px-4 text-center text-sm text-muted">Built for firms in Dubai, Abu Dhabi, Cairo, Riyadh and across the region</p>
      <div className="marquee mt-5 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
        <div className="marquee-track gap-10 pr-10" aria-hidden>
          {row.map((c, i) => (
            <span key={i} className="font-display flex items-center gap-2 text-lg font-semibold text-muted/80">
              <Globe2 size={16} className="text-accent" /> {c}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────── How it works ───────── */
const STEPS = [
  { icon: UserPlus, title: "Hire", text: "Pick assistants from the catalogue — intake, drafting, billing, research and more. Each has a clear role and brief." },
  { icon: ListChecks, title: "Assign tasks", text: "Give a task by chat, voice or video, with the matter file attached. Assistants work in English or Arabic." },
  { icon: SendHorizontal, title: "Review & deliver", text: "A lawyer reviews every draft, then shares it with the client through your branded portal." },
];
export function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
      <Reveal><SectionHead eyebrow="How it works" title="From hire to delivered in three steps" sub="Onboard an AI assistant the way you would a new associate — with a role, a task and a review." /></Reveal>
      <div className="relative mt-12 grid gap-5 md:grid-cols-3">
        <div className="absolute left-[16%] right-[16%] top-9 hidden h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent md:block" aria-hidden />
        {STEPS.map((s, i) => (
          <Reveal key={s.title} delay={i * 0.1}>
            <Card className="lift relative h-full p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent text-accent-ink btn-glow"><s.icon size={22} /></span>
                <span className="font-display text-sm font-bold text-muted">0{i + 1}</span>
              </div>
              <h3 className="font-display mt-5 text-xl font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted">{s.text}</p>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ───────── AI team ───────── */
const AGENT_ICONS = {
  intake_kyc: ClipboardCheck,
  drafting_associate: FileText,
  client_comms: MessageSquareText,
  billing_clerk: Receipt,
  contract_review: FileSearch,
  litigation_paralegal: Gavel,
  legal_research: BookOpenCheck,
  deadline_planner: CalendarClock,
} as const;

export function AiTeam() {
  const ordered = [...CATALOG.filter((a) => a.tier === "basic"), ...CATALOG.filter((a) => a.tier === "pro")];
  return (
    <section id="team" className="relative border-y border-line bg-surface/40 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal><SectionHead eyebrow="AI team" title="Your AI legal team, ready to hire" sub="Eight specialist assistants for the work your firm repeats every week. Basic includes four; Pro unlocks the full team." /></Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ordered.map((a, i) => {
            const Icon = AGENT_ICONS[a.key as keyof typeof AGENT_ICONS] ?? Workflow;
            return (
              <Reveal key={a.key} delay={(i % 4) * 0.07}>
                <Card className="lift flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent/15 text-accent"><Icon size={22} /></span>
                    <Badge tone={a.tier === "pro" ? "gold" : "accent"}>{a.tier === "pro" ? "Pro" : "Basic"}</Badge>
                  </div>
                  <h3 className="font-display mt-4 text-[17px] font-semibold leading-snug">{a.name}</h3>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted"><span className="dot-online" /> Online · {a.title}</p>
                  <p className="mt-3 text-sm text-muted">{a.summary}</p>
                </Card>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ───────── Features ───────── */
const FEATURES = [
  { icon: MessageSquareText, title: "Chat", text: "Brief an assistant in plain language and get a structured first draft back." },
  { icon: Mic, title: "Voice", text: "Talk through a matter hands-free and let the assistant take notes and next steps." },
  { icon: Video, title: "Avatar video", text: "Meet your assistant face to face with a talking avatar for intake and updates." },
  { icon: LayoutDashboard, title: "Client portal (white label)", text: "Share updates and documents with clients under your firm's own name, logo and colours." },
  { icon: Workflow, title: "Notion workspace", text: "Connect your Notion workspace so matters, tasks and notes stay where your team already works." },
  { icon: BarChart3, title: "Analytics dashboard", text: "See matters, tasks and assistant activity at a glance across the whole firm." },
  { icon: Languages, title: "Bilingual EN / AR", text: "Draft and communicate in English or formal Modern Standard Arabic, right-to-left included." },
  { icon: ShieldCheck, title: "Security & tenant isolation", text: "Every firm gets its own isolated workspace. Assistants only use the material you give them for a matter." },
];
export function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
      <Reveal><SectionHead eyebrow="Features" title="Everything a modern firm needs, in one place" sub="Talk to your assistants, share with clients and keep your workspace in sync." /></Reveal>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => (
          <Reveal key={f.title} delay={(i % 4) * 0.07}>
            <Card className="lift h-full p-5">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface-2 text-accent"><f.icon size={20} /></span>
              <h3 className="font-display mt-4 text-base font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{f.text}</p>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ───────── FAQ ───────── */
const FAQS = [
  { q: "Does LexOS give legal advice?", a: "No. LexOS assists lawyers; it does not provide legal advice. Every output is a draft for a qualified lawyer to review, and assistants flag anything they cannot verify." },
  { q: "Which languages are supported?", a: "English and Arabic. Assistants reply in the language you write in, and can draft documents in formal Modern Standard Arabic." },
  { q: "How does the free trial work?", a: "You get 14 days of the Basic package with no card required. Choose Basic or Pro when you are ready to continue." },
  { q: "What counts as an assistant task?", a: "Each time an assistant runs on a request — a draft, a summary, a review or a plan — it uses one task from your monthly allowance." },
  { q: "Can clients see their matters?", a: "Yes. The white-label client portal lets you share updates and documents under your own firm name and branding." },
  { q: "How is my firm's data kept separate?", a: "Each firm works in its own isolated workspace, and assistants only use the material you provide for a matter." },
];
export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
      <Reveal><SectionHead eyebrow="FAQ" title="Questions, answered" /></Reveal>
      <div className="mt-10 space-y-3">
        {FAQS.map((f) => (
          <Reveal key={f.q}>
            <details className="group rounded-2xl border border-line bg-surface open:border-accent/40">
              <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 text-left text-[15px] font-semibold">
                {f.q}
                <Plus size={18} className="shrink-0 text-accent transition-transform duration-200 group-open:rotate-45" />
              </summary>
              <p className="px-5 pb-5 text-sm text-muted">{f.a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ───────── Final CTA ───────── */
export function FinalCta() {
  return (
    <section className="px-4 pb-20 sm:px-6 sm:pb-24">
      <Reveal>
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-accent to-[#0a3d91] px-6 py-14 text-center text-white sm:px-12 sm:py-16">
          <div className="orb orb-b -right-10 -top-16 h-64 w-64 opacity-40" aria-hidden />
          <div className="orb orb-c -bottom-20 left-10 h-56 w-56" aria-hidden />
          <h2 className="font-display relative mx-auto max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">Put an AI legal team to work for your firm this week.</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-base text-white/80">Start a 14-day free trial. No card required.</p>
          <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <LButton href="/signup" size="lg" className="!bg-white !text-[#0a3d91] hover:!brightness-95 !shadow-none">Start free trial</LButton>
            <LButton href="/login" size="lg" variant="outline" className="!border-white/40 !bg-white/10 !text-white">Sign in</LButton>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ───────── Footer ───────── */
export function Footer() {
  return (
    <footer className="border-t border-line py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <Logo />
          <p className="mt-3 text-sm text-muted">LexOS assists lawyers; it does not provide legal advice.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
          <a href="#features" className="hover:text-ink">Features</a>
          <a href="#team" className="hover:text-ink">AI Team</a>
          <a href="#workspace" className="hover:text-ink">Workspace</a>
          <a href="#pricing" className="hover:text-ink">Pricing</a>
          <a href="/login" className="hover:text-ink">Sign in</a>
        </nav>
      </div>
      <p className="mx-auto mt-8 max-w-6xl px-4 text-xs text-muted sm:px-6">© {new Date().getFullYear()} Digital Vertise · LexOS AI</p>
    </footer>
  );
}
