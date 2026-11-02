"use client";

import { Bot, Briefcase, CheckSquare, Clapperboard, LayoutDashboard, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/assistants", label: "AI Team", Icon: Bot },
  { href: "/studio", label: "Avatar studio", Icon: Clapperboard },
  { href: "/matters", label: "Matters", Icon: Briefcase },
  { href: "/clients", label: "Clients", Icon: Users },
  { href: "/tasks", label: "Tasks", Icon: CheckSquare },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="flex gap-1 overflow-x-auto px-3 pb-3 [scrollbar-width:none] md:flex-1 md:flex-col md:overflow-visible md:pb-0 [&::-webkit-scrollbar]:hidden"
    >
      {LINKS.map(({ href, label, Icon }) => {
        const active = path === href || path.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "group relative flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-accent/10 font-medium text-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            {/* Active indicator: bar on the left (sidebar) / underline (mobile strip). */}
            <span
              aria-hidden
              className={cx(
                "absolute rounded-full bg-accent transition-opacity",
                "inset-x-3 -bottom-0.5 h-0.5 md:inset-x-auto md:bottom-auto md:-left-3 md:top-1/2 md:h-5 md:w-[3px] md:-translate-y-1/2",
                active ? "opacity-100" : "opacity-0",
              )}
            />
            <Icon className={cx("h-4 w-4 shrink-0 transition-colors", active ? "text-accent" : "text-muted group-hover:text-ink")} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
