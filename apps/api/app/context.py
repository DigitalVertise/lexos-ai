"""Per-message context passed to agents and command handlers."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .channels.bird import InboundMessage, Messenger, WindowClosedError
from .crm import CRM
from .llm import LLM
from .models import Contact, Matter, Message, Tenant


log = logging.getLogger(__name__)

# WhatsApp only delivers free-form messages within 24h of the contact's last message.
SERVICE_WINDOW = timedelta(hours=24)


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
             reply_to: str | None = None) -> bool:
        """Send and log. For a 1:1 contact outside the 24-hour window, fall back to
        the firm's approved follow-up template (or alert the team). Returns True if
        the free-form text itself was sent."""
        if contact is not None and not to.startswith("wag_") and not self.window_open(contact):
            self._window_closed(to, body, contact)
            return False
        try:
            ids = self.messenger.send_text(to, body, from_number=self.tenant.whatsapp_number,
                                           reply_to=reply_to)
        except WindowClosedError:
            if contact is None:
                raise
            self._window_closed(to, body, contact)
            return False
        self.session.add(Message(
            tenant_id=self.tenant.id,
            contact_id=contact.id if contact else None,
            group_id=to if to.startswith("wag_") else None,
            direction="outbound",
            body=body,
            provider_id=ids[0] if ids else None,
        ))
        return True

    # -- 24-hour service window ------------------------------------------
    def window_open(self, contact: Contact) -> bool:
        last = self.session.scalar(
            select(func.max(Message.created_at)).where(
                Message.tenant_id == self.tenant.id, Message.contact_id == contact.id,
                Message.direction == "inbound", Message.group_id.is_(None))
        )
        if last is None:
            return False
        if last.tzinfo is None:  # SQLite drops tz info
            last = last.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - last < SERVICE_WINDOW

    def _window_closed(self, to: str, body: str, contact: Contact) -> None:
        """Send the approved follow-up template if configured, and tell the team."""
        cfg = (self.tenant.settings or {}).get("followup_template")
        if isinstance(cfg, str):
            cfg = {"slug": cfg}
        who = contact.name or contact.phone or to
        if cfg and cfg.get("slug"):
            lang = (cfg.get("languages") or {}).get(contact.language or "en") or cfg.get("language")
            params = [contact.name or ""] if cfg.get("with_name") else None
            try:
                tpl_id = self.messenger.send_template(to, self.tenant.whatsapp_number, cfg["slug"],
                                                      language=lang, body_params=params)
            except Exception:
                log.exception("Follow-up template failed for %s", to)
            else:
                self.session.add(Message(tenant_id=self.tenant.id, contact_id=contact.id, direction="outbound",
                                         body=f"[template {cfg['slug']}]", provider_id=tpl_id or None))
                self.notify_team(f"⏰ {who} hasn't messaged in 24h, so WhatsApp only allows an approved "
                                 f"template. Sent '{cfg['slug']}'; send your message again once they reply.\n"
                                 f"Unsent: {body[:300]}")
                return
        log.warning("24h window closed for %s and no follow-up template configured", to)
        self.notify_team(f"⚠️ Couldn't deliver to {who}: WhatsApp's 24-hour window is closed and no "
                         f"follow-up template is set up. Message: {body[:300]}")

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
