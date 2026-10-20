import Link from "next/link";
import { Badge, Button, ButtonLink, Card, EmptyState, Input, PageHeader } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import type { Client } from "@/lib/types";

export const metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const { q = "", kind = "" } = await searchParams;
  const ws = await requireWorkspace();
  let query = ws.supabase.from("clients").select("id, name, kind, email, phone, crm_sync_status, updated_at")
    .eq("org_id", ws.org.id).order("name").limit(200);
  const term = q.trim().slice(0, 100);
  // Escape characters with meaning in PostgREST filters.
  if (term) query = query.or(`name.ilike.%${term.replace(/[%,()*]/g, " ")}%,email.ilike.%${term.replace(/[%,()*]/g, " ")}%`);
  if (kind === "individual" || kind === "organization") query = query.eq("kind", kind);
  const { data } = await query;
  const clients = (data ?? []) as Client[];

  return (
    <>
      <PageHeader title="Clients" actions={<ButtonLink href="/clients/new">New client</ButtonLink>} />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="Search name or email" className="max-w-xs" aria-label="Search clients" />
        <select name="kind" defaultValue={kind} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" aria-label="Client type">
          <option value="">All types</option>
          <option value="individual">Individuals</option>
          <option value="organization">Companies</option>
        </select>
        <Button variant="secondary" type="submit">Filter</Button>
      </form>
      {clients.length === 0 ? (
        <EmptyState title={term || kind ? "No clients match" : "No clients yet"} action={<ButtonLink href="/clients/new">Add your first client</ButtonLink>} />
      ) : (
        <Card className="divide-y divide-line">
          {clients.map((c) => (
            <Link key={c.id} href={`/clients/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-muted">{[c.email, c.phone].filter(Boolean).join(" · ") || "No contact details"}</p>
              </div>
              <div className="flex gap-2">
                <Badge>{c.kind === "organization" ? "Company" : "Individual"}</Badge>
                {c.crm_sync_status === "synced" && <Badge tone="ok">In CRM</Badge>}
                {c.crm_sync_status === "failed" && <Badge tone="bad">CRM sync failed</Badge>}
              </div>
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
