import { Check } from "lucide-react";
import { PLANS } from "@/lib/plans";
import { Badge, Card } from "@/components/ui";
import { LButton } from "./buttons";
import { Reveal } from "./reveal";
import { SectionHead } from "./sections";

export function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
      <Reveal><SectionHead eyebrow="Pricing" title="Simple packages that grow with your firm" sub={PLANS.trial.blurb} /></Reveal>
      <div className="mx-auto mt-12 grid max-w-4xl gap-5 md:grid-cols-2">
        {[PLANS.basic, PLANS.pro].map((p, i) => {
          const pro = p.tier === "pro";
          return (
            <Reveal key={p.id} delay={i * 0.1} className="h-full">
              <Card className={`relative flex h-full flex-col p-6 sm:p-7 ${pro ? "pro-card lift bg-surface-2" : "lift"}`}>
                {pro && <span className="absolute -top-3 left-6"><Badge tone="gold"><span className="bg-surface-2 px-1">Recommended</span></Badge></span>}
                <h3 className="font-display text-xl font-semibold">{p.name}</h3>
                <p className="mt-3"><span className="font-display text-5xl font-bold">${p.priceUsdMonthly ?? "—"}</span><span className="text-muted"> / month</span></p>
                <p className="mt-3 text-sm text-muted">{p.blurb}</p>
                <ul className="mt-6 space-y-3 text-sm">
                  {[
                    `${p.maxCatalogAssistants} AI legal assistants${pro ? " (full catalogue)" : ""}`,
                    ...(p.maxCustomAssistants > 0 ? [`Up to ${p.maxCustomAssistants} custom assistants for your firm`] : []),
                    `${p.monthlyAssistantRuns.toLocaleString()} assistant tasks per month`,
                    `Up to ${p.maxSeats} team members`,
                    "Clients, matters, tasks and private document storage",
                  ].map((t) => (
                    <li key={t} className="flex gap-2.5"><Check size={17} className="mt-0.5 shrink-0 text-accent" /> <span>{t}</span></li>
                  ))}
                </ul>
                <div className="mt-8 flex-1 content-end">
                  <LButton href="/signup" size="lg" variant={pro ? "primary" : "outline"} className="w-full">Start free trial</LButton>
                </div>
              </Card>
            </Reveal>
          );
        })}
      </div>
      <p className="mt-6 text-center text-xs text-muted">Prices in USD, billed monthly. LexOS assists lawyers; it does not provide legal advice.</p>
    </section>
  );
}
