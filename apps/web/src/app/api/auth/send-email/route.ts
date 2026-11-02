import { type NextRequest } from "next/server";
import { buildAuthEmail, verifyWebhook } from "@/lib/auth-email";

/**
 * Supabase "Send Email" auth hook: Supabase calls this instead of its built-in
 * mailer, and we deliver through Brevo's transactional API (no hourly cap).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET;
  const apiKey = process.env.BREVO_API_KEY;
  const sender = process.env.AUTH_EMAIL_FROM || "no-reply@digitalvertise.com";
  if (!secret || !apiKey) return hookError(500, "Email hook not configured");

  const body = await request.text();
  const ok = verifyWebhook(secret, request.headers.get("webhook-id") ?? "", request.headers.get("webhook-timestamp") ?? "",
    body, request.headers.get("webhook-signature") ?? "");
  if (!ok) return hookError(401, "Invalid signature");

  const payload = JSON.parse(body) as {
    user: { email: string; new_email?: string };
    email_data: { token: string; token_hash: string; redirect_to: string; email_action_type: string; site_url: string; token_hash_new?: string; token_new?: string };
  };
  const d = payload.email_data;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const linkFor = (hash: string) =>
    `${base}/auth/v1/verify?token=${encodeURIComponent(hash)}&type=${encodeURIComponent(d.email_action_type)}&redirect_to=${encodeURIComponent(d.redirect_to || d.site_url)}`;

  const sends: { to: string; hash: string; token: string }[] = [{ to: payload.user.email, hash: d.token_hash, token: d.token }];
  if (d.email_action_type === "email_change" && payload.user.new_email && d.token_hash_new) {
    sends.push({ to: payload.user.new_email, hash: d.token_hash_new, token: d.token_new ?? "" });
  }

  for (const s of sends) {
    const { subject, html } = buildAuthEmail(d.email_action_type, linkFor(s.hash), s.token);
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { name: "LexOS AI", email: sender }, to: [{ email: s.to }], subject, htmlContent: html, tags: ["auth", d.email_action_type] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      console.error("brevo send failed", { status: res.status, type: d.email_action_type, detail });
      return hookError(502, "Email delivery failed");
    }
  }
  return Response.json({});
}

function hookError(status: number, message: string) {
  return Response.json({ error: { http_code: status, message } }, { status });
}
