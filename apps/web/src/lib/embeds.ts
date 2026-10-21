/**
 * Companion apps embedded in LexOS. Override per deployment with env vars,
 * e.g. when the apps move to workspace.digitalvertise.com / chat.digitalvertise.com.
 */
export const WORKSPACE_URL = process.env.NEXT_PUBLIC_WORKSPACE_URL || "https://savvy-motion-sync-flow.base44.app";
export const LIVECHAT_URL = process.env.NEXT_PUBLIC_LIVECHAT_URL || "https://dv-livechat.base44.app";

export function originOf(url: string): string {
  try { return new URL(url).origin; } catch { return ""; }
}
