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

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1";

/**
 * Two interchangeable routes to the same Responses API:
 * - OpenAI directly, when OPENAI_API_KEY is set (the firm's own OpenAI account);
 * - Vercel AI Gateway otherwise, authenticated by the deployment's OIDC
 *   token — no API key to store. Billed to the Vercel team's AI credits.
 */
class ResponsesProvider implements AIProvider {
  constructor(
    readonly name: "openai" | "vercel-ai-gateway",
    private model: string,
    private getKey: () => Promise<string>,
    private baseURL?: string,
  ) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const client = new OpenAI({ apiKey: await this.getKey(), baseURL: this.baseURL, timeout: 120_000, maxRetries: 1 });
    const response = await client.responses.create(
      {
        model: this.model,
        instructions: req.system,
        input: req.input,
        max_output_tokens: req.maxOutputTokens,
        // Ask the provider not to retain the conversation for later retrieval.
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

export function aiRoute(): "openai" | "vercel-ai-gateway" | null {
  const e = env();
  if (e.OPENAI_API_KEY) return "openai";
  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL === "1") return "vercel-ai-gateway";
  return null;
}

export function aiProvider(): AIProvider {
  if (override) return override;
  const e = env();
  const route = aiRoute();
  if (route === "openai") {
    const key = e.OPENAI_API_KEY!;
    return new ResponsesProvider("openai", e.OPENAI_MODEL, async () => key);
  }
  if (route === "vercel-ai-gateway") {
    const model = e.OPENAI_MODEL.includes("/") ? e.OPENAI_MODEL : `openai/${e.OPENAI_MODEL}`;
    return new ResponsesProvider("vercel-ai-gateway", model, async () => {
      if (process.env.AI_GATEWAY_API_KEY) return process.env.AI_GATEWAY_API_KEY;
      const { getVercelOidcToken } = await import("@vercel/oidc");
      return getVercelOidcToken();
    }, GATEWAY_URL);
  }
  throw new AIUnavailableError();
}
