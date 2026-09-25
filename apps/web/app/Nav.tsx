"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CloudflareIcon,
  DashboardIcon,
  DeploymentsIcon,
  DomainsIcon,
  IntegrationsIcon,
  JobsIcon,
  ServersIcon,
  SettingsIcon,
  SitesIcon,
  TasksIcon,
  TeamIcon,
  TemplatesIcon
} from "./icons";

const links = [
  { href: "/", label: "Dashboard", icon: DashboardIcon },
  { href: "/sites", label: "Sites", icon: SitesIcon },
  { href: "/templates", label: "Templates", icon: TemplatesIcon },
  { href: "/integrations", label: "Integrations", icon: IntegrationsIcon },
  { href: "/deployments", label: "Deployments", icon: DeploymentsIcon },
  { href: "/tasks", label: "Tasks", icon: TasksIcon },
  { href: "/jobs", label: "Jobs", icon: JobsIcon },
  { href: "/team", label: "Team", icon: TeamIcon },
  { href: "/servers", label: "Servers", icon: ServersIcon },
  { href: "/domains", label: "Domains", icon: DomainsIcon },
  { href: "/cloudflare-accounts", label: "Cloudflare", icon: CloudflareIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon }
];

const adminOnly = new Set(["/team", "/servers", "/domains", "/cloudflare-accounts", "/integrations"]);

export function Nav({ showTeam }: { showTeam: boolean }) {
  const pathname = usePathname();
  const visibleLinks = showTeam ? links : links.filter((link) => !adminOnly.has(link.href));

  return (
    <nav className="nav" aria-label="Primary">
      {visibleLinks.map((link) => {
        const active = link.href === "/" ? pathname === "/" : pathname === link.href || pathname.startsWith(`${link.href}/`);
        const Icon = link.icon;
        return (
          <Link key={link.href} href={link.href} className={active ? "active" : undefined} title={link.label}>
            <Icon />
            <span>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
