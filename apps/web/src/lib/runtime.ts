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

/** Free hosting may be waking up (502/503/504): retry a few times before giving up. */
const WAKING = new Set([502, 503, 504]);

export async function runtimeFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const e = env();
  if (!e.AGENT_RUNTIME_URL || !e.AGENT_RUNTIME_SECRET) throw new RuntimeError("Agent runtime not configured", 503);
  const url = new URL(path.replace(/^\//, ""), e.AGENT_RUNTIME_URL.endsWith("/") ? e.AGENT_RUNTIME_URL : `${e.AGENT_RUNTIME_URL}/`);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${e.AGENT_RUNTIME_SECRET}`);
  const deadline = Date.now() + (init.timeoutMs ?? 60_000);
  const retryable = !(init.body instanceof ReadableStream);
  for (let attempt = 0; ; attempt++) {
    const remaining = Math.max(1_000, deadline - Date.now());
    const res = await fetch(url, { ...init, headers, cache: "no-store", signal: init.signal ?? AbortSignal.timeout(remaining) });
    if (res.ok) return res;
    if (retryable && WAKING.has(res.status) && attempt < 4 && deadline - Date.now() > 12_000) {
      await new Promise((r) => setTimeout(r, 8_000));
      continue;
    }
    let detail = "";
    try { detail = ((await res.json()) as { detail?: string }).detail ?? ""; } catch { /* ignore */ }
    throw new RuntimeError(typeof detail === "string" && detail ? detail : `Agent runtime error ${res.status}`, res.status);
  }
}
