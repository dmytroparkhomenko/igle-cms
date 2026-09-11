import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Igle CMS",
  description: "Static-site CMS"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">Igle CMS</div>
            <nav className="nav" aria-label="Primary">
              <Link href="/">Dashboard</Link>
              <Link href="/sites">Sites</Link>
              <Link href="/templates">Templates</Link>
              <Link href="/integrations">Integrations</Link>
              <Link href="/deployments">Deployments</Link>
              <Link href="/jobs">Jobs</Link>
              <Link href="/settings">Settings</Link>
            </nav>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
