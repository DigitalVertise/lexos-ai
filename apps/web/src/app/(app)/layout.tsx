import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { NavLinks } from "@/components/nav";
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

  return (
    <div data-theme={themeAttr(ws.org.theme)} style={brandStyle(ws.org)} className="min-h-dvh bg-bg text-ink md:grid md:grid-cols-[232px_1fr]">
      <aside className="border-b border-line bg-surface md:min-h-dvh md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-4 md:block">
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
            <Link href="/dashboard" className="font-display text-lg font-semibold">Lex<span className="text-gold">OS</span> AI</Link>
          )}
          {ws.memberships.length > 1 ? (
            <form action={switchFirm} className="md:mt-3">
              <label className="sr-only" htmlFor="org">Firm</label>
              <select id="org" name="org" defaultValue={ws.org.id} className="max-w-44 rounded-md border border-line bg-surface px-2 py-1 text-sm">
                {ws.memberships.map((m) => <option key={m.org_id} value={m.org_id}>{m.org_name}</option>)}
              </select>
              <button className="ml-1 text-xs text-accent" type="submit">Switch</button>
            </form>
          ) : (
            <p className="truncate text-sm text-muted md:mt-1">{ws.org.name}</p>
          )}
        </div>
        <NavLinks />
        <form action={signOut} className="hidden px-4 py-4 md:block">
          <p className="truncate text-xs text-muted">{ws.user.email}</p>
          <button className="mt-1 text-sm text-muted hover:text-ink" type="submit">Sign out</button>
        </form>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-8">
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
    </div>
  );
}
