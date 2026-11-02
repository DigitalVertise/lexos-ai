/**
 * Companion apps embedded in LexOS. Override per deployment with env vars,
 * e.g. when the workspace moves to workspace.digitalvertise.com.
 */
export const WORKSPACE_URL = process.env.NEXT_PUBLIC_WORKSPACE_URL || "https://savvy-motion-sync-flow.base44.app";

export function originOf(url: string): string {
  try { return new URL(url).origin; } catch { return ""; }
}
