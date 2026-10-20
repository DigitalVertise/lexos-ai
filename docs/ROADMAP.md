# Roadmap

| Phase | Goal | Status |
|---|---|---|
| 1. WhatsApp intake MVP | Intake agent, conflict screening, team commands, time logging, drafts, dashboard, Bigin mirror | ✅ Built |
| 2. Production hardening | Migrations, RLS, team auth, templates, document intake, Next.js portal | Next |
| 3. Knowledge & drafting | UAE legal RAG (federal, DIFC, ADGM), template library, Arabic drafting | Later |
| 4. Revenue features | Invoicing with UAE VAT, payment links, client portal | Later |
| 5. Voice & avatar | Voice notes in/out, then LiveKit voice agent; avatar only if clients ask | Later |

Deliberately out of scope until a paying firm asks: LEDES/IOLTA (US billing and trust standards), multi-agent frameworks, avatar video.

---

## Phase 2 tasks

Each task is written so an AI coding agent can pick it up alone. Run `pytest` in `apps/api` before and after.

### P2-1 Alembic migrations
- **Objective**: replace `create_all()` with versioned migrations.
- **Acceptance**: `alembic upgrade head` creates the current schema on an empty Postgres; app startup runs migrations; tests still pass on SQLite.
- **Inputs/Outputs**: `app/models.py` → `apps/api/migrations/`.
- **Dependencies**: none. **Complexity**: S.
- **Notes for agent**: initial revision must match the current models exactly; do not rename tables.

### P2-2 Postgres row-level security
- **Objective**: enforce tenant isolation in the database, not only in code.
- **Acceptance**: RLS policy on every table with `tenant_id`; the app sets `app.tenant_id` per transaction; a test shows a query without the setting returns no rows.
- **Dependencies**: P2-1. **Complexity**: M.

### P2-3 Team command authorisation
- **Objective**: only registered team members can run commands, also inside the team group.
- **Acceptance**: `/conflict` from a non-team participant in the team group is refused; roles `partner` and `staff`; only partners can `/accept` and `/decline`.
- **Dependencies**: none. **Complexity**: S.

### P2-4 WhatsApp templates for outbound follow-ups
- **Objective**: reach clients outside the 24-hour window (appointment reminders, document requests).
- **Acceptance**: `/remind M-12 <text>` sends an approved Bird template when the window is closed and free text when open; template IDs configured per tenant.
- **Dependencies**: template approval in Bird. **Complexity**: M.
- **Notes for agent**: Bird returns `422 WhatsAppServiceWindowClosed` for free text outside the window.

### P2-5 Document and voice-note intake
- **Objective**: store files clients send (IDs, contracts) against the matter; transcribe voice notes.
- **Acceptance**: inbound `document`/`image`/`audio` downloaded via Bird media API into object storage (Cloudflare R2), linked to the matter; voice notes transcribed and fed to intake.
- **Dependencies**: P2-1. **Complexity**: M.

### P2-6 Next.js team portal
- **Objective**: replace the read-only dashboard with a portal: matter detail, edit, assign lawyer, approve intake, search.
- **Acceptance**: per-user login (Supabase Auth), mobile-first, uses a JSON API added to `apps/api`.
- **Dependencies**: P2-2, P2-3. **Complexity**: L.
- **Notes for agent**: can be built in Lovable against the JSON API; keep Bigin invisible.

### P2-7 Group summaries
- **Objective**: `/summary` posts a digest of the team group's last 24h (decisions, tasks, deadlines).
- **Acceptance**: summary uses only logged group messages; nothing is posted outside the group.
- **Dependencies**: none. **Complexity**: S.

### P2-8 Bigin two-way sync
- **Objective**: changes made in Bigin (stage, owner) flow back.
- **Acceptance**: Bigin webhook updates matter status; loop-safe (no echo back to Bigin).
- **Dependencies**: P2-1. **Complexity**: M.

## Parallel work

P2-1, P2-3, P2-7 can run in parallel. P2-2 waits for P2-1; P2-6 waits for P2-2 and P2-3.
