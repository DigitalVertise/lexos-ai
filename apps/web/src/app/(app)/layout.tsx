import { LogOut } from "lucide-react";
import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { LiveChatLauncher } from "@/components/live-chat-launcher";
import { NavLinks } from "@/components/nav";
import { LIVECHAT_URL } from "@/lib/embeds";
import { Notice } from "@/components/ui";
import { switchFirm } from "@/lib/actions/firm";
import { requireWorkspace } from "@/lib/auth";
import { brandStyle, themeAttr } from "@/lib/branding";
import { daysUntil } from "@/lib/dates";
import { planState } from "@/lib/plans";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ws = await requireWorkspace();
  const state = planState(ws.org);
  const trialDays = daysUntil(ws.org.trial_ends_at);
  const initial = (ws.user.email ?? "?").slice(0, 1).toUpperCase();
  const planLabel = state.active ? state.plan.name : "Inactive";

  return (
    <div data-theme={themeAttr(ws.org.theme)} style={brandStyle(ws.org)} className="min-h-dvh bg-bg text-ink md:grid md:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 z-30 border-b border-line/70 bg-surface/80 backdrop-blur-xl md:flex md:h-dvh md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:block md:px-5 md:py-5">
          {ws.org.logo_url ? (
            ws.org.website_url ? (
              <a href={ws.org.website_url} target="_blank" rel="noopener noreferrer" title={`${ws.org.name} website`} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ws.org.logo_url} alt={ws.org.name} className="h-9 max-w-40 object-contain" referrerPolicy="no-referrer" />
              </a>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={ws.org.logo_url} alt={ws.org.name} className="h-9 max-w-40 object-contain" referrerPolicy="no-referrer" />
            )
          ) : (
            <Link href="/dashboard" className="font-display text-lg font-semibold tracking-tight">Lex<span className="text-gold">OS</span> AI</Link>
          )}
          {ws.memberships.length > 1 ? (
            <form action={switchFirm} className="flex items-center md:mt-3">
              <label className="sr-only" htmlFor="org">Firm</label>
              <select id="org" name="org" defaultValue={ws.org.id} className="max-w-40 rounded-md border border-line bg-surface-2 px-2 py-1 text-sm">
                {ws.memberships.map((m) => <option key={m.org_id} value={m.org_id}>{m.org_name}</option>)}
              </select>
              <button className="ml-1 text-xs text-accent" type="submit">Switch</button>
            </form>
          ) : (
            <p className="truncate text-sm text-muted md:mt-1">{ws.org.name}</p>
          )}
        </div>

        <NavLinks />

        <div className="hidden border-t border-line/70 p-3 md:block">
          <div className="rounded-xl border border-line/70 bg-surface-2/60 p-3">
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/15 text-sm font-semibold text-accent">{initial}</span>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{ws.user.email}</p>
                <p className="text-[11px] capitalize text-muted">{ws.role}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <Link href="/settings#billing" className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:text-ink">
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${state.active ? "bg-ok" : "bg-warn"}`} />
                {planLabel}
              </Link>
              <form action={signOut}>
                <button className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink" type="submit">
                  <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-8 md:py-8">
        {state.active && state.reason === "trial" && (
          <div className="mb-5"><Notice>Free trial · {trialDays} day{trialDays === 1 ? "" : "s"} left. <Link className="text-accent underline" href="/settings#billing">Choose a package</Link></Notice></div>
        )}
        {!state.active && (
          <div className="mb-5"><Notice tone="warn">
            {state.reason === "trial_expired" ? "Your free trial has ended." : "Your subscription is not active."}{" "}
            Your data is safe; AI assistants are paused. <Link className="underline" href="/settings#billing">Choose a package</Link>
          </Notice></div>
        )}
        {children}
        <form action={signOut} className="mt-12 md:hidden">
          <button className="text-sm text-muted" type="submit">Sign out ({ws.user.email})</button>
        </form>
      </main>
      <LiveChatLauncher src={LIVECHAT_URL} label="Live assistant" />
    </div>
  );
}
