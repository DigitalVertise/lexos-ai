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
from .models import Contact, Matter, Message, Tenant

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


def handle_inbound(session: Session, msg: InboundMessage, *, messenger: Messenger,
                   llm: LLM, crm: CRM, draft_model: str | None = None) -> str:
    """Process one inbound message. Returns a short label of what happened (for logs/tests)."""
    tenant = find_tenant(session, msg.business_number)
    if tenant is None:
        log.warning("No tenant for business number %s", msg.business_number)
        return "no_tenant"

    sender = find_or_create_contact(session, tenant, msg)
    session.add(Message(
        tenant_id=tenant.id,
        contact_id=sender.id,
        group_id=msg.group_id,
        direction="inbound",
        body=msg.text,
        provider_id=msg.provider_id,
    ))
    session.flush()

    ctx = Ctx(session=session, tenant=tenant, msg=msg, sender=sender,
              messenger=messenger, llm=llm, crm=crm, draft_model=draft_model)
    text = msg.text.strip()

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
    return "client"
