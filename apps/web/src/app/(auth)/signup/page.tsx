import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input } from "@/components/ui";
import { signUp } from "../actions";

export const metadata = { title: "Start free trial" };

export default function SignupPage() {
  return (
    <Card className="p-6">
      <h1 className="font-display text-xl font-semibold">Start your free trial</h1>
      <p className="mt-1 text-sm text-muted">14 days of the Basic package. No card needed.</p>
      <ActionForm action={signUp} className="mt-5 space-y-4">
        <Field label="Your name"><Input name="name" autoComplete="name" required /></Field>
        <Field label="Work email"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" hint="At least 10 characters."><Input name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <SubmitButton className="w-full" pendingLabel="Creating account…">Create account</SubmitButton>
      </ActionForm>
      <p className="mt-5 text-sm text-muted">Already have an account? <Link href="/login" className="text-accent">Sign in</Link></p>
    </Card>
  );
}
