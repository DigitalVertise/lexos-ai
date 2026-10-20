import { describe, expect, it } from "vitest";
import { isReasoningModel } from "@/lib/ai/provider";

describe("isReasoningModel", () => {
  it("detects OpenAI reasoning families with or without gateway prefix", () => {
    expect(isReasoningModel("gpt-5-mini")).toBe(true);
    expect(isReasoningModel("openai/gpt-5-mini")).toBe(true);
    expect(isReasoningModel("openai/o4-mini")).toBe(true);
  });
  it("leaves non-reasoning models alone", () => {
    expect(isReasoningModel("openai/gpt-4.1-mini")).toBe(false);
    expect(isReasoningModel("openai/gpt-5-chat")).toBe(false);
    expect(isReasoningModel("google/gemini-2.5-flash")).toBe(false);
  });
});
