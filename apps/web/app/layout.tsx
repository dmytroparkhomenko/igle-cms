import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { Nav } from "./Nav";
import { runtime } from "../lib/runtime";
import { getCurrentActor } from "../lib/session";

export const metadata: Metadata = {
  title: "Igle CMS",
  description: "Static-site CMS"
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (pathname.startsWith("/login")) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  const actor = await getCurrentActor();
  const unreadCount = actor ? await runtime.notificationService.unreadCount(actor) : 0;

  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">Igle CMS</div>
            <Nav showTeam={actor?.role === "administrator"} />
            {actor ? (
              <div className="sidebar-account">
                <p className="muted" style={{ margin: 0, fontSize: 12, wordBreak: "break-all" }}>
                  {actor.email}
                </p>
                <a href="/notifications" className="muted" style={{ display: "block", fontSize: 12, margin: "4px 0" }}>
                  Notifications{unreadCount > 0 ? ` (${unreadCount})` : ""}
                </a>
                <form method="post" action="/api/auth/logout">
                  <button className="button" type="submit" style={{ background: "none", color: "var(--accent)", padding: "4px 0", fontSize: 12.5 }}>
                    Sign out
                  </button>
                </form>
              </div>
            ) : null}
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
