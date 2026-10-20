import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input, Notice } from "@/components/ui";
import { acceptInvitation, createFirm } from "@/lib/actions/firm";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Set up your firm" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { supabase } = await requireUser();
  const { data: invites } = await supabase.rpc("my_invitations");
  const pending = (invites ?? []) as { id: string; org_name: string; role: string }[];
  const { count } = await supabase.from("memberships").select("org_id", { count: "exact", head: true });
  // Clients invited to a firm's portal land here after signing in elsewhere.
  await supabase.rpc("portal_claim");
  const { data: portalRows } = await supabase.rpc("portal_my_portals");
  const portals = (portalRows ?? []) as { slug: string; name: string }[];

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <Link href="/" className="font-display mb-8 block text-center text-xl font-semibold">Lex<span className="text-gold">OS</span> AI</Link>
      {error && <div className="mb-4"><Notice tone="bad">That invitation is no longer valid.</Notice></div>}
      {portals.length > 0 && (
        <Card className="mb-4 p-6">
          <h2 className="font-medium">Your client portals</h2>
          <ul className="mt-3 space-y-2">
            {portals.map((p) => (
              <li key={p.slug}><Link className="text-accent" href={`/portal/${p.slug}`}>{p.name} — client portal →</Link></li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Are you a client? Use the link above. The form below is only for law firms setting up LexOS.</p>
        </Card>
      )}
      {pending.length > 0 && (
        <Card className="mb-4 p-6">
          <h2 className="font-medium">You have been invited</h2>
          <ul className="mt-3 space-y-2">
            {pending.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3">
                <span>{inv.org_name} <span className="text-sm text-muted">as {inv.role}</span></span>
                <form action={acceptInvitation}>
                  <input type="hidden" name="invitation" value={inv.id} />
                  <SubmitButton pendingLabel="Joining…">Join</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="p-6">
        <h1 className="font-display text-xl font-semibold">Set up your firm</h1>
        <p className="mt-1 text-sm text-muted">You will be the owner and can invite your team afterwards.</p>
        <ActionForm action={createFirm} className="mt-5 space-y-4">
          <Field label="Firm name"><Input name="name" placeholder="e.g. Al Noor Advocates & Legal Consultants" required /></Field>
          <SubmitButton className="w-full" pendingLabel="Creating…">Create firm workspace</SubmitButton>
        </ActionForm>
        {(count ?? 0) > 0 && <p className="mt-4 text-center text-sm"><Link href="/dashboard" className="text-accent">Back to my workspace</Link></p>}
      </Card>
    </div>
  );
}
