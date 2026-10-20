import "server-only";
import OpenAI from "openai";
import { env } from "@/lib/env";

export interface CompletionRequest {
  system: string;
  input: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AIProvider {
  readonly name: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export class AIUnavailableError extends Error {
  constructor() {
    super("AI provider is not configured");
  }
}

class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey: string, private model: string) {
    this.client = new OpenAI({ apiKey, timeout: 120_000, maxRetries: 1 });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const response = await this.client.responses.create(
      {
        model: this.model,
        instructions: req.system,
        input: req.input,
        max_output_tokens: req.maxOutputTokens,
        // Do not let OpenAI keep this conversation for later retrieval.
        store: false,
      },
      { signal: req.signal },
    );
    return {
      text: response.output_text ?? "",
      model: response.model ?? this.model,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
    };
  }
}

let override: AIProvider | null = null;

/** Tests inject a fake provider here. */
export function setProviderForTests(p: AIProvider | null) {
  override = p;
}

export function aiProvider(): AIProvider {
  if (override) return override;
  const e = env();
  if (!e.OPENAI_API_KEY) throw new AIUnavailableError();
  return new OpenAIProvider(e.OPENAI_API_KEY, e.OPENAI_MODEL);
}
