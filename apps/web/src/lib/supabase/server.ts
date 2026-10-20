import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Supabase client acting as the signed-in user. All reads and writes go
 * through Postgres row-level security, so a user can only ever touch rows of
 * organizations they belong to — even if application code has a bug.
 */
export async function supabaseServer(): Promise<SupabaseClient> {
  const e = env();
  const cookieStore = await cookies();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there. The
          // proxy refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Service-role client: bypasses RLS. Use ONLY for server-owned tables
 * (stripe_events, integration_connections) and billing updates, after the
 * caller has been authorized by other means (e.g. a verified webhook).
 */
export function supabaseAdmin(): SupabaseClient {
  const e = env();
  if (!e.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return createAdminClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
