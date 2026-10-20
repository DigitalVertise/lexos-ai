import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { aiProvider, aiRoute } from "@/lib/ai/provider";
import { integrationStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

function tokenOk(given: string | null): boolean {
  const expected = process.env.HEALTH_CHECK_TOKEN;
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Public: which integrations are configured (booleans only).
 * With the operator token (?deep=1, header x-health-token): also makes one
 * tiny AI request to prove the AI route works end to end. No user data is used.
 */
export async function GET(request: NextRequest) {
  const status = integrationStatus();
  const body: Record<string, unknown> = {
    ok: true,
    ai: status.ai ? aiRoute() : "not_configured",
    billing: status.billing ? "configured" : "not_configured",
  };
  if (request.nextUrl.searchParams.get("deep") === "1" && tokenOk(request.headers.get("x-health-token") ?? request.nextUrl.searchParams.get("token"))) {
    const started = Date.now();
    try {
      const r = await aiProvider().complete({
        system: "You are a health check. Reply with exactly: OK",
        input: "Health check",
        maxOutputTokens: 400,
      });
      body.aiCheck = { ok: /ok/i.test(r.text), model: r.model, ms: Date.now() - started, chars: r.text.length, outputTokens: r.outputTokens };
    } catch (err) {
      body.aiCheck = { ok: false, error: (err as Error).name, message: (err as Error).message.slice(0, 200) };
    }
  }
  if (request.nextUrl.searchParams.get("models") === "1" && aiRoute() === "vercel-ai-gateway"
      && tokenOk(request.headers.get("x-health-token") ?? request.nextUrl.searchParams.get("token"))) {
    try {
      const { getVercelOidcToken } = await import("@vercel/oidc");
      const key = process.env.AI_GATEWAY_API_KEY ?? (await getVercelOidcToken());
      const res = await fetch("https://ai-gateway.vercel.sh/v1/models?include_availability", {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
      });
      const json = (await res.json()) as { data?: { id: string; type?: string; model_eligibility?: { status?: string } }[] };
      body.eligibleModels = (json.data ?? [])
        .filter((m) => m.model_eligibility?.status === "eligible" && (m.type ?? "language") === "language")
        .map((m) => m.id);
    } catch (err) {
      body.eligibleModels = { error: (err as Error).name };
    }
  }
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
