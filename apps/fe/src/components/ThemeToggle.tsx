"use client";

import { useEffect, useSyncExternalStore } from "react";

type Theme = "dark" | "light";
const EVENT = "deltamon-theme-change";

function readTheme(): Theme {
  try {
    return window.localStorage.getItem("deltamon.theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => "dark");
}

export function ThemeToggle() {
  const theme = useTheme();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    try {
      window.localStorage.setItem("deltamon.theme", next);
    } catch {
      /* private mode */
    }
    document.documentElement.dataset.theme = next;
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="theme-toggle"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
    >
      <span aria-hidden="true">{theme === "dark" ? "☼" : "◐"}</span>
    </button>
  );
}
