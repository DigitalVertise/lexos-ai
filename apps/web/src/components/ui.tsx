import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
export const buttonStyles = {
  primary: `${buttonBase} bg-accent text-accent-ink hover:opacity-90`,
  secondary: `${buttonBase} border border-line bg-surface text-ink hover:bg-surface-2`,
  ghost: `${buttonBase} text-ink hover:bg-surface-2`,
  danger: `${buttonBase} border border-line bg-surface text-bad hover:bg-surface-2`,
};

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: keyof typeof buttonStyles }) {
  return <button className={cx(buttonStyles[variant], className)} {...props} />;
}

export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: keyof typeof buttonStyles }) {
  return <Link className={cx(buttonStyles[variant], className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-xl border border-line bg-surface", className)} {...props} />;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center justify-between gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{children}</h2>
      {action}
    </div>
  );
}

const badgeTones = {
  neutral: "border-line text-muted",
  ok: "border-ok/40 text-ok",
  warn: "border-warn/40 text-warn",
  bad: "border-bad/40 text-bad",
  accent: "border-accent/40 text-accent",
  gold: "border-gold/50 text-gold",
};
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs", badgeTones[tone])}>{children}</span>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Card className="px-5 py-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </Card>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "bad"; children: ReactNode }) {
  const tones = {
    neutral: "border-line bg-surface-2",
    ok: "border-ok/30 bg-ok/5 text-ok",
    warn: "border-warn/30 bg-warn/5",
    bad: "border-bad/30 bg-bad/5 text-bad",
  };
  return <div role={tone === "bad" ? "alert" : "status"} className={cx("rounded-lg border px-3.5 py-2.5 text-sm", tones[tone])}>{children}</div>;
}

const inputBase =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[15px] text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputBase, props.className)} />;
}
export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(inputBase, "min-h-24", props.className)} />;
}
export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(inputBase, props.className)} />;
}

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Asia/Dubai",
  });
}
