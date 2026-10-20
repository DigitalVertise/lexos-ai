# LexOS AI

AI operating system for law firms, starting with the channel firms in the UAE
actually live on: **WhatsApp**.

**Phase 1 (this release)** gives a firm an AI intake assistant on its existing
WhatsApp number, automatic conflict screening, and a team WhatsApp group that
works as a command line for the firm.

| For | What it does |
|---|---|
| New prospects | Bilingual (English/Arabic) intake on WhatsApp: name, matter type, facts, other side, urgency. Never gives legal advice. |
| The firm | Each completed intake becomes a matter (`M-1`, `M-2`…), screened against every client, lead and adverse party on file. The team group gets a summary with any conflict matches. The prospect never sees conflict results. |
| Lawyers in the team group | `/conflict`, `/leads`, `/matter`, `/accept`, `/decline`, `/mute`, `/time`, `/hours`, `/draft`, `/help` |
| Partners | Mobile-friendly dashboard at `/dashboard`: matters, conflicts, time, WhatsApp activity |
| CRM | Optional mirror into Zoho Bigin (contacts, notes, pipeline records). The firm never sees the Bigin brand. |

## How it works

```
Client / team on WhatsApp
        │
        ▼
Bird (official WhatsApp Business API, keeps the firm's existing number)
        │  signed webhook: whatsapp.received
        ▼
LexOS API (FastAPI)
  ├─ router ── team group "/..." ──► commands (conflict, time, draft…)
  │        ├─ new contact ────────► intake agent (LLM via LiteLLM)
  │        └─ existing client ────► acknowledge + notify team
  ├─ conflict check (Arabic/English-aware name matching)
  ├─ Postgres (multi-tenant: one deployment, many firms)
  └─ CRM adapter ──► Bigin (optional)
```

Details and the reasoning behind each choice: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
What comes next: [docs/ROADMAP.md](docs/ROADMAP.md).

## Deploy (no computer needed)

Full step-by-step, written to be done from a phone: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

Short version:
1. Create a Postgres database (Railway or Supabase).
2. Deploy `apps/api` (Dockerfile included) to Railway or Render.
3. Paste the variables from [`.env.example`](.env.example).
4. In Bird, create a webhook for `whatsapp.received` pointing at
   `https://<your-app>/webhooks/bird` and copy its signing secret into `BIRD_WEBHOOK_SECRET`.
5. Message the firm's number from another phone.

## Run locally

```bash
cp .env.example .env          # set ENVIRONMENT=development for local runs
docker compose up --build     # API on http://localhost:8000
```

Without `BIRD_API_KEY`, replies are logged instead of sent ("dry run").

Tests:

```bash
cd apps/api
pip install -r requirements-dev.txt
pytest
```

## Repository layout

```
apps/api/            FastAPI service (webhook, agents, dashboard)
  app/channels/      Bird WhatsApp client + webhook verification
  app/agents/        intake agent, team commands
  app/conflicts.py   conflict-of-interest screening
  app/crm.py         CRM adapters (local, Bigin)
  tests/             end-to-end tests with a fake LLM and fake WhatsApp
docs/                architecture decisions, roadmap, deployment guide
```

## Important

LexOS is a tool for lawyers, not a lawyer. The intake assistant is instructed
never to give legal advice, conflict screening is an aid that must be reviewed
by a lawyer, and every `/draft` output is marked for lawyer review.

This repository is public: keep real keys, client data and firm names out of it.

MIT License.
