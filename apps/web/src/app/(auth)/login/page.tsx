import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input } from "@/components/ui";
import { signIn } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <Card className="p-6">
      <h1 className="font-display text-xl font-semibold">Sign in</h1>
      {error && <p className="mt-2 text-sm text-bad">That link is invalid or has expired. Please sign in.</p>}
      <ActionForm action={signIn} className="mt-5 space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        <SubmitButton className="w-full" pendingLabel="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <div className="mt-5 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-muted hover:text-ink">Forgot password?</Link>
        <Link href="/signup" className="text-accent">Create account</Link>
      </div>
    </Card>
  );
}
