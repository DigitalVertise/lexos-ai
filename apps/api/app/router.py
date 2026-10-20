"""Routes each inbound WhatsApp message to the right handler.

| Where it came from                         | Handler                          |
|--------------------------------------------|----------------------------------|
| Team group, starts with "/"                | commands                         |
| Team group, anything else                  | logged only (no reply)           |
| Any other group                            | logged only                      |
| DM from a team member, starts with "/"     | commands                         |
| DM from a team member, anything else       | short hint to use /help          |
| DM from a contact the AI is muted for      | logged only (lawyer has it)      |
| DM from an existing client                 | client acknowledgement           |
| DM from anyone else                        | intake agent                     |

Voice notes are transcribed first and then routed like text. Images and
documents are logged with their metadata and routed with a short description
("[document: lease.pdf] caption") so the intake agent and the team see them.
"""

from __future__ import annotations

import logging

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .agents import commands, intake
from .channels.bird import InboundMessage, Messenger
from .context import Ctx
from .crm import CRM
from .llm import LLM
from .media import Transcriber, detect_language
from .models import Contact, Matter, Message, Tenant

ASK_TO_TYPE = {
    "en": "Sorry, I couldn't listen to that voice note. Could you please type your message?",
    "ar": "عذراً، لم أتمكن من الاستماع إلى الرسالة الصوتية. هل يمكنكم كتابة رسالتكم من فضلكم؟",
}

log = logging.getLogger(__name__)


def find_tenant(session: Session, business_number: str) -> Tenant | None:
    return session.scalar(select(Tenant).where(Tenant.whatsapp_number == business_number))


def find_or_create_contact(session: Session, tenant: Tenant, msg: InboundMessage) -> Contact:
    clauses = []
    if msg.sender_phone:
        clauses.append(Contact.phone == msg.sender_phone)
    if msg.sender_bsuid:
        clauses.append(Contact.bsuid == msg.sender_bsuid)
    contact = None
    if clauses:
        contact = session.scalar(
            select(Contact).where(Contact.tenant_id == tenant.id, or_(*clauses))
        )
    if contact is None:
        contact = Contact(
            tenant_id=tenant.id,
            kind="lead",
            name=msg.sender_name,
            phone=msg.sender_phone,
            bsuid=msg.sender_bsuid,
        )
        session.add(contact)
        session.flush()
    else:
        # Fill gaps as WhatsApp reveals more about the sender.
        contact.phone = contact.phone or msg.sender_phone
        contact.bsuid = contact.bsuid or msg.sender_bsuid
        contact.name = contact.name or msg.sender_name
    return contact


def _transcribe(msg: InboundMessage, messenger: Messenger, transcribe: Transcriber | None) -> str | None:
    if transcribe is None or not msg.media_url:
        return None
    try:
        data, mime = messenger.download_media(msg.media_url)
        return transcribe(data, msg.media_mime or mime).strip() or None
    except Exception:
        log.exception("Voice note transcription failed for %s", msg.provider_id)
        return None


def handle_inbound(session: Session, msg: InboundMessage, *, messenger: Messenger,
                   llm: LLM, crm: CRM, draft_model: str | None = None,
                   transcribe: Transcriber | None = None) -> str:
    """Process one inbound message. Returns a short label of what happened (for logs/tests)."""
    tenant = find_tenant(session, msg.business_number)
    if tenant is None:
        log.warning("No tenant for business number %s", msg.business_number)
        return "no_tenant"

    # Voice notes (not in groups) become text before anything else sees them.
    voice_failed = False
    if msg.kind == "audio" and not msg.group_id:
        transcript = _transcribe(msg, messenger, transcribe)
        if transcript:
            msg.text = transcript
        else:
            voice_failed = True

    sender = find_or_create_contact(session, tenant, msg)
    session.add(Message(
        tenant_id=tenant.id,
        contact_id=sender.id,
        group_id=msg.group_id,
        direction="inbound",
        body=(f"[voice note] {msg.text}" if msg.kind == "audio" and not voice_failed else msg.text),
        provider_id=msg.provider_id,
        media_kind=msg.kind if msg.is_media else None,
        media_url=msg.media_url,
        media_mime=msg.media_mime,
        media_filename=msg.media_filename,
    ))
    session.flush()

    # Keep replies in the language the person writes in.
    if not msg.group_id and sender.kind != "team":
        if lang := detect_language(msg.text if not msg.text.startswith("[") else (msg.caption or "")):
            sender.language = lang

    ctx = Ctx(session=session, tenant=tenant, msg=msg, sender=sender,
              messenger=messenger, llm=llm, crm=crm, draft_model=draft_model)
    text = msg.text.strip()

    if voice_failed and sender.kind != "team" and not sender.bot_muted:
        ctx.reply(ASK_TO_TYPE.get(sender.language or "en", ASK_TO_TYPE["en"]))
        return "voice_failed"

    if msg.group_id:
        if msg.group_id == tenant.team_group_id and commands.is_command(text):
            commands.handle(ctx)
            return "command"
        return "group_logged"

    if sender.kind == "team":
        if commands.is_command(text):
            commands.handle(ctx)
            return "command"
        ctx.reply("Hi! Send /help to see what I can do for the team.")
        return "team_hint"

    if sender.bot_muted:
        return "muted"

    if sender.kind == "client":
        return _client_message(ctx)

    intake.handle(ctx)
    return "intake"


def _client_message(ctx: Ctx) -> str:
    """Existing client writing in. Phase 1: acknowledge (throttled) and alert the team."""
    first_in_window = not intake.recently_messaged(ctx)
    matters = ctx.session.scalars(
        select(Matter).where(Matter.tenant_id == ctx.tenant.id, Matter.client_id == ctx.sender.id,
                             Matter.status.in_(("open", "intake", "conflict_review")))
    ).all()
    refs = ", ".join(m.ref for m in matters) or "-"
    if first_in_window:
        if (ctx.sender.language or "en") == "ar":
            ctx.reply("شكراً لرسالتكم. تم إبلاغ المحامي المسؤول وسيرد عليكم قريباً.")
        else:
            ctx.reply("Thank you for your message. Your lawyer has been notified and will reply soon.")
        ctx.notify_team(f"📩 Client {ctx.sender.name or ctx.msg.sender_key} ({refs}) wrote: "
                        f"{ctx.msg.text[:500]}")
    elif ctx.msg.is_media:
        # Always tell the team about new files, even within the cooldown.
        ctx.notify_team(f"📎 Client {ctx.sender.name or ctx.msg.sender_key} ({refs}) sent {ctx.msg.text[:300]}")
    return "client"
