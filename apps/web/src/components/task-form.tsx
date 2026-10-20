import { createTask } from "@/lib/actions/tasks";
import type { Membership } from "@/lib/types";
import { ActionForm, SubmitButton } from "./form";
import { Field, Input, Select } from "./ui";

export function TaskForm({ matterId, members, matters }: {
  matterId?: string;
  members: Pick<Membership, "user_id" | "full_name" | "email">[];
  matters?: { id: string; label: string }[];
}) {
  return (
    <ActionForm action={createTask} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
      {matterId && <input type="hidden" name="matterId" value={matterId} />}
      <div className="sm:col-span-2"><Field label="Task"><Input name="title" maxLength={300} required placeholder="e.g. File statement of defence" /></Field></div>
      <Field label="Due (Dubai time)" hint="Software does not verify legal deadlines.">
        <Input name="due" type="datetime-local" />
      </Field>
      <Field label="Priority">
        <Select name="priority" defaultValue="normal">
          <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
        </Select>
      </Field>
      <Field label="Assign to">
        <Select name="assigneeId" defaultValue="">
          <option value="">Unassigned</option>
          {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}
        </Select>
      </Field>
      {matters && (
        <Field label="Matter">
          <Select name="matterId" defaultValue="">
            <option value="">No matter</option>
            {matters.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
        </Field>
      )}
      <div className="sm:col-span-2"><SubmitButton>Add task</SubmitButton></div>
    </ActionForm>
  );
}
