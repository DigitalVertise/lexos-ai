import Link from "next/link";
import { TaskList } from "@/components/task-list";
import { ButtonLink, Card, EmptyState, PageHeader, SectionTitle, formatDate } from "@/components/ui";
import { catalogAgent } from "@/lib/agents/catalog";
import { isoDaysFromNow } from "@/lib/dates";
import { requireWorkspace } from "@/lib/auth";
import { monthStart } from "@/lib/entitlements";
import { integrationStatus } from "@/lib/env";
import { planState } from "@/lib/plans";
import { matterRef, type AiOutput, type Matter, type Task } from "@/lib/types";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const ws = await requireWorkspace();
  const weekAhead = isoDaysFromNow(7);
  const [openMatters, matterList, upcoming, recentAi, monthRuns, hires, recentDocs] = await Promise.all([
    ws.supabase.from("matters").select("id", { count: "exact", head: true }).eq("org_id", ws.org.id).neq("status", "closed"),
    ws.supabase.from("matters").select("id, number, title, status, updated_at").eq("org_id", ws.org.id).neq("status", "closed").order("updated_at", { ascending: false }).limit(6),
    ws.supabase.from("tasks").select("*").eq("org_id", ws.org.id).eq("status", "open").lte("due_at", weekAhead).order("due_at").limit(10),
    ws.supabase.from("ai_outputs").select("id, agent_key, instructions, created_at, matter_id").eq("org_id", ws.org.id).order("created_at", { ascending: false }).limit(5),
    ws.supabase.from("ai_outputs").select("id", { count: "exact", head: true }).eq("org_id", ws.org.id).gte("created_at", monthStart().toISOString()),
    ws.supabase.from("agent_hires").select("id", { count: "exact", head: true }).eq("org_id", ws.org.id),
    ws.supabase.from("documents").select("id, title, matter_id, created_at").eq("org_id", ws.org.id).order("created_at", { ascending: false }).limit(5),
  ]);
  const state = planState(ws.org);
  const matters = (matterList.data ?? []) as Pick<Matter, "id" | "number" | "title" | "status" | "updated_at">[];
  const matterLinks = new Map(matters.map((m) => [m.id, matterRef(m)]));
  const integrations = integrationStatus();
  const name = (ws.user.user_metadata?.full_name as string | undefined)?.split(" ")[0];

  return (
    <>
      <PageHeader title={name ? `Welcome, ${name}` : "Dashboard"} description={ws.org.name}
        actions={<><ButtonLink variant="secondary" href="/assistants">AI Team</ButtonLink><ButtonLink href="/matters/new">New matter</ButtonLink></>} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open matters" value={openMatters.count ?? 0} href="/matters" />
        <Stat label="Tasks due within 7 days" value={(upcoming.data ?? []).length} href="/tasks" />
        <Stat label="AI assistants hired" value={hires.count ?? 0} href="/assistants" />
        <Stat label="Assistant tasks this month" value={`${monthRuns.count ?? 0}${state.active ? ` / ${state.plan.monthlyAssistantRuns.toLocaleString()}` : ""}`} href="/assistants" />
      </div>

      {(hires.count ?? 0) === 0 && (
        <div className="mt-6"><EmptyState title="Hire your AI legal team" action={<ButtonLink href="/assistants">Choose assistants</ButtonLink>}>
          Your package includes {state.active ? state.plan.maxCatalogAssistants : 0} assistants for intake, drafting, client communication and billing.
        </EmptyState></div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle action={<Link href="/tasks" className="text-sm text-accent">All tasks</Link>}>Upcoming and overdue</SectionTitle>
          <TaskList tasks={(upcoming.data ?? []) as Task[]} matterLinks={matterLinks} />
        </div>
        <div>
          <SectionTitle action={<Link href="/matters" className="text-sm text-accent">All matters</Link>}>Recently active matters</SectionTitle>
          {matters.length === 0 ? <p className="text-sm text-muted">No open matters.</p> : (
            <Card className="divide-y divide-line">
              {matters.map((m) => (
                <Link key={m.id} href={`/matters/${m.id}`} className="block px-4 py-3 hover:bg-surface-2">
                  <span className="font-medium text-accent">{matterRef(m)}</span> {m.title}
                  <p className="text-xs text-muted">Updated {formatDate(m.updated_at, true)}</p>
                </Link>
              ))}
            </Card>
          )}
        </div>
        <div>
          <SectionTitle>Recent AI work</SectionTitle>
          {(recentAi.data ?? []).length === 0 ? <p className="text-sm text-muted">No assistant work yet.</p> : (
            <Card className="divide-y divide-line">
              {((recentAi.data ?? []) as Pick<AiOutput, "id" | "agent_key" | "instructions" | "created_at">[]).map((o) => (
                <Link key={o.id} href={`/outputs/${o.id}`} className="block px-4 py-3 hover:bg-surface-2">
                  <p className="text-sm font-medium">{catalogAgent(o.agent_key ?? "")?.name ?? "Custom assistant"}</p>
                  <p className="line-clamp-1 text-sm text-muted">{o.instructions}</p>
                </Link>
              ))}
            </Card>
          )}
        </div>
        <div>
          <SectionTitle>Recent documents</SectionTitle>
          {(recentDocs.data ?? []).length === 0 ? <p className="text-sm text-muted">No documents yet.</p> : (
            <Card className="divide-y divide-line">
              {(recentDocs.data ?? []).map((d) => (
                <a key={d.id as string} href={`/api/documents/${d.id}/download`} className="block px-4 py-3 text-sm hover:bg-surface-2">
                  {d.title as string}<span className="block text-xs text-muted">{formatDate(d.created_at as string)}</span>
                </a>
              ))}
            </Card>
          )}
        </div>
      </div>

      <SectionTitle action={<Link href="/settings#integrations" className="text-sm text-accent">Settings</Link>}>Status</SectionTitle>
      <Card className="flex flex-wrap gap-x-6 gap-y-2 p-4 text-sm">
        <span>Package: <b>{state.active ? state.plan.name : "inactive"}</b></span>
        <span>AI service: <b className={integrations.ai ? "text-ok" : "text-warn"}>{integrations.ai ? "Connected" : "Not configured"}</b></span>
        <span>Billing: <b className={integrations.billing ? "text-ok" : "text-warn"}>{integrations.billing ? "Connected" : "Not configured"}</b></span>
        <span>Zoho Bigin: <b className="text-muted">Next release</b></span>
        <span>Notion: <b className="text-muted">Next release</b></span>
      </Card>
    </>
  );
}

function Stat({ label, value, href }: { label: string; value: number | string; href: string }) {
  return (
    <Link href={href}>
      <Card className="p-4 transition-colors hover:border-accent/50">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-sm text-muted">{label}</p>
      </Card>
    </Link>
  );
}
