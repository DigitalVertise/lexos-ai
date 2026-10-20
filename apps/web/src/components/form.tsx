"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, Notice, buttonStyles } from "./ui";

export type FormState = { error?: string; ok?: string } | null;

export function SubmitButton({ children, pendingLabel, variant = "primary", className }: {
  children: ReactNode; pendingLabel?: string; variant?: keyof typeof buttonStyles; className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending} className={className}>
      {pending ? pendingLabel ?? "Saving…" : children}
    </Button>
  );
}

/** A form bound to a server action returning FormState, with inline errors. */
export function ActionForm({ action, children, className, resetOnSuccess = false }: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state?.error && <div className="mt-3"><Notice tone="bad">{state.error}</Notice></div>}
      {state?.ok && <div className="mt-3"><Notice tone="ok">{state.ok}</Notice></div>}
    </form>
  );
}
