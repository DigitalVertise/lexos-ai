# Integrations setup

All values go in **Vercel → lexos-ai → Settings → Environment Variables** (Production and Preview), then **Redeploy**. Everything can be done from a phone browser. Never paste secrets into the repository or a chat.

## 1. Supabase (required — already created)

Project `lexos-ai` (region eu-central-1). Public URL and publishable key are already set in Vercel.

Two one-time steps in the Supabase dashboard:

1. **Authentication → URL Configuration**
   - Site URL: `https://lexos-ai-digitalvertises-projects.vercel.app`
   - Redirect URLs: add `https://lexos-ai-digitalvertises-projects.vercel.app/**`
   Without this, confirmation and password-reset emails point to `localhost`.
2. **Service role key** (needed for Stripe billing): either
   - Vercel → **Storage** → the Supabase store → **Connect Project** → `lexos-ai` (adds the variables automatically; keep the existing `NEXT_PUBLIC_*` values), or
   - Supabase → Project Settings → API Keys → copy the **secret/service_role** key → Vercel variable `SUPABASE_SERVICE_ROLE_KEY` (type: Sensitive).

**Email**: Supabase's built-in sender is rate-limited and meant for testing. Before onboarding many firms, set custom SMTP (Authentication → Emails → SMTP), e.g. Brevo or Postmark.

**Tested**: schema applied, security advisors reviewed. Tenant-isolation SQL test (`supabase/tests/tenant_isolation.sql`) prepared; run it in the Supabase SQL editor — the expected result is the error message `TENANT_ISOLATION_OK` (the test always rolls back).

## 2. OpenAI (required for AI assistants)

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | from platform.openai.com → API keys (type: Sensitive) |
| `OPENAI_MODEL` | optional; default `gpt-5-mini`. For higher quality try `gpt-6.1-sol` (check the exact ID on OpenAI's models page). |

Requests use the Responses API with `store: false`. Until the key is set, the app shows "AI service not configured" and disables assistant runs — it never fakes answers.

## 3. Stripe (required for paid packages)

1. Stripe → **Products** → create "LexOS Basic" ($299/month, recurring) and "LexOS Pro" ($699/month). Copy each **price ID** (`price_…`).
2. Stripe → **Developers → Webhooks → Add endpoint**
   - URL: `https://lexos-ai-digitalvertises-projects.vercel.app/api/stripe/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
   - Copy the signing secret (`whsec_…`).
3. Stripe → **Settings → Billing → Customer portal**: enable it (cancel, update payment method, invoices).
4. Vercel variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO` (+ `SUPABASE_SERVICE_ROLE_KEY` from step 1).

Test with Stripe test-mode keys first (card `4242 4242 4242 4242`). Expected: after checkout, Settings shows the new package within seconds; replaying the same webhook from Stripe changes nothing.

**Manual activation** (sales-led deals, no Stripe): in the Supabase SQL editor
`update organizations set plan = 'pro', subscription_status = 'active' where name = 'Firm name';`

## 4. Zoho Bigin (next release)

Not connected yet. Needed from you: a Zoho **Server-based application** at api-console.zoho.com with redirect URI `https://lexos-ai-digitalvertises-projects.vercel.app/api/integrations/zoho/callback`, scopes `ZohoBigin.modules.ALL,ZohoBigin.settings.ALL`, then `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` and your data centre (`com`, `eu`, …). The database already has the client mapping columns and an encrypted, server-only token table.

## 5. Notion (later release)

Today: Notion pages can be attached to matters with **Link a document**. Full connection (OAuth, page picker, sync) is planned; it needs a Notion **public integration** with redirect URI `…/api/integrations/notion/callback`.

## Recovery

| Symptom | Fix |
|---|---|
| Sign-up email link goes to localhost | Step 1.1 |
| "AI service is not configured" | Add `OPENAI_API_KEY`, redeploy |
| Choose-package buttons disabled | Add all Stripe variables + service role key, redeploy |
| Paid but package unchanged | Stripe → Webhooks → the endpoint → check failed deliveries; fix and **Resend** |
| Rotate a secret | Replace the Vercel variable and redeploy; for Stripe, roll the webhook secret in Stripe first |
