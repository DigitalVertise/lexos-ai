"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/assistants", label: "AI Team" },
  { href: "/studio", label: "Avatar studio" },
  { href: "/matters", label: "Matters" },
  { href: "/clients", label: "Clients" },
  { href: "/tasks", label: "Tasks" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
      {LINKS.map((l) => {
        const active = path === l.href || path.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "whitespace-nowrap rounded-lg px-3 py-2 text-sm",
              active ? "bg-surface-2 font-medium text-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
