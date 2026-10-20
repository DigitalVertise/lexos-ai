import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Button, Card, Field, Input, Notice, PageHeader, SectionTitle, Select, formatDate } from "@/components/ui";
import { openBillingPortal, startCheckout } from "@/lib/actions/billing";
import { inviteMember, removeMember, revokeInvitation, updateFirm } from "@/lib/actions/firm";
import { ADMIN_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { integrationStatus } from "@/lib/env";
import { PLANS, planState } from "@/lib/plans";
import type { Membership } from "@/lib/types";

export const metadata = { title: "Settings" };

const BILLING_MESSAGES: Record<string, { tone: "ok" | "warn" | "bad"; text: string }> = {
  success: { tone: "ok", text: "Payment received. Your package is activated as soon as Stripe confirms it (usually within seconds) — refresh this page." },
  cancelled: { tone: "warn", text: "Checkout was cancelled. No charge was made." },
  unavailable: { tone: "bad", text: "Online billing is not configured yet. Contact Digital Vertise to activate your package." },
  forbidden: { tone: "bad", text: "Only owners and admins can manage billing." },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ billing?: string }> }) {
  const { billing } = await searchParams;
  const ws = await requireWorkspace();
  const isAdmin = hasRole(ws, ADMIN_ROLES);
  const [{ data: members }, { data: invitations }] = await Promise.all([
    ws.supabase.from("memberships").select("*").eq("org_id", ws.org.id).order("created_at"),
    isAdmin ? ws.supabase.from("invitations").select("id, email, role, expires_at").eq("org_id", ws.org.id).is("accepted_at", null).gt("expires_at", new Date().toISOString())
      : Promise.resolve({ data: [] as { id: string; email: string; role: string; expires_at: string }[] }),
  ]);
  const state = planState(ws.org);
  const integrations = integrationStatus();
  const message = billing ? BILLING_MESSAGES[billing] : undefined;

  return (
    <>
      <PageHeader title="Settings" description={ws.org.name} />

      <SectionTitle>Firm</SectionTitle>
      <Card className="max-w-2xl p-5">
        {isAdmin ? (
          <ActionForm action={updateFirm} className="grid gap-4 sm:grid-cols-2">
            <Field label="Firm name"><Input name="name" defaultValue={ws.org.name} required maxLength={200} /></Field>
            <Field label="Default jurisdiction" hint="Used when a matter has none."><Input name="default_jurisdiction" defaultValue={ws.org.default_jurisdiction ?? ""} maxLength={100} /></Field>
            <div className="sm:col-span-2"><SubmitButton>Save</SubmitButton></div>
          </ActionForm>
        ) : <p className="text-sm text-muted">Only owners and admins can change firm settings.</p>}
      </Card>

      <SectionTitle>Team members</SectionTitle>
      <Card className="divide-y divide-line">
        {((members ?? []) as Membership[]).map((m) => (
          <div key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div><p className="font-medium">{m.full_name || m.email}</p><p className="text-sm text-muted">{m.email}</p></div>
            <div className="flex items-center gap-3">
              <Badge>{m.role}</Badge>
              {isAdmin && m.role !== "owner" && m.user_id !== ws.user.id && (
                <form action={removeMember}><input type="hidden" name="user" value={m.user_id} /><button className="text-xs text-muted hover:text-bad" type="submit">Remove</button></form>
              )}
            </div>
          </div>
        ))}
        {(invitations ?? []).map((i) => (
          <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div><p>{i.email}</p><p className="text-sm text-muted">Invited · expires {formatDate(i.expires_at)}</p></div>
            <div className="flex items-center gap-3">
              <Badge tone="warn">{i.role} · pending</Badge>
              <form action={revokeInvitation}><input type="hidden" name="invitation" value={i.id} /><button className="text-xs text-muted hover:text-bad" type="submit">Revoke</button></form>
            </div>
          </div>
        ))}
      </Card>
      {isAdmin && (
        <Card className="mt-3 max-w-2xl p-4">
          <ActionForm action={inviteMember} resetOnSuccess className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
            <Field label="Invite by email"><Input name="email" type="email" required /></Field>
            <Field label="Role">
              <Select name="role" defaultValue="lawyer">
                <option value="admin">Admin</option><option value="lawyer">Lawyer</option><option value="staff">Staff</option>
              </Select>
            </Field>
            <SubmitButton>Invite</SubmitButton>
          </ActionForm>
        </Card>
      )}

      <div id="billing" />
      <SectionTitle>Package and billing</SectionTitle>
      {message && <div className="mb-3"><Notice tone={message.tone}>{message.text}</Notice></div>}
      <Card className="p-5">
        <p>
          Current package: <b>{state.active ? state.plan.name : "None"}</b>
          {state.active && state.reason === "trial" && <> · trial ends {formatDate(ws.org.trial_ends_at)}</>}
          {ws.org.plan !== "trial" && <> · status: {ws.org.subscription_status}{ws.org.current_period_end ? `, renews ${formatDate(ws.org.current_period_end)}` : ""}</>}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {[PLANS.basic, PLANS.pro].map((p) => (
            <div key={p.id} className="rounded-lg border border-line p-4">
              <div className="flex items-baseline justify-between"><p className="font-medium">{p.name}</p><p>${p.priceUsdMonthly}/month</p></div>
              <p className="mt-1 text-sm text-muted">{p.maxCatalogAssistants} assistants{p.maxCustomAssistants ? ` + ${p.maxCustomAssistants} custom` : ""} · {p.monthlyAssistantRuns.toLocaleString()} tasks/month · {p.maxSeats} members</p>
              {isAdmin && (ws.org.plan !== p.id || !state.active) && (
                <form action={startCheckout} className="mt-3">
                  <input type="hidden" name="plan" value={p.id} />
                  <Button type="submit" disabled={!integrations.billing}>{ws.org.plan === "trial" || !state.active ? `Choose ${p.name}` : `Switch to ${p.name}`}</Button>
                </form>
              )}
              {ws.org.plan === p.id && state.active && <p className="mt-3 text-sm text-ok">Your current package</p>}
            </div>
          ))}
        </div>
        {!integrations.billing && <p className="mt-3 text-sm text-muted">Online payment is not configured yet (Stripe keys missing). Packages can be activated by Digital Vertise in the meantime.</p>}
        {isAdmin && integrations.billing && ws.org.stripe_customer_id && (
          <form action={openBillingPortal} className="mt-4"><Button variant="secondary" type="submit">Manage billing, invoices and cancellation</Button></form>
        )}
      </Card>

      <div id="integrations" />
      <SectionTitle>Integrations</SectionTitle>
      <Card className="divide-y divide-line">
        <IntegrationRow name="AI provider (OpenAI)" status={integrations.ai ? "Connected" : "Not configured"} ok={integrations.ai}
          detail={integrations.ai ? "Assistants run through OpenAI's API with data retention for this conversation disabled (store: false)." : "Add OPENAI_API_KEY in the hosting settings."} />
        <IntegrationRow name="Stripe billing" status={integrations.billing ? "Connected" : "Not configured"} ok={integrations.billing}
          detail={integrations.billing ? "Checkout, billing portal and webhook are active." : "Needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_BASIC and STRIPE_PRICE_PRO."} />
        <IntegrationRow name="Zoho Bigin (CRM)" status="Not available yet" ok={false} detail="Client sync with Bigin is in the next release." />
        <IntegrationRow name="Notion (knowledge)" status="Not available yet" ok={false} detail="Linking Notion pages to matters works today via “Link a document”. Full Notion connection is in a later release." />
      </Card>
    </>
  );
}

function IntegrationRow({ name, status, ok, detail }: { name: string; status: string; ok: boolean; detail: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
      <div><p className="font-medium">{name}</p><p className="text-sm text-muted">{detail}</p></div>
      <Badge tone={ok ? "ok" : "neutral"}>{status}</Badge>
    </div>
  );
}
