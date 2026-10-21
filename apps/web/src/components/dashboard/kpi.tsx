import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "../ui";

export function KpiTile({ label, value, suffix, hint, href, Icon, index, tone = "accent", children }: {
  label: string;
  value: number | string;
  suffix?: string;
  hint?: ReactNode;
  href: string;
  Icon: LucideIcon;
  index: number;
  tone?: "accent" | "gold" | "ok" | "warn";
  children?: ReactNode;
}) {
  const toneCls = { accent: "bg-accent/12 text-accent", gold: "bg-gold/15 text-gold", ok: "bg-ok/15 text-ok", warn: "bg-warn/15 text-warn" }[tone];
  return (
    <Link href={href} style={{ "--i": index } as CSSProperties} className="dv-rise group relative block overflow-hidden rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-accent/50">
      <div aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-accent/5 blur-2xl transition-opacity group-hover:opacity-100" />
      <div className="flex items-start justify-between">
        <span className={cx("grid h-9 w-9 place-items-center rounded-xl", toneCls)}><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
        <ArrowUpRight className="h-4 w-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </div>
      <p className="mt-3 flex items-baseline gap-1.5">
        <span className="text-[28px] font-semibold leading-none tabular-nums tracking-tight">{value}</span>
        {suffix && <span className="text-sm tabular-nums text-muted">{suffix}</span>}
      </p>
      <p className="mt-1.5 text-sm text-muted">{label}</p>
      {children && <div className="mt-3">{children}</div>}
      {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
    </Link>
  );
}
