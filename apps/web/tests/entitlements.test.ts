import { describe, expect, it } from "vitest";
import { CATALOG, CUSTOM_AGENT_KEY } from "@/lib/agents/catalog";
import { canAddSeat, canHire, canRun, PER_USER_RUNS_PER_MINUTE } from "@/lib/entitlements";
import { PLANS, planState } from "@/lib/plans";

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();
const trial = planState({ plan: "trial", subscription_status: "trialing", trial_ends_at: future });
const basic = planState({ plan: "basic", subscription_status: "active", trial_ends_at: past });
const pro = planState({ plan: "pro", subscription_status: "active", trial_ends_at: past });
const expired = planState({ plan: "trial", subscription_status: "trialing", trial_ends_at: past });
const canceled = planState({ plan: "pro", subscription_status: "canceled", trial_ends_at: past });

const basicKeys = CATALOG.filter((a) => a.tier === "basic").map((a) => a.key);
const proKeys = CATALOG.filter((a) => a.tier === "pro").map((a) => a.key);

describe("plan state", () => {
  it("trial is active until it ends", () => {
    expect(trial.active && trial.plan.id).toBe("trial");
    expect(expired).toEqual({ active: false, plan: null, reason: "trial_expired" });
  });
  it("cancelled subscriptions grant nothing", () => {
    expect(canceled.active).toBe(false);
  });
  it("past_due keeps access during Stripe's retry window", () => {
    expect(planState({ plan: "basic", subscription_status: "past_due", trial_ends_at: past }).active).toBe(true);
  });
});

describe("hiring", () => {
  it("Basic can hire the 4 Basic assistants and no more", () => {
    const hires: { agent_key: string }[] = [];
    for (const key of basicKeys) {
      expect(canHire(basic, hires, key)).toEqual({ ok: true });
      hires.push({ agent_key: key });
    }
    expect(basicKeys).toHaveLength(PLANS.basic.maxCatalogAssistants);
  });
  it("Basic cannot hire Pro assistants or custom assistants", () => {
    for (const key of proKeys) expect(canHire(basic, [], key).ok).toBe(false);
    expect(canHire(basic, [], CUSTOM_AGENT_KEY).ok).toBe(false);
    expect(canHire(trial, [], proKeys[0]).ok).toBe(false);
  });
  it("Pro can hire the full catalogue and up to 5 custom assistants", () => {
    const hires = CATALOG.map((a) => ({ agent_key: a.key }));
    expect(CATALOG.every((a, i) => canHire(pro, hires.slice(0, i), a.key).ok)).toBe(true);
    const customs = Array.from({ length: PLANS.pro.maxCustomAssistants }, () => ({ agent_key: CUSTOM_AGENT_KEY }));
    expect(canHire(pro, [...hires, ...customs.slice(1)], CUSTOM_AGENT_KEY).ok).toBe(true);
    expect(canHire(pro, [...hires, ...customs], CUSTOM_AGENT_KEY).ok).toBe(false);
  });
  it("the same catalogue assistant cannot be hired twice", () => {
    expect(canHire(pro, [{ agent_key: basicKeys[0] }], basicKeys[0]).ok).toBe(false);
  });
  it("expired or inactive firms cannot hire", () => {
    expect(canHire(expired, [], basicKeys[0]).ok).toBe(false);
    expect(canHire(canceled, [], basicKeys[0]).ok).toBe(false);
  });
  it("unknown assistants are refused", () => {
    expect(canHire(pro, [], "not_a_real_agent").ok).toBe(false);
  });
});

describe("running", () => {
  it("enforces the monthly quota", () => {
    expect(canRun(basic, PLANS.basic.monthlyAssistantRuns - 1, 0).ok).toBe(true);
    expect(canRun(basic, PLANS.basic.monthlyAssistantRuns, 0).ok).toBe(false);
  });
  it("rate-limits bursts per user", () => {
    expect(canRun(pro, 0, PER_USER_RUNS_PER_MINUTE).ok).toBe(false);
  });
  it("blocks runs without an active package", () => {
    expect(canRun(expired, 0, 0).ok).toBe(false);
  });
});

describe("seats", () => {
  it("limits members per package", () => {
    expect(canAddSeat(basic, PLANS.basic.maxSeats - 1).ok).toBe(true);
    expect(canAddSeat(basic, PLANS.basic.maxSeats).ok).toBe(false);
  });
});
