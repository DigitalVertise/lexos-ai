import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed, self-contained OAuth `state` (no cookie needed, so it survives
 * in-app browsers and a different hostname on the way back).
 *
 * Format: base64url(json{o,u,e,n}).base64url(hmac-sha256)
 * Bound to the user and firm that started the flow, expires in 10 minutes.
 * A state issued to someone else is rejected because the callback compares
 * it with the signed-in user (prevents login-CSRF / code injection).
 */
const TTL_MS = 10 * 60 * 1000;

function secret(): Buffer {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (!raw) throw new Error("INTEGRATIONS_ENCRYPTION_KEY is not configured");
  // Derive a separate key for signing so the encryption key is never used twice.
  return createHmac("sha256", Buffer.from(raw, "base64")).update("lexos-oauth-state-v1").digest();
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function issueState(orgId: string, userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ o: orgId, u: userId, e: now + TTL_MS, n: randomBytes(12).toString("base64url") }))
    .toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export type StateCheck = { ok: true } | { ok: false; reason: "invalid" | "expired" | "mismatch" };

export function verifyState(state: string, orgId: string, userId: string, now = Date.now()): StateCheck {
  const [payload, mac] = state.split(".");
  if (!payload || !mac) return { ok: false, reason: "invalid" };
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };
  let data: { o?: string; u?: string; e?: number };
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return { ok: false, reason: "invalid" }; }
  if (typeof data.e !== "number" || data.e < now) return { ok: false, reason: "expired" };
  if (data.o !== orgId || data.u !== userId) return { ok: false, reason: "mismatch" };
  return { ok: true };
}
