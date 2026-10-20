import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on every request and does an
 * optimistic redirect to /login for app routes. Real authorization happens
 * on the server for every data access (lib/auth.ts + Postgres RLS).
 */
export async function proxy(request: NextRequest) {
  // One address in production: sessions, auth emails and OAuth callbacks all
  // live on NEXT_PUBLIC_APP_URL, so other hostnames (e.g. lexos-ai-two) redirect.
  const canonical = process.env.NEXT_PUBLIC_APP_URL;
  if (canonical && process.env.VERCEL_ENV === "production") {
    const target = new URL(canonical);
    if (request.nextUrl.host !== target.host) {
      const url = request.nextUrl.clone();
      url.protocol = target.protocol;
      url.host = target.host;
      url.port = "";
      return NextResponse.redirect(url, 308);
    }
  }

  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isApp = APP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  if (isApp && !data.user) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(login);
  }
  return response;
}

const APP_PREFIXES = [
  "/dashboard", "/assistants", "/clients", "/matters", "/tasks", "/settings", "/onboarding",
];

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|api/health|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
