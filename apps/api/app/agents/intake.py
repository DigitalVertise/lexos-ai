"""Intake agent: qualifies new leads over WhatsApp.

Each turn the model returns JSON with its reply and the facts collected so
far. The server, not the model, decides when intake is complete, creates the
matter, runs the conflict check and alerts the team. Conflict results are
never revealed to the prospective client.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from .. import conflicts
from ..context import Ctx
from ..llm import parse_json
from ..models import IntakeSession, Matter, Message

log = logging.getLogger(__name__)

HISTORY_LIMIT = 20
REQUIRED = ("full_name", "practice_area", "description")

SYSTEM_PROMPT = """You are the client-intake assistant for {firm_name}, a law firm.
{firm_description}
Practice areas: {practice_areas}.

You are chatting on WhatsApp with someone who may become a client. Your job is
to collect, politely and briefly, the information a lawyer needs:
1. full_name: their full name (or their company's name if they write for a company)
2. practice_area: what kind of legal matter it is (use one of the practice areas above if it fits)
3. description: a short summary of their situation, in their own facts
4. adverse_parties: names of the other side (people or companies). Ask explicitly.
   If they say there is none or they don't know, set adverse_parties_confirmed to true with an empty list.
5. urgency: "urgent" if there is a deadline within ~7 days, a court date, an arrest,
   a travel ban or similar; otherwise "normal"
6. email: optional, only if they offer it

Rules:
- Ask one or two questions at a time. Keep messages short, warm and professional.
- Reply in the language the person writes in (Arabic or English). Set language to "ar" or "en".
- NEVER give legal advice, opinions on their chances, or fee quotes. If asked, say a
  lawyer will advise them after reviewing the details.
- Never promise the firm will take the case.
- If something sounds urgent, say a lawyer will be alerted right away.
- When you have everything, thank them and say a lawyer will contact them
  ({office_hours}). Set complete to true.

Facts collected so far: {fields}

Respond ONLY with a JSON object, no other text:
{{"reply": "<your WhatsApp message>",
  "fields": {{"full_name": str|null, "practice_area": str|null, "description": str|null,
             "adverse_parties": [str], "adverse_parties_confirmed": bool,
             "urgency": "urgent"|"normal"|null, "email": str|null, "language": "en"|"ar"}},
  "complete": bool}}"""

FALLBACK_REPLY = {
    "en": "Thank you for contacting us. A member of our team will get back to you shortly.",
    "ar": "شكراً لتواصلكم معنا. سيتواصل معكم أحد أعضاء فريقنا قريباً.",
}


def _history(ctx: Ctx) -> list[dict[str, str]]:
    rows = ctx.session.scalars(
        select(Message)
        .where(Message.tenant_id == ctx.tenant.id, Message.contact_id == ctx.sender.id,
               Message.group_id.is_(None))
        .order_by(Message.created_at.desc())
        .limit(HISTORY_LIMIT)
    ).all()
    return [
        {"role": "user" if m.direction == "inbound" else "assistant", "content": m.body}
        for m in reversed(rows)
    ]


def _is_complete(fields: dict) -> bool:
    if not all(fields.get(k) for k in REQUIRED):
        return False
    return bool(fields.get("adverse_parties")) or bool(fields.get("adverse_parties_confirmed"))


def _merge(old: dict, new: dict) -> dict:
    merged = dict(old)
    for key, value in (new or {}).items():
        if value in (None, "", []):
            continue
        if key == "adverse_parties":
            existing = merged.get("adverse_parties") or []
            merged[key] = list(dict.fromkeys([*existing, *[str(v).strip() for v in value if str(v).strip()]]))
        else:
            merged[key] = value
    return merged


def get_open_session(ctx: Ctx) -> IntakeSession | None:
    return ctx.session.scalar(
        select(IntakeSession).where(
            IntakeSession.tenant_id == ctx.tenant.id,
            IntakeSession.contact_id == ctx.sender.id,
        ).order_by(IntakeSession.updated_at.desc())
    )


def handle(ctx: Ctx) -> None:
    intake = get_open_session(ctx)
    if intake and intake.status == "completed":
        _after_completion(ctx, intake)
        return
    if intake is None:
        intake = IntakeSession(tenant_id=ctx.tenant.id, contact_id=ctx.sender.id, fields={})
        ctx.session.add(intake)
        ctx.session.flush()

    settings = ctx.tenant.settings or {}
    system = SYSTEM_PROMPT.format(
        firm_name=ctx.tenant.name,
        firm_description=settings.get("description", ""),
        practice_areas=", ".join(settings.get("practice_areas", [])) or "general legal matters",
        office_hours=settings.get("office_hours", "within one business day"),
        fields=json.dumps(intake.fields, ensure_ascii=False),
    )

    try:
        raw = ctx.llm.complete(system, _history(ctx), json_mode=True)
        result = parse_json(raw)
        reply = str(result.get("reply") or "").strip()
        fields = _merge(intake.fields, result.get("fields") or {})
    except Exception:
        log.exception("Intake LLM call failed")
        lang = (intake.fields or {}).get("language", "en")
        ctx.reply(FALLBACK_REPLY.get(lang, FALLBACK_REPLY["en"]))
        ctx.notify_team(
            f"⚠️ New WhatsApp message from {ctx.sender.name or ctx.msg.sender_key} "
            f"({ctx.msg.sender_key}). The intake assistant had an error; please reply manually."
        )
        return

    intake.fields = fields
    if fields.get("full_name") and not ctx.sender.name:
        ctx.sender.name = fields["full_name"]
    if fields.get("email"):
        ctx.sender.email = fields["email"]
    if fields.get("language"):
        ctx.sender.language = fields["language"]

    if reply:
        ctx.reply(reply)

    if _is_complete(fields):
        _complete(ctx, intake)


def _complete(ctx: Ctx, intake: IntakeSession) -> None:
    f = intake.fields
    contact = ctx.sender
    contact.name = f.get("full_name") or contact.name
    matter = Matter(
        tenant_id=ctx.tenant.id,
        number=ctx.next_matter_number(),
        client_id=contact.id,
        title=f"{f.get('practice_area', 'Matter')} – {contact.name}"[:300],
        practice_area=f.get("practice_area"),
        summary=f.get("description"),
        urgency=f.get("urgency") or "normal",
        adverse_parties=f.get("adverse_parties") or [],
    )
    ctx.session.add(matter)
    ctx.session.flush()

    hits: list[conflicts.ConflictHit] = []
    for party in matter.adverse_parties:
        hits += conflicts.check(ctx.session, ctx.tenant.id, party,
                                exclude_matter_id=matter.id, exclude_contact_id=contact.id)
    # The new client may themselves be an adverse party in an existing matter.
    if contact.name:
        hits += [h for h in conflicts.check(ctx.session, ctx.tenant.id, contact.name,
                                            exclude_matter_id=matter.id,
                                            exclude_contact_id=contact.id)]
    matter.conflict_hits = [h.as_dict() for h in hits]
    matter.status = "conflict_review" if hits else "intake"

    intake.status = "completed"
    intake.matter_id = matter.id

    contact.crm_id = contact.crm_id or ctx.crm.sync_contact(contact)
    matter.crm_id = ctx.crm.sync_matter(matter, contact)

    ctx.notify_team(_team_summary(matter, contact, hits))


def _team_summary(matter: Matter, contact, hits) -> str:
    urgent = matter.urgency == "urgent"
    lines = [
        f"{'🚨 URGENT ' if urgent else '🆕 '}New intake {matter.ref}",
        f"Client: {contact.name} ({contact.phone or contact.bsuid})",
        f"Area: {matter.practice_area or '-'}",
        f"Other side: {', '.join(matter.adverse_parties) or 'none given'}",
        f"Summary: {matter.summary or '-'}",
    ]
    if hits:
        lines.append("")
        lines.append(f"⚠️ POSSIBLE CONFLICT — {len(hits)} match(es), review before contacting:")
        for h in hits[:8]:
            lines.append(f"• {h.name} — {h.source} ({int(h.score * 100)}%)")
    else:
        lines.append("✅ No conflict matches found (screening only).")
    lines.append("")
    lines.append(f"Log time: /time 15m {matter.ref} intake review")
    return "\n".join(lines)


ACK_COOLDOWN = timedelta(hours=12)


def recently_messaged(ctx: Ctx, within: timedelta = ACK_COOLDOWN) -> bool:
    """True if we sent this contact a message recently (avoid repetitive auto-replies)."""
    since = datetime.now(timezone.utc) - within
    last = ctx.session.scalar(
        select(Message.created_at)
        .where(Message.tenant_id == ctx.tenant.id, Message.contact_id == ctx.sender.id,
               Message.direction == "outbound")
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    if last is None:
        return False
    if last.tzinfo is None:  # SQLite drops tz info
        last = last.replace(tzinfo=timezone.utc)
    return last >= since


def _after_completion(ctx: Ctx, intake: IntakeSession) -> None:
    """Intake is done; a lawyer takes over (usually from the WhatsApp Business app).

    Acknowledge at most once per cooldown so the bot does not talk over the lawyer.
    """
    if recently_messaged(ctx):
        return
    matter = ctx.session.get(Matter, intake.matter_id) if intake.matter_id else None
    ref = matter.ref if matter else ""
    if (ctx.sender.language or "en") == "ar":
        ctx.reply(f"شكراً لكم. طلبكم {ref} لدى فريقنا وسيتواصل معكم أحد المحامين قريباً.")
    else:
        ctx.reply(f"Thank you. Our team has your request {ref} and a lawyer will be in touch shortly.")
