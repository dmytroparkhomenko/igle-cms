"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/sites", label: "Sites" },
  { href: "/templates", label: "Templates" },
  { href: "/integrations", label: "Integrations" },
  { href: "/deployments", label: "Deployments" },
  { href: "/tickets", label: "Tickets" },
  { href: "/jobs", label: "Jobs" },
  { href: "/team", label: "Team" },
  { href: "/servers", label: "Servers" },
  { href: "/settings", label: "Settings" }
];

const adminOnly = new Set(["/team", "/servers"]);

export function Nav({ showTeam }: { showTeam: boolean }) {
  const pathname = usePathname();
  const visibleLinks = showTeam ? links : links.filter((link) => !adminOnly.has(link.href));

  return (
    <nav className="nav" aria-label="Primary">
      {visibleLinks.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link key={link.href} href={link.href} className={active ? "active" : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
