import Link from "next/link";
import type { ComponentProps } from "react";
import { cx } from "@/components/ui";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 active:scale-[0.98] whitespace-nowrap";
const sizes = { md: "px-4 py-2.5 text-sm", lg: "px-6 py-3.5 text-[15px]" };
const variants = {
  primary: "bg-accent text-accent-ink btn-glow hover:brightness-110",
  outline: "glass text-ink hover:border-accent/60 hover:bg-surface-2",
  ghost: "text-muted hover:text-ink",
};

export function LButton({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof variants; size?: keyof typeof sizes }) {
  return <Link className={cx(base, sizes[size], variants[variant], className)} {...props} />;
}
