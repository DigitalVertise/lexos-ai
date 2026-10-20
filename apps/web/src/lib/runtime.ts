import "server-only";
import { env } from "./env";

/**
 * Client for the FastAPI agent runtime (apps/api). Server-to-server only; the
 * shared secret never reaches the browser. When the runtime is not configured
 * (or is waking up on a free host), callers fall back to the built-in paths.
 */
export function runtimeConfigured(): boolean {
  const e = env();
  return Boolean(e.AGENT_RUNTIME_URL && e.AGENT_RUNTIME_SECRET);
}

export class RuntimeError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export async function runtimeFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const e = env();
  if (!e.AGENT_RUNTIME_URL || !e.AGENT_RUNTIME_SECRET) throw new RuntimeError("Agent runtime not configured", 503);
  const url = new URL(path.replace(/^\//, ""), e.AGENT_RUNTIME_URL.endsWith("/") ? e.AGENT_RUNTIME_URL : `${e.AGENT_RUNTIME_URL}/`);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${e.AGENT_RUNTIME_SECRET}`);
  const res = await fetch(url, { ...init, headers, cache: "no-store", signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? 60_000) });
  if (!res.ok) {
    let detail = "";
    try { detail = ((await res.json()) as { detail?: string }).detail ?? ""; } catch { /* ignore */ }
    throw new RuntimeError(typeof detail === "string" && detail ? detail : `Agent runtime error ${res.status}`, res.status);
  }
  return res;
}
