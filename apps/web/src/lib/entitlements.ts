import { catalogAgent, CUSTOM_AGENT_KEY } from "./agents/catalog";
import type { PlanState } from "./plans";
import type { AgentHire } from "./types";

export type Decision = { ok: true } | { ok: false; reason: string };

const NO_PLAN: Record<string, string> = {
  trial_expired: "Your free trial has ended. Choose a package in Settings → Billing to continue.",
  inactive: "Your subscription is not active. Update billing in Settings → Billing to continue.",
};

/** Can the firm hire this assistant on its current package? */
export function canHire(state: PlanState, existing: Pick<AgentHire, "agent_key">[], agentKey: string): Decision {
  if (!state.active) return { ok: false, reason: NO_PLAN[state.reason] };
  const plan = state.plan;

  if (agentKey === CUSTOM_AGENT_KEY) {
    if (plan.maxCustomAssistants === 0) {
      return { ok: false, reason: "Custom assistants are part of the Pro package." };
    }
    const customCount = existing.filter((h) => h.agent_key === CUSTOM_AGENT_KEY).length;
    if (customCount >= plan.maxCustomAssistants) {
      return { ok: false, reason: `Your package includes up to ${plan.maxCustomAssistants} custom assistants.` };
    }
    return { ok: true };
  }

  const agent = catalogAgent(agentKey);
  if (!agent) return { ok: false, reason: "Unknown assistant." };
  if (agent.tier === "pro" && plan.tier !== "pro") {
    return { ok: false, reason: `${agent.name} is part of the Pro package.` };
  }
  if (existing.some((h) => h.agent_key === agentKey)) {
    return { ok: false, reason: `${agent.name} is already on your team.` };
  }
  const catalogCount = existing.filter((h) => h.agent_key !== CUSTOM_AGENT_KEY).length;
  if (catalogCount >= plan.maxCatalogAssistants) {
    return { ok: false, reason: `Your package includes up to ${plan.maxCatalogAssistants} assistants.` };
  }
  return { ok: true };
}

export const PER_USER_RUNS_PER_MINUTE = 6;

/** Can this user run an assistant now? Counts come from the database. */
export function canRun(state: PlanState, runsThisMonth: number, userRunsLastMinute: number): Decision {
  if (!state.active) return { ok: false, reason: NO_PLAN[state.reason] };
  if (runsThisMonth >= state.plan.monthlyAssistantRuns) {
    return { ok: false, reason: `Your firm has used all ${state.plan.monthlyAssistantRuns} assistant tasks for this month.` };
  }
  if (userRunsLastMinute >= PER_USER_RUNS_PER_MINUTE) {
    return { ok: false, reason: "Too many requests in a short time. Please wait a minute and try again." };
  }
  return { ok: true };
}

export function canAddSeat(state: PlanState, seatsUsed: number): Decision {
  if (!state.active) return { ok: false, reason: NO_PLAN[state.reason] };
  if (seatsUsed >= state.plan.maxSeats) {
    return { ok: false, reason: `Your package includes up to ${state.plan.maxSeats} team members.` };
  }
  return { ok: true };
}

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
