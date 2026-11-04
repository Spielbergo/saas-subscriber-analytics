"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

// Add new sections here as they're built — nothing else
// needs to change to add a tab.
const links = [
  { href: "/", label: "Overview" },
  { href: "/subscribers", label: "Subscribers" },
  { href: "/crm", label: "CRM" },
  { href: "/revenue", label: "Revenue" },
  { href: "/trends", label: "Trends" },
  { href: "/marketing", label: "Marketing" },
  { href: "/growth", label: "Growth" },
  { href: "/seo", label: "SEO" },
  { href: "/operations", label: "Ops" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b border-border">
      {links.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={clsx(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-accent text-text"
                : "border-transparent text-muted hover:text-text"
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
