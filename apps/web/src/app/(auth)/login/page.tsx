import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, Field, Input } from "@/components/ui";
import { signIn } from "../actions";
import { OAuthButtons } from "@/components/oauth-buttons";
import { enabledOAuthProviders } from "@/lib/oauth";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const providers = await enabledOAuthProviders();
  return (
    <Card className="p-6">
      <h1 className="font-display text-xl font-semibold">Sign in</h1>
      {error && <p className="mt-2 text-sm text-bad">{error === "oauth" ? "Sign-in with that account did not complete. Please try again." : "That link is invalid or has expired. Please sign in."}</p>}
      <OAuthButtons providers={providers} next={next} />
      <ActionForm action={signIn} className="mt-4 space-y-4">
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
