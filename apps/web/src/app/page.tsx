import Link from "next/link";
import { CATALOG } from "@/lib/agents/catalog";
import { PLANS } from "@/lib/plans";
import { ButtonLink, Card, Badge } from "@/components/ui";

export default function Home() {
  const basic = CATALOG.filter((a) => a.tier === "basic");
  const pro = CATALOG.filter((a) => a.tier === "pro");
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <Link href="/" className="font-display text-xl font-semibold">Lex<span className="text-gold">OS</span> AI</Link>
        <nav className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost">Sign in</ButtonLink>
          <ButtonLink href="/signup">Start free trial</ButtonLink>
        </nav>
      </header>

      <section className="py-14 sm:py-20">
        <p className="mb-3 text-sm font-medium text-gold">For law firms in the UAE and beyond</p>
        <h1 className="font-display max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
          Hire an AI legal team that works inside your firm.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          LexOS gives every firm a private workspace for clients, matters, tasks and documents — and AI
          assistants that draft, review, summarise and plan on your matter files, in English and Arabic.
          Your lawyers stay in control: every output is a draft for professional review.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/signup">Start 14-day free trial</ButtonLink>
          <ButtonLink href="#pricing" variant="secondary">See packages</ButtonLink>
        </div>
      </section>

      <section aria-labelledby="team">
        <h2 id="team" className="font-display text-2xl font-semibold">Your AI legal team</h2>
        <p className="mt-1 text-muted">Hire assistants for the work your firm repeats every week.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...basic, ...pro].map((a) => (
            <Card key={a.key} className="p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-medium">{a.name}</p>
                <Badge tone={a.tier === "pro" ? "gold" : "accent"}>{a.tier === "pro" ? "Pro" : "Basic"}</Badge>
              </div>
              <p className="text-sm text-muted">{a.summary}</p>
            </Card>
          ))}
        </div>
      </section>

      <section id="pricing" aria-labelledby="pricing-title" className="py-16">
        <h2 id="pricing-title" className="font-display text-2xl font-semibold">Packages</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {[PLANS.basic, PLANS.pro].map((p) => (
            <Card key={p.id} className="flex flex-col p-6">
              <div className="flex items-baseline justify-between">
                <h3 className="font-display text-xl font-semibold">{p.name}</h3>
                <p><span className="text-3xl font-semibold">${p.priceUsdMonthly}</span><span className="text-muted"> / month</span></p>
              </div>
              <p className="mt-2 text-sm text-muted">{p.blurb}</p>
              <ul className="mt-4 space-y-1.5 text-sm">
                <li>✓ {p.maxCatalogAssistants} AI legal assistants{p.tier === "pro" ? " (full catalogue)" : ""}</li>
                {p.maxCustomAssistants > 0 && <li>✓ Up to {p.maxCustomAssistants} custom assistants for your firm</li>}
                <li>✓ {p.monthlyAssistantRuns.toLocaleString()} assistant tasks per month</li>
                <li>✓ Up to {p.maxSeats} team members</li>
                <li>✓ Clients, matters, tasks and private document storage</li>
              </ul>
              <div className="mt-6"><ButtonLink href="/signup" className="w-full">Start free trial</ButtonLink></div>
            </Card>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">Prices in USD, billed monthly. LexOS assists lawyers; it does not provide legal advice.</p>
      </section>

      <footer className="border-t border-line py-8 text-sm text-muted">
        © {new Date().getFullYear()} Digital Vertise · LexOS AI
      </footer>
    </div>
  );
}
