import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { Nav } from "./Nav";
import { ThemeToggle } from "./ThemeToggle";
import { runtime } from "../lib/runtime";
import { getCurrentActor } from "../lib/session";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Igle CMS",
  description: "Static-site CMS"
};

// Dark is the default (see globals.css); this only needs to act when someone has explicitly
// chosen light. Runs before first paint so there's no flash of the wrong theme — and before React
// hydrates, which is exactly why <html> below carries suppressHydrationWarning.
const THEME_INIT_SCRIPT = `try{if(localStorage.getItem("igle-theme")==="light"){document.documentElement.setAttribute("data-theme","light")}}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (pathname.startsWith("/login")) {
    return (
      <html lang="en" className={inter.variable} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        </head>
        <body>{children}</body>
      </html>
    );
  }

  const actor = await getCurrentActor();
  const unreadCount = actor ? await runtime.notificationService.unreadCount(actor) : 0;

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">
              <span className="brand-mark">IG</span>
              <span>Igle CMS</span>
            </div>
            <Nav showTeam={actor?.role === "administrator"} />
            {actor ? (
              <div className="sidebar-account">
                <p className="muted" style={{ margin: 0, fontSize: 12, wordBreak: "break-all" }}>
                  {actor.email}
                </p>
                <a href="/notifications" className="muted" style={{ display: "block", fontSize: 12, margin: "4px 0" }}>
                  Notifications{unreadCount > 0 ? ` (${unreadCount})` : ""}
                </a>
                <ThemeToggle />
                <form method="post" action="/api/auth/logout">
                  <button className="button button-ghost" type="submit" style={{ padding: "4px 0", fontSize: 12.5, color: "var(--accent)" }}>
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
