import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientFields } from "@/components/client-fields";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Button, ButtonLink, Card, Field, Input, Notice, PageHeader, SectionTitle, Textarea, formatDate } from "@/components/ui";
import { deleteClient, updateClient } from "@/lib/actions/clients";
import { syncClientToBigin } from "@/lib/actions/integrations";
import { invitePortalClient, replyToClient, revokePortalAccess } from "@/lib/actions/portal";
import { listConnections } from "@/lib/integrations/store";
import { LAWYER_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { matterRef, type Client, type Matter } from "@/lib/types";

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const ws = await requireWorkspace();
  const { data: client } = await ws.supabase.from("clients").select("*").eq("id", id).eq("org_id", ws.org.id).maybeSingle<Client>();
  if (!client) notFound();
  const { data: matters } = await ws.supabase.from("matters").select("id, number, title, status, opened_on")
    .eq("org_id", ws.org.id).eq("client_id", client.id).order("number", { ascending: false });
  const bigin = (await listConnections(ws.supabase, ws.org.id)).find((c) => c.provider === "zoho_bigin");
  const canInvite = hasRole(ws, LAWYER_ROLES);
  const [{ data: access }, { data: messages }] = await Promise.all([
    ws.supabase.from("portal_access").select("id, email, user_id, created_at, revoked_at").eq("org_id", ws.org.id).eq("client_id", client.id).order("created_at"),
    ws.supabase.from("portal_messages").select("id, sender, body, matter_id, created_at, read_at").eq("org_id", ws.org.id).eq("client_id", client.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const accessRows = (access ?? []) as { id: string; email: string; user_id: string | null; created_at: string; revoked_at: string | null }[];
  const thread = ((messages ?? []) as { id: string; sender: "client" | "firm"; body: string; matter_id: string | null; created_at: string; read_at: string | null }[]).reverse();

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/clients" className="text-muted hover:text-ink">← Clients</Link></p>
      <PageHeader
        title={client.name}
        description={client.kind === "organization" ? "Company client" : "Individual client"}
        actions={<ButtonLink href={`/matters/new?client=${client.id}`}>New matter</ButtonLink>}
      />
      {error === "has_matters" && <div className="mb-4"><Notice tone="bad">This client has matters. Close or move them before deleting the client.</Notice></div>}

      <SectionTitle>Matters</SectionTitle>
      {(matters ?? []).length === 0 ? <p className="text-sm text-muted">No matters for this client yet.</p> : (
        <Card className="divide-y divide-line">
          {((matters ?? []) as Pick<Matter, "id" | "number" | "title" | "status" | "opened_on">[]).map((m) => (
            <Link key={m.id} href={`/matters/${m.id}`} className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2">
              <span><span className="font-medium text-accent">{matterRef(m)}</span> {m.title}</span>
              <Badge>{m.status.replace("_", " ")}</Badge>
            </Link>
          ))}
        </Card>
      )}

      <SectionTitle>Details</SectionTitle>
      <Card className="max-w-2xl p-5">
        <ActionForm action={updateClient} className="space-y-5">
          <input type="hidden" name="id" value={client.id} />
          <ClientFields client={client} />
          <SubmitButton>Save changes</SubmitButton>
        </ActionForm>
      </Card>

      <div id="portal" />
      <SectionTitle>Client portal</SectionTitle>
      {!ws.org.portal_enabled ? (
        <p className="text-sm text-muted">The client portal is off. Switch it on in <a className="text-accent" href="/settings/branding">Settings → Branding & client portal</a>.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="p-5">
            <p className="text-sm font-medium">Portal access</p>
            {accessRows.length === 0 ? <p className="mt-1 text-sm text-muted">Nobody can see this client’s matters in the portal yet.</p> : (
              <ul className="mt-2 space-y-2">
                {accessRows.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>{a.email} <span className="text-xs text-muted">{a.revoked_at ? "· revoked" : a.user_id ? "· signed in" : "· invited"}</span></span>
                    {!a.revoked_at && canInvite && (
                      <form action={revokePortalAccess}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="clientId" value={client.id} />
                        <button className="text-xs text-muted hover:text-bad" type="submit">Revoke</button></form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canInvite && (
              <ActionForm action={invitePortalClient} resetOnSuccess className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="clientId" value={client.id} />
                <div className="min-w-48 flex-1"><Field label="Give access to (email)"><Input name="email" type="email" defaultValue={client.email ?? ""} required /></Field></div>
                <SubmitButton>Give access</SubmitButton>
              </ActionForm>
            )}
            <p className="mt-2 text-xs text-muted">They sign in at {`/portal/${ws.org.portal_slug}`} with this email. Only documents you mark “Share with client” are visible.</p>
          </Card>
          <Card className="p-5">
            <p className="text-sm font-medium">Portal messages</p>
            {thread.length === 0 ? <p className="mt-1 text-sm text-muted">No messages.</p> : (
              <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto">
                {thread.map((m) => (
                  <li key={m.id} className={m.sender === "client" ? "rounded-lg bg-surface-2 p-2" : "ml-6 rounded-lg border border-line p-2"}>
                    <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                    <p className="text-xs text-muted">{m.sender === "client" ? client.name : "Firm"} · {formatDate(m.created_at, true)}{m.sender === "client" && !m.read_at ? " · new" : ""}</p>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={replyToClient} resetOnSuccess className="mt-3 space-y-2">
              <input type="hidden" name="clientId" value={client.id} />
              <Textarea name="body" rows={3} maxLength={5000} placeholder="Reply to the client…" required />
              <SubmitButton>Send reply</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      )}

      <SectionTitle>CRM (Zoho Bigin)</SectionTitle>
      <Card className="max-w-2xl p-5">
        <p className="text-sm text-muted">
          {client.crm_sync_status === "synced" ? `In Bigin as a ${client.kind === "organization" ? "Company" : "Contact"} · last synced ${formatDate(client.crm_synced_at, true)}.`
            : client.crm_sync_status === "failed" ? `Last sync failed: ${client.crm_error ?? "unknown error"}.`
            : bigin ? `Not in Bigin yet. Syncing creates a ${client.kind === "organization" ? "Company" : "Contact"} record.`
            : "Connect Zoho Bigin in Settings → Integrations to sync this client."}
        </p>
        {client.crm_sync_status === "failed" && <div className="mt-2"><Notice tone="bad">Check the details above (for example a valid email) and try again.</Notice></div>}
        {bigin && (
          <form action={syncClientToBigin} className="mt-3">
            <input type="hidden" name="id" value={client.id} />
            <SubmitButton pendingLabel="Syncing…" variant="secondary">{client.crm_id ? "Update in Bigin" : "Send to Bigin"}</SubmitButton>
          </form>
        )}
      </Card>

      <form action={deleteClient} className="mt-10">
        <input type="hidden" name="id" value={client.id} />
        <Button variant="danger" type="submit">Delete client</Button>
      </form>
    </>
  );
}
