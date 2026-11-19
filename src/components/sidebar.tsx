"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { LayoutDashboard, UploadCloud, History, Building2, FileSpreadsheet, Settings, Workflow, Menu, X } from "lucide-react";
import { useState } from "react";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/process", label: "Process Invoice", icon: UploadCloud },
  { href: "/history", label: "Processing History", icon: History },
  { href: "/vendors", label: "Vendors", icon: Building2 },
  { href: "/purchase-orders", label: "Purchase Orders", icon: FileSpreadsheet },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href) || (href === "/history" && path.startsWith("/runs")));
  return (
    <>
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-surface px-4 lg:hidden">
        <Brand />
        <div className="flex items-center gap-2">
        <ThemeToggle compact />
        <button onClick={() => setOpen(!open)} aria-label="Toggle navigation" className="rounded-md p-2 text-slate-600 hover:bg-slate-100">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        </div>
      </div>
      <aside className={clsx("fixed inset-y-0 left-0 z-40 w-60 flex-col border-r border-slate-200 bg-surface lg:flex", open ? "flex" : "hidden")}>
        <div className="flex h-16 items-center border-b border-slate-100 px-5"><Brand /></div>
        <nav className="flex-1 space-y-0.5 p-3">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}
              className={clsx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active(href) ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")}>
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="hidden border-t border-slate-100 px-4 pt-4 lg:block">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Appearance</div>
          <ThemeToggle className="w-full [&>button]:flex-1 [&>button]:justify-center" />
        </div>
        <div className="p-4 text-[11px] leading-relaxed text-slate-400">
          Accounts Payable automation prototype.<br />Decisions are deterministic and fully explained.
        </div>
      </aside>
    </>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-sm">
        <Workflow className="h-4 w-4" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-slate-900">InvoiceFlow AI</span>
        <span className="block text-[10px] text-slate-500">Intelligent AP Automation</span>
      </span>
    </Link>
  );
}
