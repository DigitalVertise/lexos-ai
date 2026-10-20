import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { appUrl } from "@/lib/env";
import { saveConnection } from "@/lib/integrations/store";
import { bigin, exchangeCode, isZohoAccountsServer, type ZohoTokens } from "@/lib/integrations/zoho";

export const dynamic = "force-dynamic";
const STATE_COOKIE = "lexos_zoho_state";

function same(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: NextRequest) {
  const back = (q: string) => {
    const res = NextResponse.redirect(`${appUrl()}/settings?integration=${q}#integrations`);
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/integrations/zoho" });
    return res;
  };
  const p = request.nextUrl.searchParams;
  if (p.get("error")) return back("denied");

  const ws = await requireWorkspace();
  const [nonce, orgId, userId] = (request.cookies.get(STATE_COOKIE)?.value ?? "").split(".");
  const state = p.get("state") ?? "";
  // State must match, and the same user must still be an admin of the same firm.
  if (!nonce || !state || !same(nonce, state) || orgId !== ws.org.id || userId !== ws.user.id) return back("expired");
  if (!hasRole(ws, ADMIN_ROLES)) return back("forbidden");

  const code = p.get("code");
  const accountsServer = p.get("accounts-server") ?? "https://accounts.zoho.com";
  if (!code || !isZohoAccountsServer(accountsServer)) return back("failed");

  try {
    const { tokens, apiDomain } = await exchangeCode(code, accountsServer, `${appUrl()}/api/integrations/zoho/callback`);
    let label = "Zoho Bigin";
    let saveTokens: ZohoTokens = tokens;
    try {
      const org = await bigin<{ org?: { company_name?: string }[] }>({ tokens, apiDomain }, "org");
      label = org.data.org?.[0]?.company_name || label;
      saveTokens = org.tokens;
    } catch { /* label is cosmetic */ }
    const ok = await saveConnection(ws.supabase, ws.org.id, "zoho_bigin", saveTokens, label, apiDomain);
    if (!ok) return back("failed");
    await audit(ws, "integration.connected", undefined, { provider: "zoho_bigin" });
    return back("connected");
  } catch (err) {
    console.error("zoho connect failed", { name: (err as Error).name });
    return back("failed");
  }
}
