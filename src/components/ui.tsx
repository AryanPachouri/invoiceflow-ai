"use client";
import clsx from "clsx";
import { X as XIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, XCircle, MinusCircle, Clock } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx("rounded-xl border border-slate-200 bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)} {...rest}>{children}</div>;
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" };
export function Button({ variant = "secondary", size = "md", className, children, ...rest }: BtnProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
        variant === "primary" && "bg-blue-600 text-white hover:bg-blue-700 dark:hover:bg-blue-500 shadow-sm",
        variant === "secondary" && "border border-slate-200 bg-surface text-slate-700 hover:bg-slate-50",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100",
        variant === "danger" && "border border-red-200 bg-surface text-red-600 hover:bg-red-50",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  APPROVED: { label: "Approved", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", dot: "bg-emerald-500" },
  NEEDS_REVIEW: { label: "Needs review", cls: "bg-amber-50 text-amber-800 ring-amber-600/25", dot: "bg-amber-500" },
  REJECTED: { label: "Rejected", cls: "bg-red-50 text-red-700 ring-red-600/20", dot: "bg-red-500" },
  FAILED: { label: "Failed", cls: "bg-slate-100 text-slate-700 ring-slate-500/20", dot: "bg-slate-500" },
  PROCESSING: { label: "Processing", cls: "bg-blue-50 text-blue-700 ring-blue-600/20", dot: "bg-blue-500" },
  QUEUED: { label: "Queued", cls: "bg-blue-50 text-blue-700 ring-blue-600/20", dot: "bg-blue-400" },
  ACTIVE: { label: "Active", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", dot: "bg-emerald-500" },
  INACTIVE: { label: "Inactive", cls: "bg-red-50 text-red-700 ring-red-600/20", dot: "bg-red-500" },
  PENDING_VERIFICATION: { label: "Pending verification", cls: "bg-amber-50 text-amber-800 ring-amber-600/25", dot: "bg-amber-500" },
  DRAFT: { label: "Draft", cls: "bg-slate-100 text-slate-700 ring-slate-500/20", dot: "bg-slate-400" },
  SENDING: { label: "Sending", cls: "bg-blue-50 text-blue-700 ring-blue-600/20", dot: "bg-blue-500" },
  SENT: { label: "Sent", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", dot: "bg-emerald-500" },
  SUPERSEDED: { label: "Superseded", cls: "bg-slate-100 text-slate-600 ring-slate-500/20", dot: "bg-slate-400" },
  OPEN: { label: "Open", cls: "bg-blue-50 text-blue-700 ring-blue-600/20", dot: "bg-blue-500" },
  CLOSED: { label: "Closed", cls: "bg-slate-100 text-slate-600 ring-slate-500/20", dot: "bg-slate-400" },
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const m = STATUS_META[status ?? ""] ?? { label: status ?? "—", cls: "bg-slate-100 text-slate-600 ring-slate-500/20", dot: "bg-slate-400" };
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", m.cls, className)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

/** Effective status for a run: decision if completed, otherwise lifecycle. */
export function runStatus(r: { run_status: string; final_status: string | null }) {
  return r.run_status === "COMPLETED" ? r.final_status : r.run_status;
}

export function SampleTag() {
  return <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 ring-1 ring-inset ring-violet-600/20">Sample</span>;
}

export function CheckIcon({ status, className }: { status: string; className?: string }) {
  const c = clsx("h-4 w-4 shrink-0", className);
  if (status === "PASS") return <CheckCircle2 className={clsx(c, "text-emerald-600")} />;
  if (status === "FAIL") return <XCircle className={clsx(c, "text-red-600")} />;
  if (status === "WARN") return <AlertTriangle className={clsx(c, "text-amber-500")} />;
  return <MinusCircle className={clsx(c, "text-slate-400")} />;
}

export function StageIcon({ status, outcome }: { status: string; outcome?: string | null }) {
  if (status === "RUNNING") return <span className="pulse-ring flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-white"><Loader2 className="h-4 w-4 animate-spin" /></span>;
  if (status === "COMPLETED" && outcome === "WARN") return <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-600"><AlertTriangle className="h-4 w-4" /></span>;
  if (status === "COMPLETED") return <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 className="h-4 w-4" /></span>;
  if (status === "FAILED") return <span className="flex h-7 w-7 items-center justify-center rounded-full bg-red-100 text-red-600"><XCircle className="h-4 w-4" /></span>;
  if (status === "SKIPPED") return <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-400"><MinusCircle className="h-4 w-4" /></span>;
  return <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-slate-200 text-slate-300"><Clock className="h-3.5 w-3.5" /></span>;
}

export function Spinner({ label }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />{label ?? "Loading…"}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <CircleDashed className="mb-3 h-8 w-8 text-slate-300" />
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{message}</div>
      {onRetry && <button onClick={onRetry} className="text-xs font-semibold underline">Retry</button>}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx("h-9 rounded-lg border border-slate-200 bg-surface px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx("h-9 rounded-lg border border-slate-200 bg-surface px-2.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20", props.className)} />;
}

export function KV({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={clsx("text-sm text-slate-800", mono && "font-mono text-xs break-all")}>{children ?? "—"}</dd>
    </div>
  );
}

/** Accessible modal dialog: Escape and backdrop close it, it scrolls internally on small screens. */
export function Modal({ title, subtitle, onClose, children, footer, size = "md" }: {
  title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg";
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-[1px] sm:items-center sm:p-4" onClick={onClose}
      role="presentation">
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        className={clsx("flex max-h-[92vh] w-full flex-col rounded-t-xl border border-slate-200 bg-surface shadow-2xl sm:rounded-xl",
          size === "sm" ? "sm:max-w-md" : size === "lg" ? "sm:max-w-3xl" : "sm:max-w-xl")}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close dialog" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><XIcon className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx("w-full rounded-lg border border-slate-200 bg-surface px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20", props.className)} />;
}

export function FieldLabel({ label, hint, error, required, children, badge }: { label: string; hint?: ReactNode; error?: string; required?: boolean; children: ReactNode; badge?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-700">{label}{required && <span className="text-red-600">*</span>}{badge}</span>
      {children}
      {error ? <span className="mt-1 block text-[11px] font-medium text-red-600">{error}</span> : hint ? <span className="mt-1 block text-[11px] text-slate-400">{hint}</span> : null}
    </label>
  );
}
