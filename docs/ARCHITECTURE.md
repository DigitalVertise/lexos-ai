# Architecture

LexOS AI has two deployable parts in one repository:

| Part | Path | Runs on | Purpose |
|---|---|---|---|
| **Web app** | `apps/web` | Vercel (serverless) | The SaaS: firms, AI legal assistants, clients, matters, tasks, documents, billing |
| **WhatsApp service** | `apps/api` | Separate container host (e.g. Railway) | WhatsApp intake agent and team commands over Bird — see [WHATSAPP.md](WHATSAPP.md) |

Shared infrastructure: **Supabase** (Postgres with row-level security, Auth, private Storage), **OpenAI** (Responses API), **Stripe** (subscriptions).

```
Browser ──► Vercel (Next.js 16, App Router)
              ├─ proxy.ts: refresh session, redirect anonymous users
              ├─ Server Components / Server Actions  ──► Supabase as the signed-in user (RLS)
              ├─ /api/documents/:id/download          ──► short-lived signed URL (private bucket)
              ├─ /api/stripe/webhook                   ──► Supabase service role (billing columns only)
              └─ AI assistants (lib/agents)            ──► OpenAI Responses API (store: false)
Browser ──► Supabase Storage (direct upload, storage RLS: own firm's folder only)
```

## Decision log

### ADR-008: Supabase instead of "no SQL / Notion as database"
- **Problem**: the original brief excluded SQL databases and proposed Notion/Bigin as data stores.
- **Options**: Notion as DB · Clerk + Upstash Redis · Supabase Postgres.
- **Decision**: Supabase (agreed with the product owner on 2026-10-20).
- **Rationale**: Notion's ~3 requests/second shared limit, lack of transactions and lack of per-firm access control make it unsafe for confidential multi-firm legal data. Supabase provides auth, database-enforced tenant isolation (RLS), private file storage and signed URLs in one managed, serverless-friendly service.
- **Tradeoffs**: one more vendor; schema migrations must be managed (`supabase/migrations`).

### ADR-009: Tenant isolation enforced in the database
- Every business row has `org_id`; every table has RLS; policies call `is_member(org_id)` / `has_role(org_id, roles)`.
- Composite foreign keys `(id, org_id)` make it impossible to link a matter to another firm's client, or a document/task/AI output to another firm's matter.
- Users cannot write billing columns (`plan`, `subscription_status`, Stripe IDs): column privileges are revoked; only the service role (Stripe webhook) can.
- Organizations and memberships are created only via `create_organization()` / `accept_invitation()` (SECURITY DEFINER, validated).
- The current firm comes from the user's own memberships; the firm cookie is only a preference and is ignored if the user isn't a member.
- Application code additionally filters by `org_id` on every query (defence in depth).

### ADR-010: AI assistants as a catalogue of roles
- Assistants are defined in code (`lib/agents/catalog.ts`): 4 Basic, 4 Pro, plus Pro custom assistants. A firm "hires" one by creating an `agent_hires` row.
- Each run is one Responses API call: shared safety rules → role brief → firm instructions → matter context → documents wrapped in `<document>` tags → the lawyer's request. Document text cannot close its wrapper, and the rules state document text is never instructions.
- Outputs are saved to `ai_outputs` with token usage; the Deadline Planner returns JSON that the server re-parses from the saved output before creating tasks (never trusting the browser).
- `store: false` is sent so OpenAI does not retain the conversation for retrieval.

### ADR-011: Package limits enforced on the server
- `lib/entitlements.ts` decides hiring, monthly assistant tasks, per-user rate limit (6/minute) and seats, using counts from the database. The UI shows the same decisions but is not trusted.

### ADR-012: Documents
- Files go straight from the browser to the private `documents` bucket under `{org_id}/{document_id}/{name}`; storage RLS allows only members of that org. The server then verifies the object exists and records it.
- Downloads go through `/api/documents/:id/download`, which authorises via RLS and issues a 60-second signed URL.
- Text is extracted server-side for AI use (PDF via unpdf, DOCX via mammoth), capped at 60,000 characters per run.

### ADR-013: Billing
- Stripe Checkout (subscription) + Billing Portal. Prices come from `STRIPE_PRICE_BASIC` / `STRIPE_PRICE_PRO`.
- The webhook verifies the signature, records the event ID first (`stripe_events`) for idempotency, re-fetches the subscription to avoid out-of-order states, checks the customer matches the org, then updates the org. On failure the event record is removed so Stripe's retry is processed.
- New firms get a 14-day trial of the Basic package.

### ADR-014: FastAPI agent runtime next to the serverless web app
- **Problem:** chat, voice and avatars need model routing (LiteLLM), speech and GPU video tools that don't fit Vercel functions well, and WhatsApp needs a long-lived webhook worker.
- **Options:** (a) everything in Next.js routes; (b) one Python service for "agent work" called server-to-server; (c) a separate service per channel.
- **Decision:** (b) `apps/api` on Render (free plan, Frankfurt), with a shared-secret API (`/v1/agent/chat`, `/v1/voice/tts`, `/v1/avatar/*`) plus the WhatsApp webhook.
- **Rationale:** the web app stays the only place that knows users, firms, permissions and package limits; the runtime never sees end-user sessions. If the runtime is asleep or missing, chat falls back to the direct AI route.
- **Tradeoffs:** a second deploy target; the free plan sleeps (mitigated by a 10-minute GitHub Actions ping).

### ADR-015: WhatsApp stays on Bird (official API), not Evolution API
- **Problem:** a later prompt asked for an Evolution API webhook.
- **Decision:** keep Bird (WhatsApp Business Platform). Evolution API automates WhatsApp Web, which breaks WhatsApp's terms and can get the firm's number banned.
- **Tradeoffs:** Bird has per-conversation costs and template rules for messages outside the 24-hour window; both are handled.

### ADR-016: Client portal authorization in Postgres
- **Decision:** portal clients are ordinary Supabase users linked to a client by `portal_access`; they never become firm members. They read data only through `SECURITY DEFINER` functions (`portal_overview`, `portal_document_path`) and narrow RLS policies (`portal_messages`, `documents_portal_read` on storage).
- **Rationale:** the same database-enforced isolation as the firm app; verified by `supabase/tests/portal_isolation.sql`.
- **Tradeoffs:** invitations are copied and sent by the lawyer (no service-role email sending yet).

### ADR-017: Provider-independent avatars
- **Decision:** a registry (`lib/avatars/providers.ts`) and server adapters (`lib/avatars/adapters.ts`) for built-in, LeapTalk (open source), HeyGen, D-ID, Simli, LiveTalking/MuseTalk and ElevenLabs. Each adapter implements only what the provider supports. Keys are encrypted per firm.
- **Rationale:** firms can start free (built-in portrait, LeapTalk) and switch providers without code changes.
- **Honesty rule:** previews are labelled "Demo preview" (in-browser animation) or "Live — generated by <provider>". Nothing is simulated as provider output.
- **Safety:** uploaded real photos require a recorded consent confirmation. AI portraits are prompted as fictional people, and look-alike requests are refused.

### ADR-018: Branding detection
- **Decision:** the server fetches the firm's public homepage (https only, DNS checked against private ranges on every redirect, size and time capped) and suggests logos (logo images, touch icons, og:image) and brand colours (theme-color, CSS). The firm reviews and edits everything. Colours apply as CSS variables, with readable text colour computed by WCAG contrast.

## Data model (system of record)

| Entity | Table | Source of truth | Notes |
|---|---|---|---|
| Users | `auth.users` | Supabase Auth | Passwords never handled by LexOS |
| Firms | `organizations` | LexOS | Billing columns written only by the Stripe webhook |
| Memberships / roles | `memberships` | LexOS | owner, admin, lawyer, staff |
| Invitations | `invitations` | LexOS | Accepted only by a verified account with the invited email |
| Clients | `clients` | LexOS (mirrored to Bigin in a later release) | `crm_id` / `crm_sync_status` reserved for Bigin |
| Matters | `matters` | LexOS | Number assigned by the database per firm |
| Tasks | `tasks` | LexOS | Stored in UTC, shown in Dubai time |
| Documents | `documents` + Storage | LexOS | Uploads private; links (e.g. Notion pages) as URLs |
| AI assistants | `agent_hires` | LexOS | |
| AI outputs and usage | `ai_outputs` | LexOS | Request + output + tokens; no full prompt stored |
| Audit log | `audit_events` | LexOS | Append-only; identifiers only, never content |
| Integration tokens | `integration_connections` | LexOS (server-only) | For Bigin/Notion releases; no user access |
| Stripe events | `stripe_events` | LexOS (server-only) | Idempotency |

**Deletion and offboarding**: deleting an organization cascades to all of its rows. Clients with matters cannot be deleted. Disconnecting a future integration will never delete LexOS data.

## Security controls

- Authentication: Supabase Auth (email + password, email confirmation, password reset).
- Authorization: Postgres RLS + role checks in server actions.
- Secrets: server-only env vars; `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, Stripe keys never reach the browser.
- Headers: HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy.
- Server Actions provide built-in CSRF protection (Origin check).
- Input validation with zod at every action boundary; React escapes output.
- Logs contain error names/codes only — never prompts, documents or tokens.
- Not yet in place (see PROJECT_STATUS.md): MFA, content-security-policy, malware scanning of uploads, formal compliance review.
