import { Activity, Briefcase, CheckSquare, FileText, FolderOpen, Plus, Settings2, Sparkles, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { AiTeamPanel, type TeamHire } from "@/components/dashboard/ai-team-panel";
import { ProgressBar, Sparkline } from "@/components/dashboard/charts";
import { dailyBuckets, dubaiGreeting, prevMonthStart, sparkWindowStart } from "@/components/dashboard/data";
import { KpiTile } from "@/components/dashboard/kpi";
import { Panel, PanelEmpty } from "@/components/dashboard/panel";
import { DashboardStyles } from "@/components/dashboard/styles";
import { TaskList } from "@/components/task-list";
import { ButtonLink, Card, formatDate } from "@/components/ui";
import { catalogAgent } from "@/lib/agents/catalog";
import { isoDaysFromNow } from "@/lib/dates";
import { requireWorkspace } from "@/lib/auth";
import { monthStart } from "@/lib/entitlements";
import { integrationStatus } from "@/lib/env";
import { listConnections } from "@/lib/integrations/store";
import { planState } from "@/lib/plans";
import { matterRef, type AiOutput, type Matter, type Task } from "@/lib/types";

export const metadata = { title: "Dashboard" };

const QUICK_ACTIONS = [
  { href: "/matters/new", label: "New matter", hint: "Open a case file", Icon: Briefcase },
  { href: "/clients/new", label: "New client", hint: "Add a client record", Icon: UserPlus },
  { href: "/tasks", label: "Assign task", hint: "Delegate to your team", Icon: CheckSquare },
  { href: "/settings/branding", label: "Client portal settings", hint: "Branding & portal", Icon: Settings2 },
];

export default async function Dashboard() {
  const ws = await requireWorkspace();
  const weekAhead = isoDaysFromNow(7);
  const [openMatters, matterList, upcoming, recentAi, monthRuns, hires, recentDocs, hireList, openTasks, clientCount, teamCount, prevRuns, sparkRows] = await Promise.all([
    ws.supabase.from("matters").select("id", { count: "exact", head: true }).eq("org_id", ws.org.id).neq("status", "closed"),
    ws.supabase.from("matters").select("id, number, title, status, updated_at").eq("org_id", ws.org.id).neq("status", "closed").order("updated_at", { ascending: false }).limit(6),
    ws.supabase.from("tasks").select("*").eq("org_id", ws.org.id).eq("status", "open").lte("due_at", weekAhead).order("due_at").limit(10),
    ws.supabase.from("ai_outputs").select("id, agent_key, instructions, created_at, matter_id").eq("org_id", ws.org.id).order("created_at", { ascending: false }).limit(5),
    ws.supabase.from("ai_outputs").select("id", { count: "exact", head: true }).eq("org_id", ws.org.id).gte("created_at", monthStart().toISOString()),
    ws.supabase.from("agent_hires").select("id", { count: "exact", head: true }).eq("org_id", ws.org.id),
    ws.supabase.from("documents").select("id, title, matter_id, created_at").eq("org_id", ws.org.id).order("created_at", { ascending: false }).limit(5),
    ws.supabase.from("agent_hires").select("id, agent_key, name, status").eq("org_id", ws.org.id).order("hired_at").limit(6),
    ws.supabase.from("tasks").select("id", { count: "exact", head: true }).eq("org_id", ws.org.id).eq("status", "open"),
    ws.supabase.from("clients").select("id", { count: "exact", head: true }).eq("org_id", ws.org.id),
    ws.supabase.from("memberships").select("user_id", { count: "exact", head: true }).eq("org_id", ws.org.id),
    ws.supabase.from("ai_outputs").select("id", { count: "exact", head: true }).eq("org_id", ws.org.id).gte("created_at", prevMonthStart().toISOString()).lt("created_at", monthStart().toISOString()),
    ws.supabase.from("ai_outputs").select("created_at").eq("org_id", ws.org.id).gte("created_at", sparkWindowStart(14)).order("created_at", { ascending: false }).limit(1000),
  ]);
  const state = planState(ws.org);
  const matters = (matterList.data ?? []) as Pick<Matter, "id" | "number" | "title" | "status" | "updated_at">[];
  const matterLinks = new Map(matters.map((m) => [m.id, matterRef(m)]));
  const integrations = integrationStatus();
  const connections = await listConnections(ws.supabase, ws.org.id);
  const name = (ws.user.user_metadata?.full_name as string | undefined)?.split(" ")[0];
  const { greeting, dateLabel } = dubaiGreeting();

  const runs = monthRuns.count ?? 0;
  const runLimit = state.active ? state.plan.monthlyAssistantRuns : 0;
  const prev = prevRuns.count ?? 0;
  const delta = prev > 0 ? Math.round(((runs - prev) / prev) * 100) : null;
  const spark = dailyBuckets((sparkRows.data ?? []).map((r) => r.created_at as string), 14);
  const seats = state.active ? state.plan.maxSeats : 0;
  const hireTotal = hires.count ?? 0;
  const upcomingTasks = (upcoming.data ?? []) as Task[];
  const aiItems = (recentAi.data ?? []) as Pick<AiOutput, "id" | "agent_key" | "instructions" | "created_at">[];
  const docs = recentDocs.data ?? [];

  return (
    <div className="mx-auto max-w-6xl">
      <DashboardStyles />

      <header className="dv-rise mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-muted">{dateLabel}</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">{greeting}{name ? `, ${name}` : ""}</h1>
          <p className="mt-1 text-sm text-muted">{ws.org.name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink variant="secondary" href="/assistants">AI Team</ButtonLink>
          <ButtonLink href="/matters/new"><Plus className="h-4 w-4" aria-hidden /> New matter</ButtonLink>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile index={1} label="Active matters" value={openMatters.count ?? 0} href="/matters" Icon={Briefcase}
          hint={`${clientCount.count ?? 0} client${clientCount.count === 1 ? "" : "s"} on file`} />
        <KpiTile index={2} label="Open tasks" value={openTasks.count ?? 0} href="/tasks" Icon={CheckSquare} tone="gold"
          hint={upcomingTasks.length > 0 ? `${upcomingTasks.length} due within 7 days or overdue` : "Nothing due this week"} />
        <KpiTile index={3} label="Assistant runs this month" value={runs.toLocaleString()} suffix={runLimit ? `/ ${runLimit.toLocaleString()}` : undefined}
          href="/assistants" Icon={Sparkles} tone={runLimit && runs / runLimit >= 0.85 ? "warn" : "accent"}
          hint={delta === null ? "Last 14 days" : `${delta >= 0 ? "+" : ""}${delta}% vs last month`}>
          {runLimit > 0 ? <ProgressBar value={runs} max={runLimit} label="Assistant runs used this month" /> : <div className="text-accent"><Sparkline values={spark} label="Assistant runs, last 14 days" /></div>}
        </KpiTile>
        <KpiTile index={4} label="Team members" value={teamCount.count ?? 1} suffix={seats ? `/ ${seats}` : undefined} href="/settings" Icon={Users} tone="ok"
          hint={`${hireTotal} AI assistant${hireTotal === 1 ? "" : "s"} hired`} />
      </div>

      <nav aria-label="Quick actions" className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {QUICK_ACTIONS.map(({ href, label, hint, Icon }, i) => (
          <Link key={href} href={href} style={{ "--i": 5 + i } as React.CSSProperties}
            className="dv-rise group flex items-center gap-3 rounded-xl border border-line bg-surface/70 px-3.5 py-3 transition-colors hover:border-accent/50 hover:bg-surface">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted transition-colors group-hover:bg-accent/12 group-hover:text-accent"><Icon className="h-4 w-4" aria-hidden /></span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{label}</span>
              <span className="hidden truncate text-xs text-muted sm:block">{hint}</span>
            </span>
          </Link>
        ))}
      </nav>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Your AI team" index={9} action={{ href: "/assistants", label: hireTotal > 0 ? "Manage" : "Browse" }}>
            <AiTeamPanel hires={(hireList.data ?? []) as TeamHire[]} total={hireTotal}
              canHire={state.active} />
            {hireTotal === 0 && state.active && (
              <p className="border-t border-line px-4 py-2.5 text-center text-xs text-muted">Your package includes {state.plan.maxCatalogAssistants} assistants.</p>
            )}
          </Panel>

          <Panel title="Recent AI work" index={10} action={aiItems.length > 0 ? { href: "/assistants", label: "AI Team" } : undefined}>
            {aiItems.length === 0 ? (
              <PanelEmpty icon={<Activity className="h-5 w-5" aria-hidden />} title="No assistant work yet">Results from your AI team will appear here as they complete tasks.</PanelEmpty>
            ) : (
              <ul className="divide-y divide-line">
                {aiItems.map((o) => (
                  <li key={o.id}>
                    <Link href={`/outputs/${o.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/12 text-accent"><Sparkles className="h-3.5 w-3.5" aria-hidden /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{catalogAgent(o.agent_key ?? "")?.name ?? "Custom assistant"}</span>
                        <span className="line-clamp-1 text-sm text-muted">{o.instructions}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">{formatDate(o.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Recent documents" index={11}>
            {docs.length === 0 ? (
              <PanelEmpty icon={<FolderOpen className="h-5 w-5" aria-hidden />} title="No documents yet">Upload documents to a matter and your assistants can read them.</PanelEmpty>
            ) : (
              <ul className="divide-y divide-line">
                {docs.map((d) => (
                  <li key={d.id as string}>
                    <a href={`/api/documents/${d.id}/download`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-surface-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{d.title as string}</span>
                      <span className="shrink-0 text-xs text-muted">{formatDate(d.created_at as string)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel flush title="Upcoming and overdue" index={9} action={{ href: "/tasks", label: "All tasks" }}>
            {upcomingTasks.length === 0 ? (
              <Card><PanelEmpty icon={<CheckSquare className="h-5 w-5" aria-hidden />} title="You're all caught up">No tasks are due in the next 7 days.</PanelEmpty></Card>
            ) : (
              <TaskList tasks={upcomingTasks} matterLinks={matterLinks} />
            )}
          </Panel>

          <Panel title="Recently active matters" index={10} action={{ href: "/matters", label: "All matters" }}>
            {matters.length === 0 ? (
              <PanelEmpty icon={<Briefcase className="h-5 w-5" aria-hidden />} title="No open matters">Create your first matter to start tracking work.</PanelEmpty>
            ) : (
              <ul className="divide-y divide-line">
                {matters.map((m) => (
                  <li key={m.id}>
                    <Link href={`/matters/${m.id}`} className="block px-4 py-3 hover:bg-surface-2">
                      <span className="font-medium text-accent">{matterRef(m)}</span> {m.title}
                      <p className="text-xs text-muted">Updated {formatDate(m.updated_at, true)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Status" index={11} action={{ href: "/settings#integrations", label: "Settings" }}>
            <ul className="divide-y divide-line text-sm">
              <StatusRow label="Package" value={state.active ? state.plan.name : "Inactive"} tone={state.active ? "ok" : "warn"} />
              <StatusRow label="AI service" value={integrations.ai ? "Connected" : "Not configured"} tone={integrations.ai ? "ok" : "warn"} />
              <StatusRow label="Billing" value={integrations.billing ? "Connected" : "Not configured"} tone={integrations.billing ? "ok" : "warn"} />
              <StatusRow label="Zoho Bigin" value={connections.some((c) => c.provider === "zoho_bigin") ? "Connected" : "Not connected"} tone={connections.some((c) => c.provider === "zoho_bigin") ? "ok" : "muted"} />
              <StatusRow label="Notion" value={connections.some((c) => c.provider === "notion") ? "Connected" : "Not connected"} tone={connections.some((c) => c.provider === "notion") ? "ok" : "muted"} />
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "muted" }) {
  const cls = { ok: "text-ok", warn: "text-warn", muted: "text-muted" }[tone];
  const dot = { ok: "bg-ok", warn: "bg-warn", muted: "bg-muted/50" }[tone];
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="text-muted">{label}</span>
      <b className={`inline-flex items-center gap-1.5 font-medium ${cls}`}><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />{value}</b>
    </li>
  );
}
