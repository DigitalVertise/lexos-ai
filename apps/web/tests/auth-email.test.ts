import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAuthEmail, verifyWebhook } from "../src/lib/auth-email";

const secretB64 = Buffer.from("super-secret-key-material-123456").toString("base64");
const secret = `v1,whsec_${secretB64}`;
function sign(id: string, ts: string, body: string) {
  return "v1," + createHmac("sha256", Buffer.from(secretB64, "base64")).update(`${id}.${ts}.${body}`).digest("base64");
}

describe("verifyWebhook", () => {
  const ts = String(Math.floor(Date.now() / 1000));
  it("accepts a valid signature", () => {
    expect(verifyWebhook(secret, "msg_1", ts, "{}", sign("msg_1", ts, "{}"))).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyWebhook(secret, "msg_1", ts, '{"x":1}', sign("msg_1", ts, "{}"))).toBe(false);
  });
  it("rejects an old timestamp", () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(verifyWebhook(secret, "msg_1", old, "{}", sign("msg_1", old, "{}"))).toBe(false);
  });
});

describe("buildAuthEmail", () => {
  it("includes the link for recovery", () => {
    const e = buildAuthEmail("recovery", "https://x.test/verify?t=1", "123456");
    expect(e.subject).toMatch(/Reset/);
    expect(e.html).toContain("https://x.test/verify?t=1");
  });
});
