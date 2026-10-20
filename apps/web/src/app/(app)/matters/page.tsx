import Link from "next/link";
import { Badge, Button, ButtonLink, Card, EmptyState, Input, PageHeader, formatDate } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { matterRef, type Matter } from "@/lib/types";

export const metadata = { title: "Matters" };

const STATUS_TONE = { intake: "accent", open: "ok", on_hold: "warn", closed: "neutral" } as const;

export default async function MattersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q = "", status = "active" } = await searchParams;
  const ws = await requireWorkspace();
  let query = ws.supabase.from("matters").select("id, number, title, status, matter_type, opened_on, clients(name)")
    .eq("org_id", ws.org.id).order("number", { ascending: false }).limit(200);
  if (status === "active") query = query.neq("status", "closed");
  else if (["intake", "open", "on_hold", "closed"].includes(status)) query = query.eq("status", status);
  const term = q.trim().slice(0, 100).replace(/[%,()*]/g, " ");
  if (term) {
    const num = term.match(/^m-?(\d+)$/i);
    query = num ? query.eq("number", Number(num[1])) : query.ilike("title", `%${term}%`);
  }
  const { data } = await query;
  const matters = (data ?? []) as unknown as (Matter & { clients: { name: string } | null })[];

  return (
    <>
      <PageHeader title="Matters" actions={<ButtonLink href="/matters/new">New matter</ButtonLink>} />
      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="Search title or M-12" className="max-w-xs" aria-label="Search matters" />
        <select name="status" defaultValue={status} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" aria-label="Status">
          <option value="active">Active (not closed)</option>
          <option value="all">All</option>
          <option value="intake">Intake</option>
          <option value="open">Open</option>
          <option value="on_hold">On hold</option>
          <option value="closed">Closed</option>
        </select>
        <Button variant="secondary" type="submit">Filter</Button>
      </form>
      {matters.length === 0 ? (
        <EmptyState title={term ? "No matters match" : "No matters yet"} action={<ButtonLink href="/matters/new">Open a matter</ButtonLink>}>
          A matter brings together the client, tasks, documents and your AI team&apos;s work.
        </EmptyState>
      ) : (
        <Card className="divide-y divide-line">
          {matters.map((m) => (
            <Link key={m.id} href={`/matters/${m.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2">
              <div className="min-w-0">
                <p className="truncate"><span className="font-medium text-accent">{matterRef(m)}</span> <span className="font-medium">{m.title}</span></p>
                <p className="text-sm text-muted">{m.clients?.name ?? "—"} · {m.matter_type ?? "Type not set"} · opened {formatDate(m.opened_on)}</p>
              </div>
              <Badge tone={STATUS_TONE[m.status]}>{m.status.replace("_", " ")}</Badge>
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
