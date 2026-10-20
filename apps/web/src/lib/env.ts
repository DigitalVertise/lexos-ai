import "server-only";
import { z } from "zod";

/**
 * Server configuration. Optional integrations are allowed to be missing; the
 * UI then shows a truthful "Not configured" state instead of failing.
 */
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  OPENAI_API_KEY: z.string().min(10).optional(),
  // Cost-efficient default; override with e.g. gpt-6.1-sol for higher quality.
  OPENAI_MODEL: z.string().default("gpt-5.4-mini"),

  STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  STRIPE_PRICE_BASIC: z.string().startsWith("price_").optional(),
  STRIPE_PRICE_PRO: z.string().startsWith("price_").optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  // Treat empty strings as unset.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  // Vercel's Supabase integration names the public key differently; accept both.
  raw.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= raw.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server configuration: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

export function appUrl(): string {
  const e = env();
  if (e.NEXT_PUBLIC_APP_URL) return e.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

export const integrationStatus = () => {
  const e = env();
  return {
    // Direct OpenAI key, or Vercel AI Gateway (OIDC) when running on Vercel.
    ai: Boolean(e.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL === "1"),
    billing: Boolean(e.STRIPE_SECRET_KEY && e.STRIPE_WEBHOOK_SECRET && e.STRIPE_PRICE_BASIC && e.STRIPE_PRICE_PRO),
    serviceRole: Boolean(e.SUPABASE_SERVICE_ROLE_KEY),
  };
};
