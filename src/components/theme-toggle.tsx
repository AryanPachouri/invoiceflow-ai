"use client";
import clsx from "clsx";
import { Moon, Sun } from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme";

/** Segmented Light / Dark switch. Applies instantly and persists across reloads. */
export function ThemeToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const [theme, setTheme] = useTheme();
  const opts: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ];
  return (
    <div role="radiogroup" aria-label="Color theme" className={clsx("inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5", className)}>
      {opts.map(({ value, label, icon: Icon }) => (
        <button key={value} role="radio" aria-checked={theme === value} onClick={() => setTheme(value)} title={`${label} mode`}
          // Highlight is driven by the .dark class (set before first paint), so it's correct even before hydration.
          className={clsx("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            value === "light"
              ? "bg-blue-600 text-white shadow-sm dark:bg-transparent dark:text-slate-500 dark:shadow-none dark:hover:text-slate-800"
              : "text-slate-500 hover:text-slate-800 dark:bg-blue-600 dark:text-white dark:shadow-sm dark:hover:text-white")}>
          <Icon className="h-3.5 w-3.5" />
          {!compact && label}
        </button>
      ))}
    </div>
  );
}
