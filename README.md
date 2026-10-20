# LexOS AI

Legal practice SaaS for law firms in the UAE and beyond, built around an **AI legal team**: firms hire AI assistants for intake, drafting, client communications, billing, contract review, litigation support, research and deadline planning — working inside a private, per-firm workspace of clients, matters, tasks and documents.

**Production:** https://lexos-ai-digitalvertises-projects.vercel.app

## Packages

| | Basic · $299/mo | Pro · $699/mo |
|---|---|---|
| AI assistants | 4 (Intake & KYC, Drafting, Client Communications, Billing & Time) | All 8 (+ Contract Review, Litigation Paralegal, Legal Research, Deadline Planner) |
| Custom assistants | — | Up to 5 |
| Assistant tasks / month | 400 | 2,000 |
| Team members | 5 | 25 |

New firms get a 14-day trial of Basic. Limits are enforced on the server (`apps/web/src/lib/entitlements.ts`).

## Repository

```
apps/web/        Next.js 16 SaaS (Vercel): auth, firms, AI team, clients, matters, tasks, documents, billing
apps/api/        WhatsApp intake service (Python, Bird) — optional, deployed separately
supabase/        Database migrations and the tenant-isolation test
docs/            ARCHITECTURE, PROJECT_STATUS, INTEGRATIONS, WHATSAPP, ROADMAP
```

## Setup

- Configure services: **[docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)** (Supabase, OpenAI, Stripe; Bigin and Notion later).
- How it's built and why: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.
- Current state, test evidence and open items: **[docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)**.

### Local development

```bash
cd apps/web
cp .env.example .env.local   # fill in values
npm install
npm run dev                  # http://localhost:3000
npm run lint && npm run typecheck && npm test && npm run build
```

Database changes: add a numbered file to `supabase/migrations/` and apply it to the Supabase project.

### Deployments and rollback

Vercel builds `apps/web` on every push: `main` → production, other branches → protected previews.
Rollback: Vercel → lexos-ai → Deployments → previous production deployment → **Promote to Production** (instant; database migrations are additive).

## Important

LexOS assists lawyers; it does not give legal advice. Assistant output is labelled as a draft for professional review, assistants are instructed never to invent legal authorities, and deadlines entered or suggested in the app are not verified court deadlines.

This repository is public: never commit keys, client data or documents.

MIT License.
