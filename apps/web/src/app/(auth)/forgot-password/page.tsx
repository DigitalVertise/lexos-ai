import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input } from "@/components/ui";
import { requestReset } from "../actions";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <Card className="p-6">
      <h1 className="font-display text-xl font-semibold">Reset your password</h1>
      <ActionForm action={requestReset} className="mt-5 space-y-4">
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
        <SubmitButton className="w-full" pendingLabel="Sending…">Send reset link</SubmitButton>
      </ActionForm>
    </Card>
  );
}
