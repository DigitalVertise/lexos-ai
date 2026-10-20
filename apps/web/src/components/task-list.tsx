import Link from "next/link";
import { deleteTask, toggleTask } from "@/lib/actions/tasks";
import { dueState } from "@/lib/dates";
import type { Task } from "@/lib/types";
import { Badge, Card, formatDate } from "./ui";

const DUE_TONE = { overdue: "bad", today: "warn", soon: "accent", later: "neutral", none: "neutral" } as const;
const DUE_LABEL = { overdue: "Overdue", today: "Due today", soon: "This week", later: "", none: "" };

export function TaskList({ tasks, matterLinks, canDelete }: {
  tasks: Task[];
  matterLinks?: Map<string, string>;
  canDelete?: boolean;
}) {
  if (tasks.length === 0) return <p className="text-sm text-muted">No tasks.</p>;
  return (
    <Card className="divide-y divide-line">
      {tasks.map((t) => {
        const state = t.status === "done" ? "none" : dueState(t.due_at);
        return (
          <div key={t.id} className="flex items-start gap-3 px-4 py-3">
            <form action={toggleTask}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="done" value={t.status === "done" ? "0" : "1"} />
              <input type="hidden" name="matterId" value={t.matter_id ?? ""} />
              <button type="submit" aria-label={t.status === "done" ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`}
                className={`mt-0.5 h-5 w-5 rounded border ${t.status === "done" ? "border-ok bg-ok text-white" : "border-line bg-surface"} text-xs leading-none`}>
                {t.status === "done" ? "✓" : ""}
              </button>
            </form>
            <div className="min-w-0 flex-1">
              <p className={t.status === "done" ? "text-muted line-through" : "font-medium"}>{t.title}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                {t.due_at && <span>Due {formatDate(t.due_at, true)}</span>}
                {DUE_LABEL[state] && <Badge tone={DUE_TONE[state]}>{DUE_LABEL[state]}</Badge>}
                {t.priority === "high" && t.status !== "done" && <Badge tone="bad">High priority</Badge>}
                {t.matter_id && matterLinks?.get(t.matter_id) && (
                  <Link href={`/matters/${t.matter_id}`} className="text-accent">{matterLinks.get(t.matter_id)}</Link>
                )}
              </div>
              {t.description && <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{t.description}</p>}
            </div>
            {canDelete && (
              <form action={deleteTask}>
                <input type="hidden" name="id" value={t.id} />
                <button type="submit" className="text-xs text-muted hover:text-bad" aria-label={`Delete "${t.title}"`}>Delete</button>
              </form>
            )}
          </div>
        );
      })}
    </Card>
  );
}
