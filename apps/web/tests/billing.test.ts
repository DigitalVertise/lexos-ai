import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_key_123456";
  process.env.STRIPE_SECRET_KEY = "sk_test_123";
  process.env.STRIPE_PRICE_BASIC = "price_basic";
  process.env.STRIPE_PRICE_PRO = "price_pro";
});

function sub(status: Stripe.Subscription.Status, price: string): Stripe.Subscription {
  return {
    id: "sub_1", status, customer: "cus_1", metadata: { org_id: "org" },
    items: { data: [{ price: { id: price }, current_period_end: 1_800_000_000 }] },
  } as unknown as Stripe.Subscription;
}

describe("billing mapping", () => {
  it("maps configured prices to plans and unknown prices to nothing", async () => {
    const { planForPrice } = await import("@/lib/billing");
    expect(planForPrice("price_basic")).toBe("basic");
    expect(planForPrice("price_pro")).toBe("pro");
    expect(planForPrice("price_other")).toBe("none");
    expect(planForPrice(null)).toBe("none");
  });
  it("derives org billing state from a subscription", async () => {
    const { subscriptionToUpdate } = await import("@/lib/billing");
    expect(subscriptionToUpdate(sub("active", "price_pro"))).toEqual({
      plan: "pro", subscription_status: "active", stripe_subscription_id: "sub_1",
      current_period_end: new Date(1_800_000_000 * 1000).toISOString(),
    });
    expect(subscriptionToUpdate(sub("canceled", "price_pro")).plan).toBe("none");
  });
});
