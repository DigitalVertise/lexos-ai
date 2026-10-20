"""Per-message context passed to agents and command handlers."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .channels.bird import InboundMessage, Messenger
from .crm import CRM
from .llm import LLM
from .models import Contact, Matter, Message, Tenant


@dataclass
class Ctx:
    session: Session
    tenant: Tenant
    msg: InboundMessage
    sender: Contact
    messenger: Messenger
    llm: LLM
    crm: CRM
    # Stronger model for /draft; None means the LLM's default model.
    draft_model: str | None = None

    # -- replies -------------------------------------------------------------
    def reply(self, body: str) -> None:
        """Reply where the message came from (the group, or the 1:1 chat)."""
        if self.msg.group_id:
            self.send(self.msg.group_id, body, contact=None)
        else:
            target = self.sender.phone or self.sender.bsuid or self.msg.sender_key
            self.send(target, body, contact=self.sender, reply_to=None)

    def notify_team(self, body: str) -> None:
        """Post to the firm's internal WhatsApp group, if configured."""
        if self.tenant.team_group_id:
            self.send(self.tenant.team_group_id, body, contact=None)

    def send(self, to: str, body: str, contact: Contact | None,
             reply_to: str | None = None) -> None:
        ids = self.messenger.send_text(to, body, from_number=self.tenant.whatsapp_number,
                                       reply_to=reply_to)
        self.session.add(Message(
            tenant_id=self.tenant.id,
            contact_id=contact.id if contact else None,
            group_id=to if to.startswith("wag_") else None,
            direction="outbound",
            body=body,
            provider_id=ids[0] if ids else None,
        ))

    # -- helpers ---------------------------------------------------------
    def next_matter_number(self) -> int:
        current = self.session.scalar(
            select(func.max(Matter.number)).where(Matter.tenant_id == self.tenant.id)
        )
        return (current or 0) + 1

    def find_matter(self, ref: str) -> Matter | None:
        digits = "".join(ch for ch in ref if ch.isdigit())
        if not digits:
            return None
        return self.session.scalar(
            select(Matter).where(Matter.tenant_id == self.tenant.id, Matter.number == int(digits))
        )
