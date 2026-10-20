# WhatsApp service (apps/api)

The WhatsApp intake agent and team commands run as a separate Python service.
It is optional and independent of the web app. Its design decisions (ADR-001 to ADR-007: Bird instead of
unofficial WhatsApp clients, structured LLM turns, conflict screening) are in commit `9ad0f04`'s
`docs/ARCHITECTURE.md`.

Deploying it (from a phone):

Everything below can be done in mobile browsers. Estimated time: 20–30 minutes.

## 1. Database

Railway: **New Project → Database → PostgreSQL**. Copy its `DATABASE_URL`.
(Supabase also works: Project → Settings → Database → connection string.)

## 2. App

Railway: **New → GitHub Repo → DigitalVertise/lexos-ai**.
In the service **Settings**, set **Root Directory** to `apps/api`. Railway
finds the Dockerfile. Then **Networking → Generate Domain**.

## 3. Variables

In the service **Variables**, add (see `.env.example` for all of them):

| Variable | Value |
|---|---|
| `ENVIRONMENT` | `production` |
| `DATABASE_URL` | from step 1 (on Railway use a reference to the Postgres service) |
| `ADMIN_TOKEN` | a long random string |
| `DASHBOARD_TOKEN` | the dashboard password |
| `BIRD_API_KEY` | Bird → Settings → API keys (workspace key, `bk_...`) |
| `BIRD_WEBHOOK_SECRET` | from step 4 |
| `ANTHROPIC_API_KEY` (or another provider key) | your LLM key |
| `DEFAULT_TENANT_NAME` / `_SLUG` | the firm's name and a short id, e.g. `al-noor` |
| `DEFAULT_TENANT_WHATSAPP` | the firm's WhatsApp number connected in Bird, e.g. `+971500000000` |
| `DEFAULT_TENANT_TEAM_PHONES` | lawyers' WhatsApp numbers, comma-separated |
| `DEFAULT_TENANT_TEAM_GROUP` | the Bird group ID (`wag_...`) of the team group, from step 5 |

## 4. Bird webhook

Bird dashboard → **Webhooks → Add endpoint**:
- URL: `https://<your-railway-domain>/webhooks/bird`
- Events: `whatsapp.received`

Copy the signing secret (`whsec_...`, shown once) into `BIRD_WEBHOOK_SECRET`. Railway redeploys automatically.

## 5. Team group

Create the team group on the firm's number from Bird → **WhatsApp → Groups**
(or via the Bird API), invite the lawyers, and copy the group ID (`wag_...`)
into `DEFAULT_TENANT_TEAM_GROUP`.

## 6. Test

1. From a phone that is not a team member, message the firm's number: "Hi, I need help with an employment issue". The assistant should start intake.
2. Finish the intake. The team group gets a "New intake M-1" summary.
3. In the team group send `/help`, then `/leads`.
4. Open `https://<your-railway-domain>/dashboard` and sign in with `DASHBOARD_TOKEN`.

## Troubleshooting

| Symptom | Check |
|---|---|
| No reply at all | Railway logs: `Rejected webhook` means a wrong `BIRD_WEBHOOK_SECRET`; `No tenant for business number` means `DEFAULT_TENANT_WHATSAPP` doesn't match the Bird number exactly |
| "A member of our team will get back to you" every time | LLM key missing or wrong model name (logs show the error) |
| Team commands ignored | `DEFAULT_TENANT_TEAM_GROUP` not set, or set to a different group |
| Bird returns `WhatsAppServiceWindowClosed` | The 24-hour window lapsed; outbound templates come in Phase 2 |
