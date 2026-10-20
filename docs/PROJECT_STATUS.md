# Project status — 20 October 2026

## Baseline found before this release

- GitHub `DigitalVertise/lexos-ai` contained only README, LICENSE and .gitignore (plus the WhatsApp service added earlier the same day, commit `9ad0f04`).
- The live Vercel site was a prototype uploaded directly with the CLI (6 source files: one dashboard page with browser-only state). Its source was never in GitHub. It remains available as a rollback candidate (deployment `dpl_CGuwFJv5TAsY2uo2NSX1mY95i5Zz`).
- Every GitHub-triggered Vercel build had failed because the repository had no web app.
- No environment variables were configured in Vercel.

## Release 1 (commit `b8df459`)

| Area | Status | Evidence |
|---|---|---|
| Next.js 16.4.2 app, strict TypeScript | ✅ Pass | `tsc --noEmit` clean; production build succeeds locally and on Vercel |
| Lint | ✅ Pass | `eslint src tests`: 0 errors |
| Unit tests | ✅ Pass | 28/28 (entitlements, prompts and injection fencing, task parsing, dates, storage paths, billing mapping) |
| WhatsApp service tests | ✅ Pass | 24/24 pytest |
| Auth (sign up, sign in, reset, sign out) | ⚠️ Built, live flow not yet tested | Needs Supabase Site URL set (INTEGRATIONS.md §1) before email links work |
| Protected routes | ✅ Pass | Live preview: `/dashboard` while signed out → `/login?next=/dashboard` |
| Firms, roles, invitations | ⚠️ Built, not tested live | |
| Tenant isolation (RLS) | ⚠️ Implemented; DB test prepared, **not yet run** | `supabase/tests/tenant_isolation.sql` — run attempt was not approved; Supabase security advisor: no errors (2 informational notes on intentionally closed server-only tables) |
| AI Team (hire by package, run, outputs, task creation) | ✅ AI route live (no key needed) | Runs through Vercel AI Gateway with the deployment's OIDC token, model `openai/gpt-5-mini` (free-tier eligible). Verified with `/api/health?deep=1`. Adding `OPENAI_API_KEY` later switches to the firm's own OpenAI account. |
| Clients, matters, tasks, documents | ⚠️ Built, not tested live | |
| Stripe billing (sandbox) | ⚠️ Stripe side configured; blocked on 2 keys | Created in the Digital Vertise sandbox: products LexOS Basic $299/mo (`price_1USahu9ahWn3qMGgp0DSrKlu`) and Pro $699/mo (`price_1USahz9ahWn3qMGgcuL8mDcX`), webhook `we_1USaiD9ahWn3qMGgExZxv8P5` (5 events), default Billing Portal config. Vercel has `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO`. Still needs `STRIPE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (no API can create these). |
| Zoho Bigin | ❌ Not built (next release) | Shown as "Not available yet" in the app |
| Notion | ❌ Not built (later); Notion pages can be linked to matters | |
| Audit log | ✅ Built | Sensitive actions write `audit_events` (identifiers only) |
| Security headers | ✅ Pass | Live: HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy |
| Dependency audit | ⚠️ 3 moderate, 0 high | `mammoth` → `argparse` (server-side DOCX parsing; not exposed to user input paths beyond file text) |
| CI | ✅ Added | `.github/workflows/ci.yml` — first run on this push |
| Vercel deployment | See below | |

## Deployment

- Vercel project `lexos-ai`: root directory `apps/web`, Node 24, functions in `fra1` (closest to the Supabase region).
- Production URL: https://lexos-ai-digitalvertises-projects.vercel.app (public). Preview and per-deployment URLs require Vercel login.
- Preview of `b8df459` verified READY; promoted by pushing to `main`.
- Production deployment `dpl_JCetCRVegyjHPGA2SLDLgfwHLQGw` (commit `b8df459`): READY. Verified publicly (no login wall): landing page with packages, `/signup` form, `/dashboard` redirects signed-out users to `/login`. Also reachable at https://lexos-ai-two.vercel.app.
- **Rollback**: Vercel → Deployments → choose an earlier production deployment → *Promote to Production*. Database migrations are additive, so rolling back the app does not require a database rollback.

## Required actions (owner)

1. **Supabase → Authentication → URL Configuration**: set Site URL and redirect URL (INTEGRATIONS.md §1). *Without this, sign-up confirmation emails will not work.*
2. **Vercel → Environment Variables** (Sensitive, Production + Preview), then redeploy:
   - `STRIPE_SECRET_KEY` = Stripe sandbox → Developers → API keys → Secret key (`sk_test_…`).
   - `SUPABASE_SERVICE_ROLE_KEY` = Supabase → Project Settings → API keys → service_role / secret key.
3. Before charging real firms: repeat the Stripe setup in live mode (new prices + webhook) and swap the four Stripe variables.
4. Optional: `OPENAI_API_KEY` to bill AI to your own OpenAI account instead of Vercel AI credits.
5. Run `supabase/tests/tenant_isolation.sql` in the Supabase SQL editor; expect `TENANT_ISOLATION_OK`.
6. For Bigin: create the Zoho server-based app (INTEGRATIONS.md §4).

## Known gaps and risks before onboarding paying firms

- Supabase built-in email is rate-limited: configure custom SMTP.
- No MFA yet; no Content-Security-Policy header yet; uploads are not virus-scanned.
- Scanned (image-only) PDFs are not readable by the assistants (no OCR yet).
- Assistant runs are synchronous (up to ~1 minute); no streaming or cancel button yet.
- Seat limits count pending invitations; removing a member is immediate but does not revoke an active browser session until it refreshes (≤1 hour).
- No formal legal/compliance review (UAE PDPL, DIFC/ADGM data protection) has been performed; the product makes no compliance claims.
- End-to-end browser tests (Playwright) are not yet written; the core journey has not been exercised against the live database from this environment because outbound access to Supabase was blocked here.

## Next release

1. Zoho Bigin OAuth + client sync (encrypted token storage table already exists).
2. Streaming assistant responses with cancel.
3. Playwright end-to-end tests in CI against a Supabase branch.
4. Notion OAuth knowledge connection.
5. Move the WhatsApp service onto the same Supabase database.
