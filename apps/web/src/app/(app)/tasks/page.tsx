import Link from "next/link";
import { TaskForm } from "@/components/task-form";
import { TaskList } from "@/components/task-list";
import { Card, PageHeader, SectionTitle, cx } from "@/components/ui";
import { LAWYER_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { matterRef, type Task } from "@/lib/types";

export const metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = "open" } = await searchParams;
  const ws = await requireWorkspace();
  let query = ws.supabase.from("tasks").select("*").eq("org_id", ws.org.id).order("due_at", { nullsFirst: false }).limit(300);
  if (view === "mine") query = query.eq("assignee_id", ws.user.id).eq("status", "open");
  else if (view === "done") query = query.eq("status", "done").order("completed_at", { ascending: false });
  else query = query.eq("status", "open");

  const [{ data: tasks }, { data: matters }, { data: members }] = await Promise.all([
    query,
    ws.supabase.from("matters").select("id, number, title").eq("org_id", ws.org.id).neq("status", "closed").order("number", { ascending: false }).limit(300),
    ws.supabase.from("memberships").select("user_id, full_name, email").eq("org_id", ws.org.id),
  ]);
  const matterLinks = new Map((matters ?? []).map((m) => [m.id as string, matterRef(m as { number: number })]));

  return (
    <>
      <PageHeader title="Tasks" description="Times are shown in Dubai time. Dates you enter are reminders — they are not verified court or limitation deadlines." />
      <nav className="mb-4 flex gap-2 text-sm" aria-label="Task views">
        {[["open", "Open"], ["mine", "Assigned to me"], ["done", "Completed"]].map(([v, label]) => (
          <Link key={v} href={`/tasks?view=${v}`} aria-current={view === v ? "page" : undefined}
            className={cx("rounded-lg px-3 py-1.5", view === v ? "bg-surface-2 font-medium" : "text-muted hover:bg-surface-2")}>{label}</Link>
        ))}
      </nav>
      <TaskList tasks={(tasks ?? []) as Task[]} matterLinks={matterLinks} canDelete={hasRole(ws, LAWYER_ROLES)} />
      <SectionTitle>New task</SectionTitle>
      <Card className="p-4">
        <TaskForm members={members ?? []} matters={(matters ?? []).map((m) => ({ id: m.id as string, label: `${matterRef(m as { number: number })} · ${m.title}` }))} />
      </Card>
    </>
  );
}
