export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: string[], public body?: Record<string, unknown> | null) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new ApiError("Network error: could not reach the server. Check your connection and try again.", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, body?.details, body);
  return body as T;
}

export const jsonInit = (method: string, data?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: data === undefined ? undefined : JSON.stringify(data),
});
