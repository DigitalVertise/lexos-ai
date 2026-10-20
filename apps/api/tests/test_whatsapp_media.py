"""Voice notes, files, language, 24-hour window and the /client and /reply commands."""

from datetime import datetime, timedelta, timezone

from app import db, main
from app.media import detect_language, extension_for
from app.models import Contact, Matter, Message, Tenant

from .conftest import TEAM_GROUP, event, post_event

SARA = "+971551234567"
VOICE_URL = "https://us1.platform.bird.com/v1/whatsapp/messages/wam_v/media/waf_v"


def _voice_event():
    evt = event("x")
    del evt["data"]["text"]
    evt["data"]["audio"] = {"id": "waf_v", "url": VOICE_URL, "mime_type": "audio/ogg; codecs=opus", "voice": True}
    return evt


def _reply(text, complete=False, **fields):
    return {"reply": text, "fields": fields, "complete": complete}


def test_voice_note_is_transcribed_and_routed_to_intake(client, env):
    env["messenger"].media[VOICE_URL] = (b"OggS...", "audio/ogg")
    seen = {}

    def fake_transcribe(data, mime):
        seen["mime"] = mime
        return "مرحبا، أحتاج محامي عمل"

    main.services.transcribe = fake_transcribe
    env["llm"].queue(_reply("أهلاً! ما اسمكم الكامل؟"))
    try:
        post_event(client, _voice_event())
    finally:
        main.services.transcribe = None
    assert seen["mime"].startswith("audio/ogg")
    # The transcript reached the intake model.
    assert "أحتاج محامي" in env["llm"].calls[0]["messages"][-1]["content"]
    with db.session_scope() as s:
        msg = s.query(Message).filter_by(direction="inbound").one()
        assert msg.body.startswith("[voice note] ") and msg.media_kind == "audio"
        assert s.query(Contact).filter_by(phone=SARA).one().language == "ar"


def test_voice_note_without_transcription_asks_to_type(client, env):
    main.services.transcribe = None
    post_event(client, _voice_event())
    sent = [m for m in env["messenger"].sent if m["to"] == SARA]
    assert len(sent) == 1 and "type" in sent[0]["body"]
    assert env["llm"].calls == []


def test_document_metadata_is_stored_and_described_to_intake(client, env):
    evt = event("x")
    del evt["data"]["text"]
    evt["data"]["document"] = {"id": "waf_d", "url": "https://us1.platform.bird.com/d",
                               "mime_type": "application/pdf", "filename": "contract.pdf", "caption": "my lease"}
    env["llm"].queue(_reply("Thank you for the document. May I have your full name?"))
    post_event(client, evt)
    assert "[document: contract.pdf] my lease" in env["llm"].calls[0]["messages"][-1]["content"]
    with db.session_scope() as s:
        msg = s.query(Message).filter_by(direction="inbound").one()
        assert (msg.media_kind, msg.media_filename, msg.media_mime) == ("document", "contract.pdf", "application/pdf")


def test_language_detection():
    assert detect_language("Hello there") == "en"
    assert detect_language("السلام عليكم") == "ar"
    assert detect_language("12345 !!") is None
    assert extension_for("audio/ogg; codecs=opus") == "ogg" and extension_for("audio/mpeg") == "mp3"


def _make_matter(window_closed=False):
    with db.session_scope() as s:
        tenant = s.query(Tenant).one()
        sara = Contact(tenant_id=tenant.id, kind="lead", name="Sara Ahmed", phone=SARA, language="en")
        s.add(sara)
        s.flush()
        when = datetime.now(timezone.utc) - (timedelta(hours=30) if window_closed else timedelta(hours=1))
        s.add(Message(tenant_id=tenant.id, contact_id=sara.id, direction="inbound", body="hi", created_at=when))
        s.add(Matter(tenant_id=tenant.id, number=7, client_id=sara.id, title="Employment – Sara Ahmed",
                     summary="Unpaid gratuity"))
        return tenant.id


def test_reply_command_sends_and_pauses_ai(client, env):
    _make_matter()
    post_event(client, event("/reply M-7 Hello Sara, this is your lawyer.", sender="+971500000099",
                             name="Lawyer", group=TEAM_GROUP))
    to_sara = [m for m in env["messenger"].sent if m["to"] == SARA]
    assert to_sara and to_sara[0]["body"] == "Hello Sara, this is your lawyer."
    with db.session_scope() as s:
        assert s.query(Contact).filter_by(phone=SARA).one().bot_muted is True


def test_reply_outside_window_uses_template(client, env):
    tenant_id = _make_matter(window_closed=True)
    with db.session_scope() as s:
        t = s.get(Tenant, tenant_id)
        t.settings = {**t.settings, "followup_template": {"slug": "lexos_follow_up", "language": "en", "with_name": True}}
    post_event(client, event("/reply M-7 Your hearing is moved.", sender="+971500000099",
                             name="Lawyer", group=TEAM_GROUP))
    assert not [m for m in env["messenger"].sent if m["to"] == SARA]
    tpl = env["messenger"].templates
    assert tpl == [{"to": SARA, "from": "+971500000001", "slug": "lexos_follow_up", "language": "en",
                    "params": ["Sara Ahmed"]}]
    team = [m["body"] for m in env["messenger"].sent if m["to"] == TEAM_GROUP]
    assert any("24h" in b and "Your hearing is moved." in b for b in team)


def test_window_closed_by_bird_without_template_alerts_team(client, env):
    _make_matter()
    env["messenger"].closed_windows.add(SARA)
    post_event(client, event("/reply M-7 Update for you", sender="+971500000099", name="Lawyer", group=TEAM_GROUP))
    team = [m["body"] for m in env["messenger"].sent if m["to"] == TEAM_GROUP]
    assert any("24-hour window is closed" in b for b in team)


def test_client_card(client, env):
    _make_matter()
    post_event(client, event("/client M-7", sender="+971500000099", name="Lawyer", group=TEAM_GROUP))
    card = [m["body"] for m in env["messenger"].sent if m["to"] == TEAM_GROUP][-1]
    assert "Sara Ahmed" in card and SARA in card and "M-7" in card
