import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input } from "@/components/ui";
import { updatePassword } from "../actions";

export const metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <Card className="p-6">
      <h1 className="font-display text-xl font-semibold">Choose a new password</h1>
      <ActionForm action={updatePassword} className="mt-5 space-y-4">
        <Field label="New password" hint="At least 10 characters."><Input name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <SubmitButton className="w-full">Save password</SubmitButton>
      </ActionForm>
    </Card>
  );
}
