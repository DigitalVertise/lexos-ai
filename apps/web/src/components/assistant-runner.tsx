"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { runAssistantAction, type RunState } from "@/lib/actions/assistants";
import { addSuggestedTasks } from "@/lib/actions/tasks";
import { Badge, Button, Card, Field, Notice, Textarea } from "./ui";

interface Props {
  hireId: string;
  assistantName: string;
  examplePrompt: string;
  matter: { id: string; ref: string; title: string } | null;
  documents: { id: string; title: string; readable: boolean }[];
  disabledReason: string | null;
}

function RunButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending}>
      {pending ? "Working on it… (up to a minute)" : "Give task"}
    </Button>
  );
}

export function AssistantRunner({ hireId, assistantName, examplePrompt, matter, documents, disabledReason }: Props) {
  const [state, action] = useActionState<RunState, FormData>(runAssistantAction, { status: "idle" });
  const [copied, setCopied] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <form action={action} className="space-y-4">
          <input type="hidden" name="hireId" value={hireId} />
          {matter && <input type="hidden" name="matterId" value={matter.id} />}
          {documents.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Documents to use (up to 5)</legend>
              <div className="space-y-1">
                {documents.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="documentIds" value={d.id} disabled={!d.readable} />
                    <span className={d.readable ? "" : "text-muted"}>{d.title}{!d.readable && " (not readable by AI)"}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Field label={`What should ${assistantName} do?`}>
            <Textarea name="request" rows={6} maxLength={8000} placeholder={examplePrompt} required />
          </Field>
          {disabledReason && <Notice tone="warn">{disabledReason}</Notice>}
          <RunButton disabled={Boolean(disabledReason)} />
          <p className="text-xs text-muted">
            The assistant sees only this request{matter ? `, matter ${matter.ref}` : ""} and the documents you tick. Output is a draft for lawyer review.
          </p>
        </form>
      </Card>

      {state.status === "error" && <Notice tone="bad">{state.error}</Notice>}

      {state.status === "done" && (
        <Card className="p-5" aria-live="polite">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="font-medium">Result</p>
              <Badge tone="warn">AI draft — verify before use</Badge>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" type="button" onClick={async () => {
                await navigator.clipboard.writeText(state.text);
                setCopied(true);
              }}>{copied ? "Copied" : "Copy"}</Button>
              {matter && <Link href={`/matters/${matter.id}#ai`} className="rounded-lg border border-line px-3.5 py-2 text-sm">Saved to {matter.ref}</Link>}
            </div>
          </div>

          {state.tasks ? (
            <div className="space-y-3">
              {state.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
              <ul className="space-y-2">
                {state.tasks.map((t, i) => (
                  <li key={i} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{t.title}</p>
                      <Badge tone={t.priority === "high" ? "bad" : "neutral"}>{t.priority}</Badge>
                      <span className="text-xs text-muted">{t.due_date ? `Suggested: ${t.due_date}` : "No date suggested"}</span>
                    </div>
                    {t.description && <p className="mt-1 text-sm">{t.description}</p>}
                    {t.basis && <p className="mt-1 text-xs text-muted">Basis: {t.basis}</p>}
                  </li>
                ))}
              </ul>
              {matter ? (
                added ? <Notice tone="ok">{added}</Notice> : (
                  <form action={async (fd) => { const r = await addSuggestedTasks(fd); setAdded(r); }}>
                    <input type="hidden" name="matterId" value={matter.id} />
                    <input type="hidden" name="outputId" value={state.outputId} />
                    <Button type="submit">Add all {state.tasks.length} tasks to {matter.ref}</Button>
                    <p className="mt-1 text-xs text-muted">Dates are suggestions. Verify every court and limitation deadline.</p>
                  </form>
                )
              ) : <p className="text-sm text-muted">Open this assistant from a matter to add these tasks to it.</p>}
            </div>
          ) : (
            <div className="prose-output">{state.text}</div>
          )}
        </Card>
      )}
    </div>
  );
}
