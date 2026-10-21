import { ArrowRight, FileText, Phone, ShieldCheck, Sparkles } from "lucide-react";
import { LButton } from "./buttons";
import { HeroMedia } from "./hero-media";

const WAVE = [0, 0.15, 0.3, 0.1, 0.45, 0.2, 0.35, 0.05, 0.25];

export function Hero() {
  const videoUrl = process.env.NEXT_PUBLIC_HERO_VIDEO_URL || undefined;
  return (
    <section className="relative overflow-hidden">
      <div className="grid-bg absolute inset-0" aria-hidden />
      <div className="orb orb-a -left-24 -top-24 h-80 w-80 sm:h-[28rem] sm:w-[28rem]" aria-hidden />
      <div className="orb orb-b -right-20 top-40 h-72 w-72 sm:h-[26rem] sm:w-[26rem]" aria-hidden />
      <div className="orb orb-c bottom-0 left-1/3 h-60 w-60" aria-hidden />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pb-24 lg:pt-20">
        <div>
          <p className="hero-in glass inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-muted" style={{ "--d": "0s" } as React.CSSProperties}>
            <Sparkles size={14} className="text-gold" /> For law firms in the UAE, Egypt, KSA and beyond
          </p>
          <h1 className="hero-in font-display mt-5 text-[2.6rem] font-bold leading-[1.04] sm:text-6xl" style={{ "--d": ".08s" } as React.CSSProperties}>
            Hire an <span className="text-gradient">AI legal team</span> that works inside your firm.
          </h1>
          <p className="hero-in mt-5 max-w-xl text-base text-muted sm:text-lg" style={{ "--d": ".16s" } as React.CSSProperties}>
            Give each AI assistant a role and a task. Chat, call or video with them, and get drafts, summaries and plans on your matter files — in English and Arabic. Your lawyers stay in control: every output is a draft for professional review.
          </p>
          <div className="hero-in mt-8 flex flex-col gap-3 sm:flex-row" style={{ "--d": ".24s" } as React.CSSProperties}>
            <LButton href="/signup" size="lg">Start free trial <ArrowRight size={18} /></LButton>
            <LButton href="#team" size="lg" variant="outline">Meet the AI team</LButton>
          </div>
          <p className="hero-in mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted" style={{ "--d": ".32s" } as React.CSSProperties}>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck size={15} className="text-ok" /> 14-day free trial, no card required</span>
            <span>English &amp; Arabic</span>
          </p>
        </div>

        <div className="hero-in mx-auto w-full max-w-sm sm:max-w-md lg:max-w-none" style={{ "--d": ".2s" } as React.CSSProperties}>
          <HeroMedia videoUrl={videoUrl} poster="/hero-agent.svg" alt="Illustration of a LexOS AI legal assistant drafting a document">
            <div className="absolute left-3 right-12 top-3 sm:left-5 sm:top-5 sm:right-auto sm:w-64">
              <div className="float-a glass rounded-2xl p-3 shadow-lg">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent/20 text-accent"><FileText size={15} /></span>
                  Drafting NDA… <span className="ml-auto text-accent">82%</span>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-line"><div className="shimmer-bar h-full w-[82%] rounded-full" /></div>
              </div>
            </div>

            <div className="absolute right-3 top-[44%] sm:right-5">
              <div className="float-b glass flex items-center gap-3 rounded-2xl px-3 py-2.5 shadow-lg">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-ok/15 text-ok"><Phone size={15} /></span>
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-medium"><span className="dot-online" /> Intake call — live</p>
                  <div className="mt-1 flex h-5 items-center gap-[3px]" aria-hidden>
                    {WAVE.map((d, i) => <span key={i} className="wave-bar" style={{ "--d": `${d}s` } as React.CSSProperties} />)}
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute bottom-3 left-3 right-3 sm:bottom-5 sm:left-5 sm:right-5">
              <div className="float-c glass flex items-center gap-3 rounded-2xl px-3.5 py-3 shadow-lg">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold/15 text-gold"><ShieldCheck size={16} /></span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Draft ready</p>
                  <p className="truncate text-xs text-muted">Waiting for lawyer review before it goes anywhere</p>
                </div>
              </div>
            </div>
          </HeroMedia>
        </div>
      </div>
    </section>
  );
}
