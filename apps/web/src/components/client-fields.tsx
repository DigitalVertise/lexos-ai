import type { Client } from "@/lib/types";
import { Field, Input, Select, Textarea } from "./ui";

export function ClientFields({ client }: { client?: Client }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Type">
        <Select name="kind" defaultValue={client?.kind ?? "individual"}>
          <option value="individual">Individual</option>
          <option value="organization">Company / organization</option>
        </Select>
      </Field>
      <Field label="Name"><Input name="name" defaultValue={client?.name} maxLength={200} required /></Field>
      <Field label="Email"><Input name="email" type="email" defaultValue={client?.email ?? ""} /></Field>
      <Field label="Phone"><Input name="phone" type="tel" defaultValue={client?.phone ?? ""} placeholder="+971…" /></Field>
      <div className="sm:col-span-2"><Field label="Address"><Input name="address" defaultValue={client?.address ?? ""} /></Field></div>
      <div className="sm:col-span-2"><Field label="Notes"><Textarea name="notes" rows={3} defaultValue={client?.notes ?? ""} /></Field></div>
    </div>
  );
}
