import json
import time
from collections.abc import Iterator

import pytest

from app import db, main, tenants
from app.channels.bird import NullMessenger, sign
from app.config import get_settings
from app.crm import LocalCRM

SECRET = "whsec_dGVzdC1zZWNyZXQtZm9yLWxleG9zLWFp"  # base64("test-secret-for-lexos-ai")
FIRM_NUMBER = "+971500000001"
TEAM_GROUP = "wag_team0001"
LAWYER = "+971500000099"


class FakeLLM:
    """Returns queued replies; records every call."""

    def __init__(self) -> None:
        self.replies: list[str] = []
        self.calls: list[dict] = []

    def queue(self, obj) -> None:
        self.replies.append(obj if isinstance(obj, str) else json.dumps(obj))

    def complete(self, system, messages, *, model=None, json_mode=False, max_tokens=800):
        self.calls.append({"system": system, "messages": messages, "model": model})
        if not self.replies:
            raise RuntimeError("FakeLLM: no reply queued")
        return self.replies.pop(0)


@pytest.fixture
def env(monkeypatch, tmp_path) -> Iterator[dict]:
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/test.db")
    monkeypatch.setenv("BIRD_WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("ADMIN_TOKEN", "admin-test")
    monkeypatch.setenv("DASHBOARD_TOKEN", "dash-test")
    monkeypatch.setenv("LLM_DRAFT_MODEL", "draft-model")
    get_settings.cache_clear()
    settings = get_settings()

    db.init_engine(settings.database_url)
    db.create_all()
    messenger, llm = NullMessenger(), FakeLLM()
    main.services.messenger = messenger
    main.services.llm = llm
    main.services.crm = LocalCRM()

    with db.session_scope() as s:
        tenants.upsert_tenant(
            s, name="Al Noor Advocates", slug="al-noor", whatsapp_number=FIRM_NUMBER,
            team_group_id=TEAM_GROUP, team_phones=[LAWYER],
            settings={"practice_areas": ["Commercial", "Family", "Employment"]},
        )
    yield {"messenger": messenger, "llm": llm, "settings": settings}
    get_settings.cache_clear()


@pytest.fixture
def client(env):
    from fastapi.testclient import TestClient

    with TestClient(main.app) as c:
        yield c


_counter = {"n": 0}


def event(text: str, sender: str = "+971551234567", name: str | None = "Sara",
          group: str | None = None) -> dict:
    _counter["n"] += 1
    to = {"phone_number": FIRM_NUMBER}
    if group:
        to["group_id"] = group
    sender_obj = {"phone_number": sender}
    if name:
        sender_obj["display_name"] = name
    return {
        "type": "whatsapp.received",
        "timestamp": "2026-10-20T09:00:00Z",
        "data": {
            "whatsapp_id": f"wam_{_counter['n']:06d}",
            "workspace_id": "ws_test",
            "direction": "inbound",
            "from": sender_obj,
            "to": to,
            "text": {"body": text},
            "tags": None,
            "metadata": None,
        },
    }


def post_event(client, evt: dict, delivery_id: str | None = None):
    body = json.dumps(evt).encode()
    delivery_id = delivery_id or f"msg_{evt['data']['whatsapp_id']}"
    ts = int(time.time())
    headers = {
        "webhook-id": delivery_id,
        "webhook-timestamp": str(ts),
        "webhook-signature": sign(SECRET, delivery_id, ts, body),
        "content-type": "application/json",
    }
    return client.post("/webhooks/bird", content=body, headers=headers)
