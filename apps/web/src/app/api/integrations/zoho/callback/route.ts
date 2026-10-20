import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, hasRole, requireWorkspace } from "@/lib/auth";
import { appUrl } from "@/lib/env";
import { verifyState } from "@/lib/integrations/oauth-state";
import { saveConnection } from "@/lib/integrations/store";
import { bigin, exchangeCode, isZohoAccountsServer, type ZohoTokens } from "@/lib/integrations/zoho";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const back = (q: string) => NextResponse.redirect(`${appUrl()}/settings?integration=${q}#integrations`);
  const p = request.nextUrl.searchParams;
  if (p.get("error")) return back("denied");

  const ws = await requireWorkspace();
  // Signed state: same user, same firm, not expired.
  const check = verifyState(p.get("state") ?? "", ws.org.id, ws.user.id);
  if (!check.ok) {
    console.warn("zoho callback state rejected", { reason: check.reason });
    return back(check.reason === "mismatch" ? "mismatch" : "expired");
  }
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
    console.error("zoho connect failed", { name: (err as Error).name, message: (err as Error).message.slice(0, 120) });
    return back("failed");
  }
}
