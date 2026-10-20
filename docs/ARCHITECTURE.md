# Architecture

## Components (Phase 1)

| Component | File | Responsibility |
|---|---|---|
| Webhook endpoint | `app/main.py` → `POST /webhooks/bird` | Verify signature, de-duplicate retries, acknowledge fast, process in background |
| Bird channel | `app/channels/bird.py` | Standard Webhooks verification, payload parsing (DMs and groups), sending text with chunking |
| Router | `app/router.py` | Find tenant by business number, find/create contact, pick handler |
| Intake agent | `app/agents/intake.py` | Collect facts with the LLM, create the matter, run the conflict check, alert the team |
| Team commands | `app/agents/commands.py` | `/conflict /leads /matter /accept /decline /mute /unmute /time /hours /draft /help` |
| Conflict check | `app/conflicts.py` | Normalised fuzzy name matching across contacts and adverse parties |
| CRM adapter | `app/crm.py` | `LocalCRM` (default) or `BiginCRM` |
| LLM wrapper | `app/llm.py` | LiteLLM, so the provider is a config value |
| Data model | `app/models.py` | `tenants, contacts, matters, time_entries, messages, intake_sessions, webhook_events` |
| Dashboard | `/dashboard` | Read-only, password-protected, mobile-first |

## Message flow

1. Bird posts `whatsapp.received` to `/webhooks/bird`.
2. The signature is verified (`webhook-id.webhook-timestamp.body`, HMAC-SHA256); deliveries older than 5 minutes are rejected.
3. The `webhook-id` is stored; a retry with the same ID returns `duplicate` without reprocessing.
4. The endpoint returns 200 immediately; processing runs as a background task.
5. The router resolves the tenant from `data.to.phone_number`, and group vs. DM from `data.to.group_id`.
6. The handler replies through Bird and every inbound/outbound message is logged.

## Architecture decisions

### ADR-001: Official WhatsApp API through Bird, not Baileys/Evolution API

- **Problem**: the firm must keep its existing number, and the original blueprint used Baileys/Evolution API (an unofficial WhatsApp Web client).
- **Options**: Baileys/Evolution API · Meta Cloud API directly · Twilio · Bird.
- **Decision**: Bird.
- **Rationale**: unofficial clients violate WhatsApp's terms and get numbers banned; for a law firm that is losing its main client line. Bird is official, supports coexistence (the firm keeps using the WhatsApp Business app on the same number), supports groups, and is already connected for Digital Vertise's number.
- **Tradeoffs**: per-conversation cost; free-form replies only inside the 24-hour customer-service window (templates needed for outbound follow-ups, planned for Phase 2).

### ADR-002: One FastAPI service, not a monorepo of four services

- **Problem**: the blueprint proposed separate web, API, WhatsApp-bridge and AI-engine services from day one.
- **Decision**: one Python service for Phase 1, organised in modules that can be split later (`channels/`, `agents/`, `crm.py`).
- **Rationale**: one deployment, one log stream, cheapest hosting, fastest iteration. Nothing in Phase 1 needs independent scaling.
- **Tradeoffs**: the dashboard is server-rendered and basic; a Next.js app comes in Phase 2 when the portal needs interactivity.

### ADR-003: LiteLLM with a cheap default model, a stronger model only for drafting

- **Decision**: `LLM_MODEL` (intake, fast and cheap) and `LLM_DRAFT_MODEL` (drafting only). Any LiteLLM provider string works, including OpenRouter and local Ollama.
- **Rationale**: intake turns are short and frequent; drafting is rare and quality-sensitive. Switching providers is an environment change.
- **Tradeoffs**: no provider-native features (e.g. prompt caching) in Phase 1.

### ADR-004: Structured JSON turns instead of an agent framework

- **Problem**: the blueprint used both LangChain and AutoGen.
- **Decision**: each intake turn is one LLM call returning `{reply, fields, complete}`. The server, not the model, decides completion, creates records and runs the conflict check.
- **Rationale**: predictable, testable, cheap (one call per message), and the model never controls side effects such as revealing conflicts. LangGraph is the candidate when multi-step tool use is needed (Phase 2).

### ADR-005: LexOS database is the source of truth; CRM is a mirror

- **Decision**: all records live in LexOS Postgres; `CRM_BACKEND=bigin` mirrors contacts and matters into Zoho Bigin.
- **Rationale**: the conflict check must search all history fast and reliably; a CRM outage must not stop intake; the firm must never see the CRM brand; another CRM is a new adapter.
- **Tradeoffs**: one-way sync in Phase 1 (edits made in Bigin do not flow back).

### ADR-006: Multi-tenant from day one, application-level filtering first

- **Decision**: every table has `tenant_id`; the tenant is resolved from the WhatsApp business number. Postgres row-level security is added in Phase 2.
- **Rationale**: the product is sold as SaaS ($299+/month per firm); one deployment serves many firms.

### ADR-007: Schema created at startup (no migrations yet)

- **Decision**: `create_all()` at startup while the schema is young.
- **Tradeoffs**: column changes on a live database need Alembic. Adding Alembic is the first task of Phase 2, before any paying firm is onboarded.

## Security and confidentiality

- Webhook signatures are mandatory in production (startup fails without the secret).
- Dashboard and admin API are token-protected; production startup fails without the tokens.
- Message bodies are not written to application logs.
- Conflict matches are sent only to the internal team group, never to the prospect.
- The intake prompt forbids legal advice, outcome predictions and fee quotes.
- Known Phase 1 gaps (tracked in the roadmap): any member of the team group can run commands; no per-user dashboard accounts; no encryption at rest beyond the database provider's.
