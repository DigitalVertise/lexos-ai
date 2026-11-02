import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifies a Standard Webhooks signature (Supabase Auth hooks). Secret format: "v1,whsec_<base64>". */
export function verifyWebhook(secret: string, id: string, timestamp: string, body: string, signatureHeader: string, now = Date.now()): boolean {
  const ts = Number(timestamp);
  if (!id || !Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  const key = Buffer.from(secret.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signatureHeader.split(" ").some((part) => {
    const [ver, sig] = part.split(",");
    if (ver !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

const COPY: Record<string, { subject: string; heading: string; body: string; cta: string }> = {
  signup: { subject: "Confirm your LexOS account", heading: "Confirm your email", body: "Welcome to LexOS AI. Confirm your email address to finish creating your account.", cta: "Confirm email" },
  recovery: { subject: "Reset your LexOS password", heading: "Reset your password", body: "We received a request to reset your password. If this wasn't you, you can ignore this email.", cta: "Choose a new password" },
  magiclink: { subject: "Your LexOS sign-in link", heading: "Sign in to LexOS", body: "Use the button below to sign in. The link expires soon and can be used once.", cta: "Sign in" },
  invite: { subject: "You've been invited to LexOS", heading: "You're invited", body: "You've been invited to join your firm's workspace on LexOS AI.", cta: "Accept invitation" },
  email_change: { subject: "Confirm your new email address", heading: "Confirm email change", body: "Confirm this address to finish changing the email on your LexOS account.", cta: "Confirm new email" },
  reauthentication: { subject: "Your LexOS verification code", heading: "Verification code", body: "Use this code to confirm it's you:", cta: "" },
};

export function buildAuthEmail(type: string, link: string, token: string) {
  const c = COPY[type] ?? COPY.magiclink;
  const action = c.cta
    ? `<p style="margin:28px 0"><a href="${link}" style="background:#1877f2;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${c.cta}</a></p><p style="color:#667085;font-size:12px">If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all">${link}</span></p>`
    : `<p style="font-size:28px;letter-spacing:6px;font-weight:700">${token}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#101828"><div style="max-width:520px;margin:32px auto;background:#fff;border-radius:16px;padding:32px"><p style="font-size:18px;font-weight:700;margin:0 0 24px">Lex<span style="color:#1877f2">OS</span> AI</p><h1 style="font-size:20px;margin:0 0 12px">${c.heading}</h1><p style="line-height:1.6;color:#344054">${c.body}</p>${action}<p style="color:#98a2b3;font-size:12px;margin-top:32px">LexOS AI · Digital Vertise. You received this because of activity on your LexOS account.</p></div></body></html>`;
  return { subject: c.subject, html };
}
