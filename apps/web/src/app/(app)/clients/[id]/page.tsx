import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientFields } from "@/components/client-fields";
import { ActionForm, SubmitButton } from "@/components/form";
import { Badge, Button, ButtonLink, Card, Notice, PageHeader, SectionTitle, formatDate } from "@/components/ui";
import { deleteClient, updateClient } from "@/lib/actions/clients";
import { syncClientToBigin } from "@/lib/actions/integrations";
import { listConnections } from "@/lib/integrations/store";
import { requireWorkspace } from "@/lib/auth";
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
