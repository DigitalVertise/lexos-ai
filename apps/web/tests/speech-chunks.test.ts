import { describe, expect, it } from "vitest";
import { speechChunks } from "@/components/speaker";

describe("speechChunks", () => {
  it("keeps short text whole", () => {
    expect(speechChunks("Hello there.")).toEqual(["Hello there."]);
  });
  it("splits long text at sentence ends within the limit", () => {
    const text = "One sentence here. ".repeat(40);
    const chunks = speechChunks(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ").trim()).toBe(text.trim());
  });
  it("hard-splits a run-on sentence", () => {
    expect(speechChunks("a".repeat(500), 200).length).toBe(3);
  });
  it("handles Arabic question marks", () => {
    expect(speechChunks("ما هو الموعد؟ غداً.", 16).length).toBe(2);
  });
});
