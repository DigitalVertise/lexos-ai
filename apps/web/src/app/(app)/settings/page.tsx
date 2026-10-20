import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Button, ButtonLink, Card, buttonStyles, Field, Input, Notice, PageHeader, SectionTitle, Select, formatDate } from "@/components/ui";
import { openBillingPortal, startCheckout } from "@/lib/actions/billing";
import { inviteMember, removeMember, revokeInvitation, updateFirm } from "@/lib/actions/firm";
import { connectNotion, disconnectBigin, disconnectNotion } from "@/lib/actions/integrations";
import { listConnections } from "@/lib/integrations/store";
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

const INTEGRATION_MESSAGES: Record<string, { tone: "ok" | "warn" | "bad"; text: string }> = {
  connected: { tone: "ok", text: "Zoho Bigin is connected." },
  disconnected: { tone: "ok", text: "Integration disconnected." },
  denied: { tone: "warn", text: "Zoho access was not granted. Nothing was connected." },
  expired: { tone: "bad", text: "The connection attempt expired. Please tap Connect Bigin again." },
  mismatch: { tone: "bad", text: "That Zoho approval belongs to a different LexOS user or firm. Sign in as the admin who started it and try again." },
  failed: { tone: "bad", text: "Zoho Bigin could not be connected. Please try again." },
  forbidden: { tone: "bad", text: "Only owners and admins can manage integrations." },
  unavailable: { tone: "bad", text: "Bigin connection is not set up on this server yet." },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ billing?: string; integration?: string }> }) {
  const { billing, integration } = await searchParams;
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
  const integrationMessage = integration ? INTEGRATION_MESSAGES[integration] : undefined;
  const connections = await listConnections(ws.supabase, ws.org.id);
  const bigin = connections.find((c) => c.provider === "zoho_bigin");
  const notion = connections.find((c) => c.provider === "notion");

  return (
    <>
      <PageHeader title="Settings" description={ws.org.name} actions={
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/settings/branding" variant="secondary">Branding & client portal</ButtonLink>
          <ButtonLink href="/studio" variant="secondary">Avatar studio</ButtonLink>
        </div>
      } />

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
      {integrationMessage && <div className="mb-3"><Notice tone={integrationMessage.tone}>{integrationMessage.text}</Notice></div>}
      <Card className="divide-y divide-line">
        <IntegrationRow name="AI assistants" status={integrations.ai ? "Connected" : "Not configured"} ok={integrations.ai}
          detail={integrations.ai ? "Assistants run on OpenAI models with provider-side storage of conversations disabled (store: false)." : "The AI provider is not configured on this server."} />
        <IntegrationRow name="Stripe billing" status={integrations.billing ? "Connected" : "Not configured"} ok={integrations.billing}
          detail={integrations.billing ? "Checkout, billing portal and webhook are active." : "Online payment is being set up."} />

        <div className="px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">Zoho Bigin (CRM)</p>
              <p className="text-sm text-muted">
                {bigin ? `Connected to ${bigin.account_label ?? "Bigin"} on ${formatDate(bigin.connected_at)}. Sync clients from each client's page, or import Bigin contacts from Clients.`
                  : integrations.zoho ? "Push clients to Bigin as Contacts or Companies, and import your Bigin contacts as clients."
                  : "Bigin connection is being set up by Digital Vertise."}
              </p>
              {bigin?.status === "error" && bigin.last_error && <p className="mt-1 text-sm text-bad">Last error: {bigin.last_error}</p>}
            </div>
            <Badge tone={bigin ? (bigin.status === "connected" ? "ok" : "bad") : "neutral"}>{bigin ? (bigin.status === "connected" ? "Connected" : "Needs attention") : "Not connected"}</Badge>
          </div>
          {isAdmin && (
            <div className="mt-3 flex flex-wrap gap-2">
              {integrations.zoho && <a href="/api/integrations/zoho/start" className={buttonStyles[bigin ? "secondary" : "primary"]}>{bigin ? "Reconnect Bigin" : "Connect Bigin"}</a>}
              {bigin && <form action={disconnectBigin}><Button variant="secondary" type="submit">Disconnect</Button></form>}
            </div>
          )}
        </div>

        <div className="px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">Notion (knowledge)</p>
              <p className="text-sm text-muted">
                {notion ? `Connected to ${notion.account_label ?? "Notion"}. Attach Notion pages to matters; assistants read them as context.`
                  : "Let assistants read your precedents, playbooks and matter notes in Notion."}
              </p>
            </div>
            <Badge tone={notion ? "ok" : "neutral"}>{notion ? "Connected" : "Not connected"}</Badge>
          </div>
          {isAdmin && (notion ? (
            <form action={disconnectNotion} className="mt-3"><Button variant="secondary" type="submit">Disconnect</Button></form>
          ) : (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-accent">Connect Notion</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
                <li>Open <a className="text-accent underline" href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">notion.so/profile/integrations</a> → <b>New integration</b> → type <b>Internal</b>, name it “LexOS”.</li>
                <li>Copy the <b>Internal Integration Secret</b> (starts with <code>ntn_</code>) and paste it below.</li>
                <li>In Notion, on each page or teamspace to share: <b>•••</b> → <b>Connections</b> → add <b>LexOS</b>.</li>
              </ol>
              <ActionForm action={connectNotion} className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field label="Integration secret"><Input name="token" type="password" autoComplete="off" required placeholder="ntn_…" /></Field>
                <SubmitButton pendingLabel="Checking…">Connect</SubmitButton>
              </ActionForm>
            </details>
          ))}
        </div>
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
