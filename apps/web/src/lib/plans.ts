import type { Organization, PlanId } from "./types";

/**
 * Packages. Prices come from Stripe (STRIPE_PRICE_BASIC / STRIPE_PRICE_PRO);
 * the amounts here are only for display and must match the Stripe prices.
 * Limits are enforced on the server in lib/entitlements.ts.
 */
export interface Plan {
  id: Exclude<PlanId, "none">;
  name: string;
  priceUsdMonthly: number | null;
  tier: "basic" | "pro";
  maxCatalogAssistants: number;
  maxCustomAssistants: number;
  maxSeats: number;
  monthlyAssistantRuns: number;
  blurb: string;
}

export const PLANS: Record<Plan["id"], Plan> = {
  trial: {
    id: "trial",
    name: "Free trial",
    priceUsdMonthly: null,
    tier: "basic",
    maxCatalogAssistants: 4,
    maxCustomAssistants: 0,
    maxSeats: 3,
    monthlyAssistantRuns: 50,
    blurb: "14 days of the Basic package, no card required.",
  },
  basic: {
    id: "basic",
    name: "Basic",
    priceUsdMonthly: 299,
    tier: "basic",
    maxCatalogAssistants: 4,
    maxCustomAssistants: 0,
    maxSeats: 5,
    monthlyAssistantRuns: 400,
    blurb: "Your first AI legal team: intake, drafting, client communications and billing.",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsdMonthly: 699,
    tier: "pro",
    maxCatalogAssistants: 8,
    maxCustomAssistants: 5,
    maxSeats: 25,
    monthlyAssistantRuns: 2000,
    blurb: "The full AI team plus custom assistants trained on your firm's way of working.",
  },
};

export type PlanState =
  | { active: true; plan: Plan; reason: "trial" | "subscription" }
  | { active: false; plan: null; reason: "trial_expired" | "inactive" };

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Decide the effective plan of an organization at a point in time. */
export function planState(org: Pick<Organization, "plan" | "subscription_status" | "trial_ends_at">, now = new Date()): PlanState {
  if (org.plan === "basic" || org.plan === "pro") {
    if (ACTIVE_STATUSES.has(org.subscription_status)) {
      return { active: true, plan: PLANS[org.plan], reason: "subscription" };
    }
    return { active: false, plan: null, reason: "inactive" };
  }
  if (org.plan === "trial") {
    if (new Date(org.trial_ends_at) > now) return { active: true, plan: PLANS.trial, reason: "trial" };
    return { active: false, plan: null, reason: "trial_expired" };
  }
  return { active: false, plan: null, reason: "inactive" };
}
