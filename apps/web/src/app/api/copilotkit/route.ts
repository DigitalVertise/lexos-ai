import "@/lib/copilot/no-telemetry";
import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { type NextRequest } from "next/server";
import { jsonError } from "@/lib/agents/api";
import { monthlyRuns, userRunsLastMinute } from "@/lib/agents/usage";
import { openAICompatibleClient } from "@/lib/ai/provider";
import { requireWorkspace } from "@/lib/auth";
import { canRun } from "@/lib/entitlements";
import { integrationStatus } from "@/lib/env";
import { planState } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ENDPOINT = "/api/copilotkit";

/**
 * CopilotKit runtime for the in-app workspace copilot (self-hosted, no
 * CopilotKit Cloud). Same sign-in, package check, per-user rate limit and AI
 * route as the hired assistants. The copilot only sees what the page shares
 * with it and only acts through the frontend tools the page registers.
 */
export async function POST(request: NextRequest) {
  const ws = await requireWorkspace();
  if (!integrationStatus().ai) return jsonError("The AI service is not configured yet.", 503);

  const allowed = canRun(planState(ws.org), await monthlyRuns(ws), await userRunsLastMinute(ws));
  if (!allowed.ok) return jsonError(allowed.reason, 429);

  const ai = await openAICompatibleClient();
  if (!ai) return jsonError("The AI service is not configured yet.", 503);

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    // Chat threads are scoped to the signed-in user, never shared between users or firms.
    runtime: new CopilotRuntime({ identifyUser: () => ({ id: `${ws.org.id}:${ws.user.id}`, name: ws.user.email ?? ws.user.id }) }),
    serviceAdapter: new OpenAIAdapter({ openai: ai.client, model: ai.model }),
    endpoint: ENDPOINT,
  });
  return handleRequest(request);
}
