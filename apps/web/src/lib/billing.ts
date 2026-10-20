import "server-only";
import Stripe from "stripe";
import { env } from "./env";
import type { PlanId } from "./types";

let client: Stripe | null = null;

export function stripe(): Stripe {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured");
  client ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 });
  return client;
}

export function priceFor(plan: "basic" | "pro"): string | undefined {
  const e = env();
  return plan === "basic" ? e.STRIPE_PRICE_BASIC : e.STRIPE_PRICE_PRO;
}

/** Map a Stripe price back to our plan. Unknown prices grant nothing. */
export function planForPrice(priceId: string | undefined | null): Exclude<PlanId, "trial"> {
  const e = env();
  if (priceId && priceId === e.STRIPE_PRICE_PRO) return "pro";
  if (priceId && priceId === e.STRIPE_PRICE_BASIC) return "basic";
  return "none";
}

export interface SubscriptionUpdate {
  plan: Exclude<PlanId, "trial">;
  subscription_status: string;
  stripe_subscription_id: string;
  current_period_end: string | null;
}

/** Derive the organization's billing state from a Stripe subscription. */
export function subscriptionToUpdate(sub: Stripe.Subscription): SubscriptionUpdate {
  const item = sub.items.data[0];
  const periodEnd = (item as unknown as { current_period_end?: number })?.current_period_end
    ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  const ended = sub.status === "canceled" || sub.status === "incomplete_expired";
  return {
    plan: ended ? "none" : planForPrice(item?.price?.id),
    subscription_status: sub.status,
    stripe_subscription_id: sub.id,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
  };
}
