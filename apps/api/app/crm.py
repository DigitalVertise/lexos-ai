"""CRM sync layer.

LexOS keeps its own database as the source of truth and mirrors leads and
matters into an external CRM. The firm never sees the CRM brand: it is a
backend only.

- ``LocalCRM``: no external CRM (default). Everything stays in LexOS.
- ``BiginCRM``: Zoho Bigin via its REST API v2. Contacts are upserted by phone,
  and intake summaries are attached as notes. Matters become Pipeline records
  only when ``BIGIN_SUB_PIPELINE`` and ``BIGIN_STAGE`` are set, because those
  names are specific to each Bigin account.

CRM failures are logged and never block the WhatsApp flow.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Protocol

import httpx

from .config import Settings
from .models import Contact, Matter

log = logging.getLogger(__name__)


class CRM(Protocol):
    def sync_contact(self, contact: Contact) -> str | None: ...
    def sync_matter(self, matter: Matter, contact: Contact | None) -> str | None: ...


class LocalCRM:
    def sync_contact(self, contact: Contact) -> str | None:
        return None

    def sync_matter(self, matter: Matter, contact: Contact | None) -> str | None:
        return None


class BiginCRM:
    def __init__(self, settings: Settings):
        self.s = settings
        dc = settings.zoho_dc
        self.accounts_url = f"https://accounts.zoho.{dc}/oauth/v2/token"
        self.api = f"https://www.zohoapis.{dc}/bigin/v2"
        self._token: str | None = None
        self._token_expiry = 0.0
        self._http = httpx.Client(timeout=20)
        self.sub_pipeline = os.getenv("BIGIN_SUB_PIPELINE", "")
        self.stage = os.getenv("BIGIN_STAGE", "")

    # -- auth -------------------------------------------------------------
    def _access_token(self) -> str:
        if self._token and time.time() < self._token_expiry - 60:
            return self._token
        resp = self._http.post(self.accounts_url, params={
            "refresh_token": self.s.zoho_refresh_token,
            "client_id": self.s.zoho_client_id,
            "client_secret": self.s.zoho_client_secret,
            "grant_type": "refresh_token",
        })
        resp.raise_for_status()
        data = resp.json()
        if "access_token" not in data:
            raise RuntimeError(f"Zoho token refresh failed: {data.get('error', 'unknown')}")
        self._token = data["access_token"]
        self._token_expiry = time.time() + int(data.get("expires_in", 3600))
        return self._token

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Zoho-oauthtoken {self._access_token()}"}

    # -- operations -------------------------------------------------------
    def sync_contact(self, contact: Contact) -> str | None:
        try:
            name = (contact.name or "WhatsApp lead").strip()
            first, _, last = name.partition(" ")
            record = {
                "First_Name": first if last else "",
                "Last_Name": last or first,
                "Mobile": contact.phone or "",
                "Email": contact.email or None,
                "Description": f"LexOS {contact.kind} via WhatsApp",
            }
            resp = self._http.post(
                f"{self.api}/Contacts/upsert",
                headers=self._headers(),
                json={"data": [{k: v for k, v in record.items() if v}],
                      "duplicate_check_fields": ["Mobile"]},
            )
            resp.raise_for_status()
            return resp.json()["data"][0]["details"]["id"]
        except Exception:
            log.exception("Bigin contact sync failed")
            return None

    def sync_matter(self, matter: Matter, contact: Contact | None) -> str | None:
        try:
            note = (
                f"{matter.ref}: {matter.title}\n"
                f"Practice area: {matter.practice_area or '-'}\n"
                f"Urgency: {matter.urgency or '-'}\n"
                f"Adverse parties: {', '.join(matter.adverse_parties) or '-'}\n"
                f"Conflict hits: {len(matter.conflict_hits)}\n\n{matter.summary or ''}"
            )
            record_id = None
            if self.sub_pipeline and self.stage:
                deal = {
                    "Deal_Name": f"{matter.ref} {matter.title}"[:120],
                    "Sub_Pipeline": self.sub_pipeline,
                    "Stage": self.stage,
                    "Description": note,
                }
                if contact and contact.crm_id:
                    deal["Contact_Name"] = {"id": contact.crm_id}
                resp = self._http.post(f"{self.api}/Pipelines", headers=self._headers(),
                                       json={"data": [deal]})
                resp.raise_for_status()
                record_id = resp.json()["data"][0]["details"]["id"]
            elif contact and contact.crm_id:
                resp = self._http.post(
                    f"{self.api}/Contacts/{contact.crm_id}/Notes",
                    headers=self._headers(),
                    json={"data": [{"Note_Title": f"Intake {matter.ref}", "Note_Content": note}]},
                )
                resp.raise_for_status()
            return record_id
        except Exception:
            log.exception("Bigin matter sync failed")
            return None


def build_crm(settings: Settings) -> CRM:
    if settings.crm_backend == "bigin":
        if not (settings.zoho_client_id and settings.zoho_refresh_token):
            log.warning("CRM_BACKEND=bigin but Zoho credentials are missing; using local CRM")
            return LocalCRM()
        return BiginCRM(settings)
    return LocalCRM()
