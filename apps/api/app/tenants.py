"""Tenant setup: from environment variables at startup, or via the admin API."""

from __future__ import annotations

import logging
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .models import Contact, Tenant

log = logging.getLogger(__name__)

_E164 = re.compile(r"^\+[1-9]\d{6,14}$")


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"[^\d+]", "", raw.strip())
    if digits.startswith("00"):
        digits = "+" + digits[2:]
    if not digits.startswith("+"):
        digits = "+" + digits
    if not _E164.match(digits):
        raise ValueError(f"not a valid E.164 phone number: {raw!r}")
    return digits


def upsert_tenant(session: Session, *, name: str, slug: str, whatsapp_number: str,
                  team_group_id: str | None = None, team_phones: list[str] | None = None,
                  settings: dict | None = None) -> Tenant:
    number = normalize_phone(whatsapp_number)
    tenant = session.scalar(select(Tenant).where(Tenant.slug == slug))
    if tenant is None:
        tenant = Tenant(name=name, slug=slug, whatsapp_number=number, settings=settings or {})
        session.add(tenant)
    else:
        tenant.name = name
        tenant.whatsapp_number = number
        if settings is not None:
            tenant.settings = settings
    if team_group_id is not None:
        tenant.team_group_id = team_group_id or None
    session.flush()

    for raw in team_phones or []:
        phone = normalize_phone(raw)
        member = session.scalar(
            select(Contact).where(Contact.tenant_id == tenant.id, Contact.phone == phone)
        )
        if member is None:
            session.add(Contact(tenant_id=tenant.id, kind="team", phone=phone))
        else:
            member.kind = "team"
    session.flush()
    return tenant


def bootstrap_from_env(session: Session, s: Settings) -> Tenant | None:
    if not (s.default_tenant_slug and s.default_tenant_whatsapp):
        return None
    phones = [p for p in s.default_tenant_team_phones.split(",") if p.strip()]
    tenant = upsert_tenant(
        session,
        name=s.default_tenant_name or s.default_tenant_slug,
        slug=s.default_tenant_slug,
        whatsapp_number=s.default_tenant_whatsapp,
        team_group_id=s.default_tenant_team_group or None,
        team_phones=phones,
    )
    log.info("Bootstrapped tenant %s (%s)", tenant.slug, tenant.whatsapp_number)
    return tenant
