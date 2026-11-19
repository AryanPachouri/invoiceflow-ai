export function fmtMoney(n: number | null | undefined, currency?: string | null) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", minimumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency ?? ""} ${n.toFixed(2)}`;
  }
}

export function fmtCompactMoney(n: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: n >= 100000 ? "compact" : "standard", maximumFractionDigits: n >= 100000 ? 1 : 0 }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

export function fmtDateTime(v: string | Date | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtTime(v: string | Date | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  const [y, m, d] = v.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function fmtDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

export function timeAgo(v: string | Date | null | undefined) {
  if (!v) return "—";
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return `${Math.max(s, 0)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
