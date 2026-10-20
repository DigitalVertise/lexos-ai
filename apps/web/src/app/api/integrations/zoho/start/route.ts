import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { ADMIN_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { hasEncryptionKey } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { authorizeUrl, zohoConfigured } from "@/lib/integrations/zoho";

export const dynamic = "force-dynamic";
const ZOHO_STATE_COOKIE = "lexos_zoho_state";

/** Owner/admin starts the Zoho consent screen. State is bound to user + firm. */
export async function GET() {
  const ws = await requireWorkspace();
  const back = (q: string) => NextResponse.redirect(`${appUrl()}/settings?integration=${q}#integrations`);
  if (!hasRole(ws, ADMIN_ROLES)) return back("forbidden");
  if (!zohoConfigured() || !hasEncryptionKey()) return back("unavailable");

  const nonce = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl(`${appUrl()}/api/integrations/zoho/callback`, nonce));
  res.cookies.set(ZOHO_STATE_COOKIE, `${nonce}.${ws.org.id}.${ws.user.id}`, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/api/integrations/zoho", maxAge: 600,
  });
  return res;
}
