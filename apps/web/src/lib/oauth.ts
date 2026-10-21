import "server-only";
import { env } from "./env";

export type OAuthProvider = "google" | "apple";
export const OAUTH_PROVIDERS: readonly OAuthProvider[] = ["google", "apple"];

/**
 * Which social providers are switched on in Supabase Auth. Read from the
 * public /auth/v1/settings endpoint so a button only appears once the
 * provider is actually configured (never a dead button). Cached 5 minutes.
 */
export async function enabledOAuthProviders(): Promise<OAuthProvider[]> {
  const e = env();
  try {
    const res = await fetch(`${e.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { external?: Record<string, boolean> };
    return OAUTH_PROVIDERS.filter((p) => json.external?.[p] === true);
  } catch {
    return [];
  }
}
