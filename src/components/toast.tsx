"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

type Tone = "success" | "error" | "info" | "warning";
interface ToastItem { id: number; tone: Tone; title: string; description?: string }
const Ctx = createContext<(t: Omit<ToastItem, "id">) => void>(() => undefined);

export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.tone === "error" ? 8000 : 4500);
  }, []);
  const icon = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
  const tone = { success: "text-emerald-600", error: "text-red-600", info: "text-blue-600", warning: "text-amber-600" };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => {
          const Icon = icon[t.tone];
          return (
            <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className="toast-in pointer-events-auto flex items-start gap-3 rounded-lg border border-slate-200 bg-surface px-4 py-3 shadow-lg">
              <Icon className={clsx("mt-0.5 h-4 w-4 shrink-0", tone[t.tone])} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">{t.title}</p>
                {t.description && <p className="mt-0.5 text-xs text-slate-500">{t.description}</p>}
              </div>
              <button onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} aria-label="Dismiss" className="text-slate-400 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
