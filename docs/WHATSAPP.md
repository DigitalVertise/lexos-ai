# WhatsApp service (apps/api)

The WhatsApp intake agent and team commands run in the Python FastAPI service
(the same service hosts the agent runtime used by the web app). Design
decisions (ADR-001 to ADR-007: Bird instead of unofficial WhatsApp clients,
structured LLM turns, conflict screening) are in commit `9ad0f04`'s
`docs/ARCHITECTURE.md`.

## What it does

| Inbound | What happens |
|---|---|
| Text from a new person | Intake agent (LLM, Arabic or English) collects name, matter type, facts, other side, urgency. On completion: matter `M-n`, conflict screening, team alert. |
| Voice note | Downloaded from Bird, transcribed (`STT_MODEL` via LiteLLM), then handled like text. If transcription is unavailable the person is politely asked to type. |
| Photo / document / video | Metadata (type, file name, caption, Bird media URL) stored on the message; intake thanks them and says a lawyer will review it; for existing clients the team is told a file arrived. Files stay at Bird for 30 days. |
| Existing client | Throttled acknowledgement + team alert. |
| Team group / team member | Slash commands (below). |

Language: each contact's language is detected from what they write (Arabic
script vs Latin) and fixed replies follow it.

### Team commands

`/help`, `/leads`, `/matter M-12`, `/client M-12` (client card: contact,
language, last message, files, 24h status), `/reply M-12 <message>` (lawyer
replies from the firm's number; AI pauses for that client), `/accept`,
`/decline`, `/mute`, `/unmute`, `/conflict <name>`, `/time 1h30m M-12 <note>`,
`/hours M-12`, `/draft <document> <details>`.

### 24-hour window

WhatsApp only delivers free-form messages within 24 hours of the contact's
last message (Bird returns `422 E15044 WhatsAppServiceWindowClosed`). Outside
the window the service sends the firm's **approved follow-up template**
instead and tells the team to resend once the contact replies. Configure it
per firm in the tenant settings (admin API `PUT /admin/tenants`):

```json
"followup_template": {"slug": "lexos_follow_up", "language": "en",
                      "languages": {"ar": "ar"}, "with_name": true}
```

`with_name` fills the template's first body variable with the contact's name.
Without a template the team gets an alert that the message was not delivered.

### LexOS link

With `LEXOS_DATABASE_URL` set to the LexOS Supabase database:
- the WhatsApp tables live in schema `wa` of that database (created at start-up);
- each completed intake creates a LexOS **client** and an **intake matter** (numbered by LexOS) plus an audit event;
- if the firm connected **Zoho Bigin** in LexOS → Settings → Integrations, the lead is added to Bigin as a Contact and the LexOS client shows "In CRM";
- if the firm connected **Notion** and its tenant settings include `"notion_leads_database_id": "<database id>"`, a page is added to that Notion database (title = lead name, summary as text). Share the database with the LexOS Notion integration first.

The tenant is linked to its LexOS firm via tenant setting `lexos_org_id`; if
unset and LexOS has exactly one firm, it links automatically. Integration
tokens are decrypted with `INTEGRATIONS_ENCRYPTION_KEY` (the same value as in
Vercel); refreshed Zoho tokens are written back encrypted. Any failure is
logged and never blocks the WhatsApp reply.

Note: tables are created on first start; if you add the LexOS link to an
existing deployment that already has `wa` tables from an older version, drop
schema `wa` once (no LexOS data lives there) so the new columns are created.

## Deploy on Render (free)

Everything below can be done in a mobile browser.

1. Render → **New → Web Service** → connect GitHub repo `DigitalVertise/lexos-ai`.
2. **Root Directory** `apps/api`, **Runtime** Docker, **Instance type** Free.
3. **Health check path** `/health`.
4. Add the environment variables below, then **Create Web Service**.

The free plan sleeps after 15 minutes without traffic; the first message after
that waits ~30–60 s while it wakes. The repo's GitHub Actions keep-awake ping
avoids this during the day.

### Environment variables

| Variable | Value |
|---|---|
| `ENVIRONMENT` | `production` |
| `LEXOS_DATABASE_URL` | Supabase → Connect → **Session pooler** URI (with the database password) |
| `DATABASE_URL` | only if not using `LEXOS_DATABASE_URL` (any Postgres) |
| `ADMIN_TOKEN` | long random string (admin API) |
| `DASHBOARD_TOKEN` | password for `/dashboard` |
| `BIRD_API_KEY` | Bird workspace key (`bk_...`) |
| `BIRD_WEBHOOK_SECRET` | from the Bird webhook endpoint (`whsec_...`) |
| `LLM_API_BASE` | `https://ai-gateway.vercel.sh/v1` |
| `LLM_API_KEY` | Vercel AI Gateway API key |
| `LLM_MODEL` / `LLM_DRAFT_MODEL` | default `openai/gpt-5-mini` |
| `STT_MODEL` | default `openai/whisper-1`; set to empty to disable voice-note transcription |
| `INTEGRATIONS_ENCRYPTION_KEY` | same value as in Vercel (reads the firm's Bigin/Notion connections) |
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` | same Zoho app as the web app (for token refresh) |
| `DEFAULT_TENANT_NAME` / `DEFAULT_TENANT_SLUG` | firm name and short id, e.g. `al-noor` |
| `DEFAULT_TENANT_WHATSAPP` | the Bird-connected number, e.g. `+447378153633` |
| `DEFAULT_TENANT_TEAM_PHONES` | lawyers' WhatsApp numbers, comma-separated |
| `DEFAULT_TENANT_TEAM_GROUP` | Bird group ID (`wag_...`) of the team group |

### Bird webhook

Bird dashboard → **Webhooks → Add endpoint**: URL
`https://<render-domain>/webhooks/bird`, event `whatsapp.received`. Copy the
signing secret into `BIRD_WEBHOOK_SECRET`.

### Team group

Create the team group on the firm's number (Bird → WhatsApp → Groups), invite
the lawyers, put its `wag_...` ID in `DEFAULT_TENANT_TEAM_GROUP`.

## Test

1. From a phone that is not a team member, message the firm's number: "Hi, I need help with an employment issue". Try a voice note and a PDF too.
2. Finish the intake: the team group gets "New intake M-1" (and "In LexOS as matter M-n" when linked); the lead appears in LexOS → Clients and Matters, and in Bigin if connected.
3. In the team group: `/client M-1`, then `/reply M-1 Hello, this is your lawyer`.
4. Open `https://<render-domain>/dashboard` with `DASHBOARD_TOKEN`.

## Troubleshooting

| Symptom | Check |
|---|---|
| No reply at all | Render logs: `Rejected webhook` = wrong `BIRD_WEBHOOK_SECRET`; `No tenant for business number` = `DEFAULT_TENANT_WHATSAPP` doesn't match the Bird number exactly |
| "A member of our team will get back to you" every time | `LLM_API_KEY`/`LLM_API_BASE` wrong or model not available to the gateway (logs show the error) |
| Voice notes always answered with "please type" | `STT_MODEL` not available through the configured gateway/provider (logs: `Voice note transcription failed`) |
| Lead not in LexOS | Logs: `LexOS mirror failed` / `has no lexos_org_id`; set tenant setting `lexos_org_id` when LexOS has several firms |
| Lead not in Bigin | LexOS → Settings → Integrations shows Bigin "Needs attention" with the error; the LexOS client shows "CRM sync failed" |
| Team told "24-hour window is closed" | Expected for contacts silent >24h; add a `followup_template` |
| Team commands ignored | `DEFAULT_TENANT_TEAM_GROUP` not set, or a different group |
