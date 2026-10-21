import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "../ui";

/** Titled dashboard card with optional header link; animates in. */
export function Panel({ title, action, index = 0, className, flush, children }: {
  /** flush: no outer chrome, for children that bring their own Card (e.g. TaskList). */
  flush?: boolean;
  title: string;
  action?: { href: string; label: string };
  index?: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section style={{ "--i": index } as CSSProperties} className={cx("dv-rise", !flush && "overflow-hidden rounded-2xl border border-line bg-surface", className)}>
      <header className={cx("flex items-center justify-between gap-3", flush ? "mb-3 px-1" : "border-b border-line px-4 py-3")}>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {action && <Link href={action.href} className="text-xs font-medium text-accent hover:underline">{action.label}</Link>}
      </header>
      {children}
    </section>
  );
}

export function PanelEmpty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-5 py-8 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-surface-2 text-muted">{icon}</span>
      <p className="mt-2.5 text-sm font-medium">{title}</p>
      {children && <p className="mt-0.5 max-w-xs text-xs text-muted">{children}</p>}
    </div>
  );
}
