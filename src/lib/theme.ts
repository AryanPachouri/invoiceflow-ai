"use client";
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
import { THEME_KEY } from "./theme-script";
export { THEME_KEY };

const listeners = new Set<() => void>();
const read = (): Theme => (typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light");

export function setTheme(t: Theme) {
  const d = document.documentElement;
  d.classList.add("theme-transition");
  d.classList.toggle("dark", t === "dark");
  d.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* storage unavailable: theme still applies for this session */ }
  window.setTimeout(() => d.classList.remove("theme-transition"), 200);
  listeners.forEach((l) => l());
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    read,
    () => "light" as Theme,
  );
  return [theme, setTheme];
}
