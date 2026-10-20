import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { hasEncryptionKey } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { issueState } from "@/lib/integrations/oauth-state";
import { authorizeUrl, zohoConfigured } from "@/lib/integrations/zoho";

export const dynamic = "force-dynamic";

/** Owner/admin starts the Zoho consent screen. State is signed and bound to user + firm. */
export async function GET(request: NextRequest) {
  // Zoho returns to the canonical address; start there so the session matches.
  const canonical = new URL(appUrl());
  if (request.nextUrl.host !== canonical.host && process.env.VERCEL_ENV === "production") {
    return NextResponse.redirect(new URL("/api/integrations/zoho/start", canonical));
  }
  const ws = await requireWorkspace();
  const back = (q: string) => NextResponse.redirect(`${appUrl()}/settings?integration=${q}#integrations`);
  if (!hasRole(ws, ADMIN_ROLES)) return back("forbidden");
  if (!zohoConfigured() || !hasEncryptionKey()) return back("unavailable");
  return NextResponse.redirect(authorizeUrl(`${appUrl()}/api/integrations/zoho/callback`, issueState(ws.org.id, ws.user.id)));
}
