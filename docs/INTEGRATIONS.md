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

## 4. Zoho Bigin

Each firm connects its own Bigin account (Settings → Integrations → **Connect Bigin**, owners/admins). LexOS asks Zoho only for contacts, companies and the organisation name (`ZohoBigin.modules.contacts.ALL,ZohoBigin.modules.accounts.ALL,ZohoBigin.org.READ`).

What it does:
- **Send to Bigin / Update in Bigin** on a client: individuals become Contacts, companies become Companies (Accounts). The Bigin record ID is stored on the client so later syncs update the same record.
- **Import from Bigin** on Clients: brings in up to 1,000 Bigin contacts that are not already linked.
- Refresh tokens are stored AES-256-GCM encrypted (`INTEGRATIONS_ENCRYPTION_KEY`, bound to the firm), read only through role-checked database functions (migration 0005). Disconnecting revokes the token at Zoho.

One-time setup by Digital Vertise (works from a phone browser):
1. Open https://api-console.zoho.com → **Add Client** → **Server-based Applications**.
2. Name `LexOS AI`, homepage `https://lexos-ai-digitalvertises-projects.vercel.app`, redirect URI `https://lexos-ai-digitalvertises-projects.vercel.app/api/integrations/zoho/callback`.
3. Settings tab of the client → enable **Multi-DC** so firms on other Zoho data centres (EU, IN, SA…) can connect.
4. Add `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` (Sensitive) in Vercel → redeploy.

## 5. Notion

Each firm connects its own Notion workspace with an **internal integration** — no LexOS-wide Notion app is needed:
1. Firm admin opens https://www.notion.so/profile/integrations → **New integration** → Internal, name `LexOS`, copy the secret (`ntn_…`).
2. LexOS → Settings → Integrations → Connect Notion → paste the secret.
3. In Notion, share pages/teamspaces with the integration (••• → Connections → LexOS).

Then on any matter: **Attach a Notion page**. Assistants read attached Notion pages (headings, lists, to-dos, tables; two levels of nesting) as context, within the same per-run document limits.

## Recovery

| Symptom | Fix |
|---|---|
| Sign-up email link goes to localhost | Step 1.1 |
| "AI service is not configured" | Add `OPENAI_API_KEY`, redeploy |
| Choose-package buttons disabled | Add all Stripe variables + service role key, redeploy |
| Paid but package unchanged | Stripe → Webhooks → the endpoint → check failed deliveries; fix and **Resend** |
| "LexOS cannot see this page" (Notion) | In Notion: page → ••• → Connections → add the LexOS integration |
| Bigin shows "Needs attention" | Settings → Integrations → Reconnect Bigin (token revoked or expired) |
| Rotate a secret | Replace the Vercel variable and redeploy; for Stripe, roll the webhook secret in Stripe first |
