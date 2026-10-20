import type { Client, Matter, Membership } from "@/lib/types";
import { Field, Input, Select, Textarea } from "./ui";

export const MATTER_TYPES = [
  "Commercial / corporate", "Commercial dispute", "Employment", "Real estate", "Family / personal status",
  "Criminal", "Banking & finance", "Intellectual property", "Construction", "Debt recovery", "Other",
];

export function MatterFields({ matter, clients, members, defaultClientId, defaultJurisdiction }: {
  matter?: Matter;
  clients: Pick<Client, "id" | "name">[];
  members: Pick<Membership, "user_id" | "full_name" | "email">[];
  defaultClientId?: string;
  defaultJurisdiction?: string | null;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><Field label="Title"><Input name="title" defaultValue={matter?.title} maxLength={300} required placeholder="e.g. Unpaid supplier invoices – Gulf Star Trading" /></Field></div>
      <Field label="Client">
        <Select name="client_id" defaultValue={matter?.client_id ?? defaultClientId ?? ""} required>
          <option value="" disabled>Choose a client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Matter type">
        <Select name="matter_type" defaultValue={matter?.matter_type ?? ""}>
          <option value="">—</option>
          {MATTER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </Field>
      <Field label="Jurisdiction" hint="e.g. UAE (Dubai Courts), DIFC, ADGM">
        <Input name="jurisdiction" defaultValue={matter?.jurisdiction ?? defaultJurisdiction ?? ""} maxLength={100} />
      </Field>
      <Field label="Responsible lawyer">
        <Select name="responsible_user_id" defaultValue={matter?.responsible_user_id ?? ""}>
          <option value="">—</option>
          {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}
        </Select>
      </Field>
      {matter && (
        <Field label="Status">
          <Select name="status" defaultValue={matter.status}>
            <option value="intake">Intake</option>
            <option value="open">Open</option>
            <option value="on_hold">On hold</option>
            <option value="closed">Closed</option>
          </Select>
        </Field>
      )}
      <div className="sm:col-span-2"><Field label="Description" hint="Key facts. Assistants use this when working on the matter."><Textarea name="description" rows={4} defaultValue={matter?.description ?? ""} /></Field></div>
    </div>
  );
}
