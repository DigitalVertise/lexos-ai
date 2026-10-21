import { Check, FileText, Link2, Palette } from "lucide-react";
import { Card } from "@/components/ui";
import { Reveal } from "./reveal";
import { SectionHead } from "./sections";

const KPIS = [
  { label: "Active matters", value: "24", delta: "+3 this week" },
  { label: "Assistant tasks", value: "318", delta: "this month" },
  { label: "Awaiting review", value: "7", delta: "drafts" },
  { label: "Client updates", value: "41", delta: "sent" },
];
const BARS = [38, 52, 44, 68, 57, 74, 63, 86, 71, 92, 80, 96];
const ACTIVITY = [
  { who: "Drafting Associate", what: "Demand letter — draft ready", tone: "bg-ok" },
  { who: "Intake & KYC Associate", what: "Intake file created", tone: "bg-ok" },
  { who: "Contract Review Counsel", what: "Risk review in progress", tone: "bg-warn" },
];

export function WorkspaceSection() {
  return (
    <section id="workspace" className="relative overflow-hidden border-y border-line bg-surface/40 py-20 sm:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal>
          <SectionHead center={false} eyebrow="Workspace" title="One workspace for your whole firm" sub="Clients, matters, tasks and documents in a single private place — connected to the tools your team already uses." />
          <ul className="mt-7 space-y-4 text-sm">
            {[
              { icon: Link2, t: "Notion connection", d: "Keep matters and notes in sync with your Notion workspace." },
              { icon: Palette, t: "White-label client portal", d: "Your name, logo and colours — clients never see ours." },
              { icon: FileText, t: "Private document storage", d: "Matter files stay inside your firm's isolated workspace." },
            ].map((i) => (
              <li key={i.t} className="flex gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent"><i.icon size={18} /></span>
                <span><span className="block font-semibold">{i.t}</span><span className="text-muted">{i.d}</span></span>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="glass relative rounded-3xl p-3 shadow-[0_40px_90px_-40px_rgba(24,119,242,0.5)] sm:p-4">
            <div className="flex items-center gap-1.5 px-2 pb-3">
              <span className="h-2.5 w-2.5 rounded-full bg-bad/70" /><span className="h-2.5 w-2.5 rounded-full bg-warn/70" /><span className="h-2.5 w-2.5 rounded-full bg-ok/70" />
              <span className="ml-3 text-xs text-muted">Dashboard · sample data</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {KPIS.map((k) => (
                <Card key={k.label} className="p-3">
                  <p className="text-[11px] text-muted">{k.label}</p>
                  <p className="font-display mt-1 text-2xl font-bold">{k.value}</p>
                  <p className="text-[11px] text-ok">{k.delta}</p>
                </Card>
              ))}
            </div>
            <div className="mt-2.5 grid gap-2.5 sm:grid-cols-[1.3fr_1fr]">
              <Card className="p-4">
                <p className="text-xs font-semibold text-muted">Assistant tasks per week</p>
                <div className="mt-4 flex h-32 items-end gap-1.5" role="img" aria-label="Bar chart of weekly assistant tasks, rising over twelve weeks (sample data)">
                  {BARS.map((h, i) => (
                    <div key={i} className="flex h-full flex-1 items-end">
                      <div className="bar-grow w-full rounded-t-md bg-gradient-to-t from-accent to-ring" style={{ height: `${h}%`, "--d": `${i * 0.05}s` } as React.CSSProperties} />
                    </div>
                  ))}
                </div>
              </Card>
              <Card className="p-4">
                <p className="text-xs font-semibold text-muted">Recent activity</p>
                <ul className="mt-3 space-y-3">
                  {ACTIVITY.map((a) => (
                    <li key={a.what} className="flex gap-2.5 text-xs">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.tone}`} />
                      <span><span className="block font-medium">{a.who}</span><span className="text-muted">{a.what}</span></span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted"><Check size={12} className="text-ok" /> Every draft waits for lawyer review</p>
              </Card>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-muted">Illustrative preview with sample data.</p>
        </Reveal>
      </div>
    </section>
  );
}
