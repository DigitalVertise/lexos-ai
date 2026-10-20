"""Bridge from the WhatsApp service into the LexOS web app's database.

When ``LEXOS_DATABASE_URL`` is set, the WhatsApp tables live in schema ``wa``
of the same Supabase database and every completed intake is mirrored into
LexOS: a ``public.clients`` row, a ``public.matters`` row (status 'intake'),
an ``audit_events`` row, and, if the firm connected them in LexOS, a Zoho
Bigin contact and a Notion page.

Integration tokens are read from ``public.integration_connections``, the same
rows the web app writes. The format matches apps/web/src/lib/crypto.ts:
``v1.<iv>.<tag>.<ciphertext>`` (base64url, AES-256-GCM, 12-byte IV), key =
base64(INTEGRATIONS_ENCRYPTION_KEY), AAD = ``f"{org_id}:{provider}"``.

Every step is best effort: a failure is logged and never breaks the WhatsApp
conversation.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
import uuid
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .models import Contact, Matter, Tenant

log = logging.getLogger(__name__)

NOTION_VERSION = "2022-06-28"
_ZOHO_TLDS = ("com", "eu", "in", "com.au", "jp", "com.cn", "sa", "ca", "uk")


def enabled(settings: Settings | None = None) -> bool:
    return bool((settings or get_settings()).lexos_database_url)


# ---------------------------------------------------------------------------
# Token encryption (mirror of apps/web/src/lib/crypto.ts)
# ---------------------------------------------------------------------------

def _b64url_decode(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _key(raw: str) -> bytes:
    key = base64.b64decode(raw or "")
    if len(key) != 32:
        raise ValueError("INTEGRATIONS_ENCRYPTION_KEY must be 32 bytes (base64)")
    return key


def open_sealed(sealed: str, aad: str, raw_key: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    version, iv, tag, ct = (sealed.split(".") + ["", "", "", ""])[:4]
    if version != "v1" or not (iv and tag and ct):
        raise ValueError("unrecognised ciphertext")
    return AESGCM(_key(raw_key)).decrypt(_b64url_decode(iv), _b64url_decode(ct) + _b64url_decode(tag),
                                         aad.encode()).decode()


def seal(plaintext: str, aad: str, raw_key: str) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    iv = os.urandom(12)
    out = AESGCM(_key(raw_key)).encrypt(iv, plaintext.encode(), aad.encode())
    ct, tag = out[:-16], out[-16:]
    return ".".join(["v1", _b64url(iv), _b64url(tag), _b64url(ct)])


def _load_connection(session: Session, org_id: str, provider: str, raw_key: str) -> tuple[dict, str | None] | None:
    row = session.execute(text(
        "select encrypted_tokens, api_domain from public.integration_connections "
        "where org_id = :org and provider = :p and status <> 'revoked'"),
        {"org": org_id, "p": provider}).first()
    if row is None:
        return None
    try:
        return json.loads(open_sealed(row[0], f"{org_id}:{provider}", raw_key)), row[1]
    except Exception:
        log.warning("Could not decrypt %s connection for org %s", provider, org_id)
        return None


def _report_connection(session: Session, org_id: str, provider: str, status: str,
                       error: str | None, tokens: dict | None, raw_key: str) -> None:
    params: dict[str, Any] = {"org": org_id, "p": provider, "s": status, "e": (error or None) and error[:300]}
    sql = "update public.integration_connections set status = :s, last_error = :e, updated_at = now()"
    if tokens is not None:
        params["t"] = seal(json.dumps(tokens), f"{org_id}:{provider}", raw_key)
        sql += ", encrypted_tokens = :t"
    session.execute(text(sql + " where org_id = :org and provider = :p"), params)


# ---------------------------------------------------------------------------
# Zoho Bigin (mirror of apps/web/src/lib/integrations/zoho.ts)
# ---------------------------------------------------------------------------

def _is_zoho(url: str | None, kind: str) -> bool:
    """Only Zoho's own hosts (kind 'accounts' or 'api') ever receive tokens."""
    if not url:
        return False
    template = "https://accounts.zoho.{}" if kind == "accounts" else "https://www.zohoapis.{}"
    return any(url == template.format(t) for t in _ZOHO_TLDS)


def split_name(name: str) -> dict[str, str]:
    parts = (name or "").split()
    if not parts:
        return {"Last_Name": "WhatsApp lead"}
    if len(parts) == 1:
        return {"Last_Name": parts[0][:80]}
    return {"First_Name": " ".join(parts[:-1])[:40], "Last_Name": parts[-1][:80]}


def bigin_contact_record(contact: Contact, matter: Matter) -> dict[str, Any]:
    record: dict[str, Any] = {**split_name(contact.name or ""),
                              "Description": (f"WhatsApp intake {matter.ref}: {matter.summary or ''}")[:3000]}
    if contact.email:
        record["Email"] = contact.email
    if contact.phone:
        record["Mobile"] = contact.phone
    return record


def _http() -> httpx.Client:
    return httpx.Client(timeout=20.0)


def _zoho_refresh(http: httpx.Client, tokens: dict, settings: Settings) -> dict:
    server = tokens.get("accounts_server", "")
    if not _is_zoho(server, "accounts"):
        raise ValueError("unexpected Zoho accounts server")
    resp = http.post(f"{server}/oauth/v2/token", data={
        "grant_type": "refresh_token", "client_id": settings.zoho_client_id,
        "client_secret": settings.zoho_client_secret, "refresh_token": tokens["refresh_token"]})
    body = resp.json() if resp.content else {}
    if resp.status_code >= 400 or body.get("error") or not body.get("access_token"):
        raise ValueError(f"Zoho token error: {body.get('error') or resp.status_code}")
    return {**tokens, "access_token": body["access_token"],
            "expires_at": int(time.time() * 1000) + int(body.get("expires_in", 3600)) * 1000}


def sync_bigin(session: Session, http: httpx.Client, org_id: str, client_id: str,
               contact: Contact, matter: Matter, settings: Settings) -> str | None:
    """Create the lead as a Bigin Contact for the firm's own Bigin. Returns the Bigin id."""
    raw_key = settings.integrations_encryption_key
    if not raw_key:
        return None
    conn = _load_connection(session, org_id, "zoho_bigin", raw_key)
    if conn is None:
        return None
    tokens, api_domain = conn
    refreshed = False
    try:
        if not _is_zoho(api_domain, "api"):
            raise ValueError("unexpected Zoho API domain")
        if int(tokens.get("expires_at", 0)) - int(time.time() * 1000) < 120_000:
            tokens, refreshed = _zoho_refresh(http, tokens, settings), True
        resp = http.post(f"{api_domain}/bigin/v2/Contacts",
                         headers={"Authorization": f"Zoho-oauthtoken {tokens['access_token']}"},
                         json={"data": [bigin_contact_record(contact, matter)], "trigger": []})
        body = resp.json() if resp.content else {}
        row = (body.get("data") or [{}])[0]
        if resp.status_code >= 400 or row.get("code") != "SUCCESS":
            raise ValueError(f"{row.get('code') or resp.status_code}: {row.get('message') or ''}".strip()[:200])
        crm_id = str(row["details"]["id"])
        session.execute(text(
            "update public.clients set crm_id = :c, crm_sync_status = 'synced', crm_synced_at = now(), "
            "crm_error = null where id = :id and org_id = :org"), {"c": crm_id, "id": client_id, "org": org_id})
        if refreshed:
            _report_connection(session, org_id, "zoho_bigin", "connected", None, tokens, raw_key)
        return crm_id
    except Exception as exc:  # noqa: BLE001 - best effort
        msg = str(exc)[:300] or exc.__class__.__name__
        log.warning("Bigin sync failed for org %s: %s", org_id, msg)
        session.execute(text(
            "update public.clients set crm_sync_status = 'failed', crm_error = :e "
            "where id = :id and org_id = :org"), {"e": msg, "id": client_id, "org": org_id})
        _report_connection(session, org_id, "zoho_bigin", "error", msg, tokens if refreshed else None, raw_key)
        return None


# ---------------------------------------------------------------------------
# Notion
# ---------------------------------------------------------------------------

def notion_lead_page(database_id: str, contact: Contact, matter: Matter, title_prop: str) -> dict[str, Any]:
    summary = (matter.summary or "")[:1900]
    details = (f"WhatsApp intake {matter.ref} · {matter.practice_area or '-'} · urgency {matter.urgency or 'normal'}"
               f" · {contact.phone or contact.bsuid or ''}")
    return {
        "parent": {"database_id": database_id},
        "properties": {title_prop: {"title": [{"text": {"content": (contact.name or "WhatsApp lead")[:200]}}]}},
        "children": [
            {"object": "block", "type": "paragraph",
             "paragraph": {"rich_text": [{"type": "text", "text": {"content": details[:1900]}}]}},
            {"object": "block", "type": "paragraph",
             "paragraph": {"rich_text": [{"type": "text", "text": {"content": summary or "-"}}]}},
        ],
    }


def sync_notion(session: Session, http: httpx.Client, org_id: str, tenant: Tenant,
                contact: Contact, matter: Matter, settings: Settings) -> str | None:
    database_id = (tenant.settings or {}).get("notion_leads_database_id")
    raw_key = settings.integrations_encryption_key
    if not database_id or not raw_key:
        return None
    conn = _load_connection(session, org_id, "notion", raw_key)
    if conn is None or not conn[0].get("token"):
        return None
    headers = {"Authorization": f"Bearer {conn[0]['token']}", "Notion-Version": NOTION_VERSION}
    try:
        # The title property can have any name; read it from the database schema.
        db_resp = http.get(f"https://api.notion.com/v1/databases/{database_id}", headers=headers)
        db_resp.raise_for_status()
        title_prop = next((k for k, v in (db_resp.json().get("properties") or {}).items()
                           if v.get("type") == "title"), "Name")
        resp = http.post("https://api.notion.com/v1/pages", headers=headers,
                         json=notion_lead_page(database_id, contact, matter, title_prop))
        resp.raise_for_status()
        return resp.json().get("id")
    except Exception as exc:  # noqa: BLE001
        log.warning("Notion lead page failed for org %s: %s", org_id, str(exc)[:200])
        return None


# ---------------------------------------------------------------------------
# Intake mirror
# ---------------------------------------------------------------------------

def resolve_org_id(session: Session, tenant: Tenant) -> str | None:
    org_id = (tenant.settings or {}).get("lexos_org_id")
    if org_id:
        return str(org_id)
    rows = session.execute(text("select id from public.organizations limit 2")).all()
    if len(rows) == 1:
        org_id = str(rows[0][0])
        tenant.settings = {**(tenant.settings or {}), "lexos_org_id": org_id}
        log.info("Linked tenant %s to the only LexOS organization %s", tenant.slug, org_id)
        return org_id
    log.warning("Tenant %s has no lexos_org_id and LexOS has %d organizations; skipping mirror",
                tenant.slug, len(rows))
    return None


def _upsert_client(session: Session, org_id: str, contact: Contact, matter: Matter) -> str:
    if contact.lexos_client_id:
        return contact.lexos_client_id
    existing = None
    if contact.phone:
        existing = session.execute(text(
            "select id from public.clients where org_id = :org and phone = :phone limit 1"),
            {"org": org_id, "phone": contact.phone}).first()
    if existing:
        return str(existing[0])
    row = session.execute(text(
        "insert into public.clients (id, org_id, kind, name, email, phone, notes) "
        "values (:id, :org, 'individual', :name, :email, :phone, :notes) returning id"),
        {"id": str(uuid.uuid4()), "org": org_id, "name": (contact.name or contact.phone or "WhatsApp lead")[:200],
         "email": contact.email, "phone": contact.phone,
         "notes": f"Created from WhatsApp intake {matter.ref}."}).first()
    return str(row[0])


def mirror_intake(session: Session, tenant: Tenant, contact: Contact, matter: Matter,
                  http: httpx.Client | None = None, settings: Settings | None = None) -> bool:
    """Mirror a completed intake into LexOS. Returns True if the LexOS matter was created."""
    settings = settings or get_settings()
    if not enabled(settings):
        return False
    savepoint = session.begin_nested()
    try:
        org_id = resolve_org_id(session, tenant)
        if not org_id:
            savepoint.rollback()
            return False
        client_id = _upsert_client(session, org_id, contact, matter)
        contact.lexos_client_id = client_id
        description = "\n".join(filter(None, [
            matter.summary,
            f"Other side: {', '.join(matter.adverse_parties)}" if matter.adverse_parties else None,
            f"Urgency: {matter.urgency}" if matter.urgency else None,
            f"Possible conflicts flagged: {len(matter.conflict_hits)} (review in WhatsApp team summary)"
            if matter.conflict_hits else None,
            f"Source: WhatsApp intake {matter.ref}",
        ]))
        row = session.execute(text(
            "insert into public.matters (id, org_id, number, client_id, title, matter_type, status, description) "
            "values (:id, :org, 0, :client, :title, :type, 'intake', :desc) returning id, number"),
            {"id": str(uuid.uuid4()), "org": org_id, "client": client_id, "title": matter.title[:300],
             "type": matter.practice_area, "desc": description[:10000]}).first()
        matter.lexos_matter_id, matter.lexos_matter_number = str(row[0]), int(row[1])
        session.execute(text(
            "insert into public.audit_events (org_id, action, entity_type, entity_id, metadata) "
            "values (:org, 'whatsapp.intake', 'matter', :id, :meta)"),
            {"org": org_id, "id": matter.lexos_matter_id,
             "meta": json.dumps({"wa_ref": matter.ref, "conflicts": len(matter.conflict_hits or [])})})
        savepoint.commit()
    except Exception:
        log.exception("LexOS mirror failed for %s", matter.ref)
        savepoint.rollback()
        return False

    # Integrations are separate best-effort steps, each in its own savepoint.
    own = http is None
    http = http or _http()
    try:
        for step in (lambda: sync_bigin(session, http, org_id, client_id, contact, matter, settings),
                     lambda: sync_notion(session, http, org_id, tenant, contact, matter, settings)):
            sp = session.begin_nested()
            try:
                step()
                sp.commit()
            except Exception:
                log.exception("LexOS integration step failed for %s", matter.ref)
                sp.rollback()
    finally:
        if own:
            http.close()
    return True
