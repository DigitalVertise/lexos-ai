"""LexOS bridge: client/matter mirror, Bigin and Notion via the web app's encrypted connections.

SQLite stands in for Supabase: a second database is ATTACHed as "public" so the
bridge's plain SQL (public.clients, public.matters...) runs unchanged.
"""

import base64
import json
import os
import time
from datetime import datetime, timezone

import httpx
import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import event as sa_event, text

from app import db, lexos_bridge
from app.config import Settings
from app.models import Contact, Matter, Tenant

ORG = "11111111-1111-1111-1111-111111111111"
KEY = base64.b64encode(os.urandom(32)).decode()


def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def web_seal(plaintext: str, aad: str, key: str = KEY) -> str:
    """Exactly what apps/web/src/lib/crypto.ts seal() produces."""
    iv = os.urandom(12)
    out = AESGCM(base64.b64decode(key)).encrypt(iv, plaintext.encode(), aad.encode())
    return ".".join(["v1", b64url(iv), b64url(out[-16:]), b64url(out[:-16])])


SCHEMA = """
create table public.organizations (id text primary key);
create table public.clients (id text primary key, org_id text, kind text, name text, email text, phone text,
  notes text, crm_id text, crm_sync_status text default 'not_synced', crm_synced_at text, crm_error text);
create table public.matters (id text primary key, org_id text, number integer, client_id text, title text,
  matter_type text, status text, description text);
create table public.audit_events (id integer primary key autoincrement, org_id text, action text,
  entity_type text, entity_id text, metadata text);
create table public.integration_connections (org_id text, provider text, status text default 'connected',
  encrypted_tokens text, api_domain text, last_error text, updated_at text, primary key (org_id, provider));
"""


@pytest.fixture
def lexos(env, tmp_path):
    engine = db.get_engine()
    public_path = str(tmp_path / "public.db")

    @sa_event.listens_for(engine, "connect")
    def _attach(dbapi_conn, _):
        dbapi_conn.execute(f"attach database '{public_path}' as public")
        dbapi_conn.create_function("now", 0, lambda: datetime.now(timezone.utc).isoformat())

    engine.dispose()
    with engine.begin() as conn:
        for stmt in filter(None, (s.strip() for s in SCHEMA.split(";"))):
            conn.exec_driver_sql(stmt)
        conn.execute(text("insert into public.organizations (id) values (:o)"), {"o": ORG})
    yield engine
    sa_event.remove(engine, "connect", _attach)
    engine.dispose()


def _settings(**kw):
    return Settings(lexos_database_url="postgresql://unused", integrations_encryption_key=KEY,
                    zoho_client_id="cid", zoho_client_secret="csecret", **kw)


def _intake(session):
    tenant = session.query(Tenant).one()
    tenant.settings = {**tenant.settings, "notion_leads_database_id": "db123"}
    sara = Contact(tenant_id=tenant.id, kind="lead", name="Sara Ahmed", phone="+971551234567",
                   email="sara@example.com")
    session.add(sara)
    session.flush()
    matter = Matter(tenant_id=tenant.id, number=3, client_id=sara.id, title="Employment – Sara Ahmed",
                    practice_area="Employment", summary="Unpaid gratuity", urgency="normal",
                    adverse_parties=["Desert Rose Hotels"])
    session.add(matter)
    session.flush()
    return tenant, sara, matter


def test_open_sealed_matches_web_format():
    sealed = web_seal('{"token":"ntn_x"}', f"{ORG}:notion")
    assert json.loads(lexos_bridge.open_sealed(sealed, f"{ORG}:notion", KEY)) == {"token": "ntn_x"}
    with pytest.raises(Exception):
        lexos_bridge.open_sealed(sealed, "other-org:notion", KEY)
    # Our own seal round-trips through the same reader (refreshed tokens written back).
    again = lexos_bridge.seal('{"a":1}', f"{ORG}:zoho_bigin", KEY)
    assert lexos_bridge.open_sealed(again, f"{ORG}:zoho_bigin", KEY) == '{"a":1}'


def test_mirror_creates_client_matter_audit_bigin_and_notion(lexos):
    expired = {"access_token": "old", "refresh_token": "r1", "expires_at": int(time.time() * 1000) - 1000,
               "accounts_server": "https://accounts.zoho.com"}
    with lexos.begin() as conn:
        conn.execute(text("insert into public.integration_connections (org_id, provider, encrypted_tokens, api_domain) "
                          "values (:o, 'zoho_bigin', :t, 'https://www.zohoapis.com')"),
                     {"o": ORG, "t": web_seal(json.dumps(expired), f"{ORG}:zoho_bigin")})
        conn.execute(text("insert into public.integration_connections (org_id, provider, encrypted_tokens) "
                          "values (:o, 'notion', :t)"),
                     {"o": ORG, "t": web_seal(json.dumps({"token": "ntn_secret"}), f"{ORG}:notion")})

    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        url = str(request.url)
        if url == "https://accounts.zoho.com/oauth/v2/token":
            assert b"refresh_token=r1" in request.content
            return httpx.Response(200, json={"access_token": "new", "expires_in": 3600})
        if url == "https://www.zohoapis.com/bigin/v2/Contacts":
            assert request.headers["authorization"] == "Zoho-oauthtoken new"
            rec = json.loads(request.content)["data"][0]
            assert rec["First_Name"] == "Sara" and rec["Last_Name"] == "Ahmed"
            assert rec["Mobile"] == "+971551234567" and rec["Email"] == "sara@example.com"
            return httpx.Response(201, json={"data": [{"code": "SUCCESS", "details": {"id": "bigin-99"}}]})
        if url == "https://api.notion.com/v1/databases/db123":
            assert request.headers["notion-version"] == "2022-06-28"
            return httpx.Response(200, json={"properties": {"Lead": {"type": "title"}, "Phone": {"type": "phone_number"}}})
        if url == "https://api.notion.com/v1/pages":
            body = json.loads(request.content)
            assert body["parent"] == {"database_id": "db123"}
            assert body["properties"]["Lead"]["title"][0]["text"]["content"] == "Sara Ahmed"
            assert "Unpaid gratuity" in json.dumps(body["children"])
            return httpx.Response(200, json={"id": "page-1"})
        return httpx.Response(404)

    http = httpx.Client(transport=httpx.MockTransport(handler))
    with db.session_scope() as s:
        tenant, sara, matter = _intake(s)
        assert lexos_bridge.mirror_intake(s, tenant, sara, matter, http=http, settings=_settings())
        assert tenant.settings["lexos_org_id"] == ORG  # auto-linked: only one organization
        assert sara.lexos_client_id and matter.lexos_matter_id

    with lexos.connect() as conn:
        client = conn.execute(text("select name, phone, crm_id, crm_sync_status from public.clients")).one()
        assert tuple(client) == ("Sara Ahmed", "+971551234567", "bigin-99", "synced")
        m = conn.execute(text("select status, matter_type, title, description from public.matters")).one()
        assert m[0] == "intake" and m[1] == "Employment" and "Desert Rose Hotels" in m[3]
        audit = conn.execute(text("select action, entity_type from public.audit_events")).one()
        assert tuple(audit) == ("whatsapp.intake", "matter")
        # Refreshed Zoho token written back encrypted, readable by the web app's format.
        sealed = conn.execute(text("select encrypted_tokens from public.integration_connections "
                                   "where provider = 'zoho_bigin'")).scalar()
        assert json.loads(lexos_bridge.open_sealed(sealed, f"{ORG}:zoho_bigin", KEY))["access_token"] == "new"
    assert [str(c.url) for c in calls][-1] == "https://api.notion.com/v1/pages"


def test_bigin_failure_marks_client_failed_but_mirror_succeeds(lexos):
    valid = {"access_token": "tok", "refresh_token": "r", "expires_at": int(time.time() * 1000) + 3_600_000,
             "accounts_server": "https://accounts.zoho.com"}
    with lexos.begin() as conn:
        conn.execute(text("insert into public.integration_connections (org_id, provider, encrypted_tokens, api_domain) "
                          "values (:o, 'zoho_bigin', :t, 'https://www.zohoapis.com')"),
                     {"o": ORG, "t": web_seal(json.dumps(valid), f"{ORG}:zoho_bigin")})
    http = httpx.Client(transport=httpx.MockTransport(
        lambda r: httpx.Response(400, json={"data": [{"code": "INVALID_DATA", "message": "invalid email"}]})))
    with db.session_scope() as s:
        tenant, sara, matter = _intake(s)
        assert lexos_bridge.mirror_intake(s, tenant, sara, matter, http=http, settings=_settings())
    with lexos.connect() as conn:
        status, err = conn.execute(text("select crm_sync_status, crm_error from public.clients")).one()
        assert status == "failed" and "INVALID_DATA" in err
        conn_status = conn.execute(text("select status from public.integration_connections")).scalar()
        assert conn_status == "error"
        assert conn.execute(text("select count(*) from public.matters")).scalar() == 1


def test_bridge_disabled_without_url(env):
    with db.session_scope() as s:
        tenant, sara, matter = _intake(s)
        assert lexos_bridge.mirror_intake(s, tenant, sara, matter, settings=Settings()) is False


def test_rejects_non_zoho_hosts():
    assert lexos_bridge._is_zoho("https://accounts.zoho.eu", "accounts")
    assert not lexos_bridge._is_zoho("https://accounts.zoho.com.evil.io", "accounts")
    assert not lexos_bridge._is_zoho("https://www.zohoapis.com/x", "api")
