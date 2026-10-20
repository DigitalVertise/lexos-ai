import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { issueState, verifyState } from "@/lib/integrations/oauth-state";

beforeAll(() => {
  process.env.INTEGRATIONS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("OAuth state", () => {
  it("accepts the same user and firm within 10 minutes", () => {
    const s = issueState("org1", "user1", 1_000);
    expect(verifyState(s, "org1", "user1", 1_000 + 9 * 60_000)).toEqual({ ok: true });
  });
  it("rejects expiry, other users and tampering", () => {
    const s = issueState("org1", "user1", 1_000);
    expect(verifyState(s, "org1", "user1", 1_000 + 11 * 60_000)).toEqual({ ok: false, reason: "expired" });
    expect(verifyState(s, "org1", "user2", 2_000)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifyState(s, "org2", "user1", 2_000)).toEqual({ ok: false, reason: "mismatch" });
    const [payload] = s.split(".");
    expect(verifyState(`${payload}.forged`, "org1", "user1", 2_000)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyState("", "org1", "user1")).toEqual({ ok: false, reason: "invalid" });
  });
});
