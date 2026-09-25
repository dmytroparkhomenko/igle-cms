"use client";

import { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "./icons";

const STORAGE_KEY = "igle-theme";

export function ThemeToggle() {
  // Starts null (renders nothing) so the first client render matches the server's — the inline
  // script in layout.tsx already applied the real theme to the DOM before paint, this just needs
  // to catch up on which one it picked before showing a matching icon/label.
  const [isLight, setIsLight] = useState<boolean | null>(null);

  useEffect(() => {
    setIsLight(document.documentElement.getAttribute("data-theme") === "light");
  }, []);

  function toggle() {
    const next = !isLight;
    setIsLight(next);
    if (next) {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try {
      localStorage.setItem(STORAGE_KEY, next ? "light" : "dark");
    } catch {
      // Private browsing / storage disabled — the choice just won't survive a reload.
    }
  }

  if (isLight === null) {
    return <span style={{ display: "block", height: 26 }} />;
  }

  return (
    <button
      type="button"
      className="button button-ghost"
      onClick={toggle}
      style={{ fontSize: 12, padding: "4px 0", justifyContent: "flex-start", width: "100%" }}
    >
      {isLight ? <MoonIcon /> : <SunIcon />}
      <span>{isLight ? "Dark mode" : "Light mode"}</span>
    </button>
  );
}
