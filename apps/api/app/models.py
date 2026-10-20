"""Multi-tenant data model.

Every business table carries ``tenant_id``. On Postgres the tables live in
schema ``wa`` (see db.py) so they never collide with the LexOS web app's
``public`` tables in a shared Supabase database. Application code always filters by
tenant; Postgres row-level security is added on top in Phase 2 (see
docs/ROADMAP.md).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Tenant(Base):
    """A law firm using the platform."""

    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    # The firm's WhatsApp business number connected in Bird (E.164).
    whatsapp_number: Mapped[str] = mapped_column(String(32), unique=True)
    # Bird group ID (wag_...) of the internal team group, if any.
    team_group_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Free-form settings: firm description, practice areas, languages, tone.
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Contact(Base):
    """Anyone the firm deals with: lead, client, opposing party or team member."""

    __tablename__ = "contacts"
    __table_args__ = (UniqueConstraint("tenant_id", "phone", name="uq_contact_phone"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    # lead | client | opposing | team
    kind: Mapped[str] = mapped_column(String(16), default="lead", index=True)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    bsuid: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    language: Mapped[str | None] = mapped_column(String(8), nullable=True)  # en | ar
    crm_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # public.clients.id in the LexOS database, when the bridge is enabled.
    lexos_client_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # When true the AI stays silent with this contact (a lawyer has taken over).
    bot_muted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Matter(Base):
    """A legal matter (case / engagement). Intake creates one with status=intake."""

    __tablename__ = "matters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    # Short human reference used in WhatsApp commands, e.g. "M-12".
    number: Mapped[int] = mapped_column(Integer, index=True)
    client_id: Mapped[str | None] = mapped_column(ForeignKey("contacts.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(300))
    practice_area: Mapped[str | None] = mapped_column(String(100), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # intake | conflict_review | open | closed | declined
    status: Mapped[str] = mapped_column(String(32), default="intake", index=True)
    urgency: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Names of opposing / related parties, used by the conflict check.
    adverse_parties: Mapped[list] = mapped_column(JSON, default=list)
    conflict_hits: Mapped[list] = mapped_column(JSON, default=list)
    crm_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # public.matters.id / number in the LexOS database, when the bridge is enabled.
    lexos_matter_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    lexos_matter_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    client: Mapped[Contact | None] = relationship()

    __table_args__ = (UniqueConstraint("tenant_id", "number", name="uq_matter_number"),)

    @property
    def ref(self) -> str:
        return f"M-{self.number}"


class TimeEntry(Base):
    __tablename__ = "time_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    matter_id: Mapped[str | None] = mapped_column(ForeignKey("matters.id"), nullable=True)
    author_id: Mapped[str | None] = mapped_column(ForeignKey("contacts.id"), nullable=True)
    minutes: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    matter: Mapped[Matter | None] = relationship()
    author: Mapped[Contact | None] = relationship()


class Message(Base):
    """WhatsApp message log, both directions."""

    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    contact_id: Mapped[str | None] = mapped_column(ForeignKey("contacts.id"), nullable=True, index=True)
    group_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    direction: Mapped[str] = mapped_column(String(8))  # inbound | outbound
    body: Mapped[str] = mapped_column(Text, default="")
    provider_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # Inbound media metadata (the bytes stay at Bird for 30 days).
    media_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    media_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    media_mime: Mapped[str | None] = mapped_column(String(120), nullable=True)
    media_filename: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class IntakeSession(Base):
    """State of an in-progress intake conversation with a new lead."""

    __tablename__ = "intake_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tenant_id: Mapped[str] = mapped_column(ForeignKey("tenants.id"), index=True)
    contact_id: Mapped[str] = mapped_column(ForeignKey("contacts.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="open")  # open | completed
    fields: Mapped[dict] = mapped_column(JSON, default=dict)
    matter_id: Mapped[str | None] = mapped_column(ForeignKey("matters.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class WebhookEvent(Base):
    """Delivery IDs already processed, so Bird retries are not handled twice."""

    __tablename__ = "webhook_events"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
