"""End-to-end flows through the webhook endpoint."""

from app import db
from app.agents.commands import parse_duration
from app.models import Contact, IntakeSession, Matter, Message, TimeEntry

from .conftest import LAWYER, TEAM_GROUP, event, post_event

SARA = "+971551234567"


def _sent(env):
    return env["messenger"].sent


def _intake_reply(reply, complete=False, **fields):
    return {"reply": reply, "fields": fields, "complete": complete}


def test_rejects_bad_signature(client):
    resp = client.post("/webhooks/bird", content=b"{}", headers={
        "webhook-id": "x", "webhook-timestamp": "1", "webhook-signature": "v1,bad"})
    assert resp.status_code == 401


def test_duplicate_delivery_processed_once(client, env):
    env["llm"].queue(_intake_reply("Hello! May I have your full name?"))
    evt = event("Hi, I need a lawyer")
    assert post_event(client, evt, "dup-1").json()["status"] == "accepted"
    assert post_event(client, evt, "dup-1").json()["status"] == "duplicate"
    assert len(_sent(env)) == 1


def test_full_intake_creates_matter_and_alerts_team(client, env):
    llm = env["llm"]
    llm.queue(_intake_reply("Hello Sara! What is the matter about?", full_name="Sara Ahmed"))
    llm.queue(_intake_reply("Who is the other party?", practice_area="Employment",
                            description="Unpaid end-of-service gratuity"))
    llm.queue(_intake_reply("Thank you, a lawyer will contact you.", complete=True,
                            adverse_parties=["Desert Rose Hotels LLC"], urgency="normal",
                            adverse_parties_confirmed=True, language="en"))

    post_event(client, event("Hi, my employer has not paid me"))
    post_event(client, event("Sara Ahmed. They owe me my gratuity"))
    post_event(client, event("Desert Rose Hotels"))

    with db.session_scope() as s:
        matter = s.query(Matter).one()
        assert matter.ref == "M-1"
        assert matter.status == "intake"
        assert matter.practice_area == "Employment"
        assert matter.adverse_parties == ["Desert Rose Hotels LLC"]
        assert s.query(IntakeSession).one().status == "completed"
        sara = s.query(Contact).filter_by(phone=SARA).one()
        assert sara.name == "Sara Ahmed"

    team_posts = [m for m in _sent(env) if m["to"] == TEAM_GROUP]
    assert len(team_posts) == 1
    assert "New intake M-1" in team_posts[0]["body"]
    assert "No conflict matches" in team_posts[0]["body"]
    # The lead never sees conflict information.
    assert all("conflict" not in m["body"].lower() for m in _sent(env) if m["to"] == SARA)


def test_intake_flags_conflict_for_team_only(client, env):
    with db.session_scope() as s:
        from app.models import Tenant
        t = s.query(Tenant).one()
        existing = Contact(tenant_id=t.id, kind="client", name="Desert Rose Hotels LLC")
        s.add(existing)

    env["llm"].queue(_intake_reply("Thanks, a lawyer will be in touch.", complete=True,
                                   full_name="Sara Ahmed", practice_area="Employment",
                                   description="Unpaid gratuity",
                                   adverse_parties=["Desert Rose Hotels"]))
    post_event(client, event("Sara Ahmed, unpaid gratuity from Desert Rose Hotels"))

    with db.session_scope() as s:
        matter = s.query(Matter).one()
        assert matter.status == "conflict_review"
        assert matter.conflict_hits[0]["source"] == "client"

    team = [m["body"] for m in _sent(env) if m["to"] == TEAM_GROUP]
    assert "POSSIBLE CONFLICT" in team[0]
    lead = [m["body"] for m in _sent(env) if m["to"] == SARA]
    assert lead == ["Thanks, a lawyer will be in touch."]


def test_llm_failure_falls_back_and_alerts_team(client, env):
    # No reply queued -> FakeLLM raises.
    post_event(client, event("Hello"))
    to_lead = [m["body"] for m in _sent(env) if m["to"] == SARA]
    assert to_lead and "team will get back" in to_lead[0]
    assert any(m["to"] == TEAM_GROUP and "error" in m["body"] for m in _sent(env))


def test_completed_intake_acknowledges_once(client, env):
    env["llm"].queue(_intake_reply("Thank you.", complete=True, full_name="Sara Ahmed",
                                   practice_area="Family", description="Custody",
                                   adverse_parties_confirmed=True))
    post_event(client, event("Sara, custody question, no other party yet"))
    before = len(_sent(env))
    post_event(client, event("Any update?"))
    post_event(client, event("Hello?"))
    # Within the cooldown the bot stays quiet so it doesn't talk over the lawyer.
    assert len(_sent(env)) == before


def test_team_group_commands(client, env):
    with db.session_scope() as s:
        from app.models import Tenant
        t = s.query(Tenant).one()
        c = Contact(tenant_id=t.id, kind="lead", name="Omar Khalid", phone="+971559999999")
        s.add(c)
        s.flush()
        s.add(Matter(tenant_id=t.id, number=7, client_id=c.id, title="Rental dispute",
                     adverse_parties=["Blue Sky Real Estate"]))

    post_event(client, event("/conflict blue sky real estate", sender=LAWYER, group=TEAM_GROUP))
    assert "adverse party in M-7" in _sent(env)[-1]["body"]
    assert _sent(env)[-1]["to"] == TEAM_GROUP

    post_event(client, event("/time 1h30m M-7 reviewed lease", sender=LAWYER, group=TEAM_GROUP))
    assert "Logged 1h30m on M-7" in _sent(env)[-1]["body"]

    post_event(client, event("/accept M-7", sender=LAWYER, group=TEAM_GROUP))
    post_event(client, event("/mute M-7", sender=LAWYER, group=TEAM_GROUP))
    post_event(client, event("/hours M-7", sender=LAWYER, group=TEAM_GROUP))
    assert "1h30m total" in _sent(env)[-1]["body"]

    with db.session_scope() as s:
        m = s.query(Matter).filter_by(number=7).one()
        assert m.status == "open" and m.client.kind == "client" and m.client.bot_muted
        assert s.query(TimeEntry).one().minutes == 90

    # Muted client: logged, no reply.
    before = len(_sent(env))
    post_event(client, event("Hi, any news?", sender="+971559999999", name="Omar"))
    assert len(_sent(env)) == before


def test_non_command_chatter_in_team_group_is_only_logged(client, env):
    post_event(client, event("lunch at 1?", sender=LAWYER, group=TEAM_GROUP))
    assert _sent(env) == []
    with db.session_scope() as s:
        assert s.query(Message).filter_by(group_id=TEAM_GROUP).count() == 1


def test_draft_uses_draft_model(client, env):
    env["llm"].queue("DRAFT – FOR LAWYER REVIEW – NOT LEGAL ADVICE\n\nEngagement letter...")
    post_event(client, event("/draft engagement letter, fixed fee AED 10,000",
                             sender=LAWYER, group=TEAM_GROUP))
    assert env["llm"].calls[-1]["model"] == "draft-model"
    assert _sent(env)[-1]["body"].startswith("DRAFT")


def test_unknown_business_number_is_ignored(client, env):
    evt = event("hi")
    evt["data"]["to"]["phone_number"] = "+10000000000"
    post_event(client, evt)
    assert _sent(env) == []


def test_parse_duration():
    assert parse_duration("1h30m") == 90
    assert parse_duration("1.5h") == 90
    assert parse_duration("45m") == 45
    assert parse_duration("20") == 20
    assert parse_duration("abc") is None


def test_admin_and_dashboard(client, env):
    env["llm"].queue(_intake_reply("Thank you.", complete=True, full_name="Sara Ahmed",
                                   practice_area="Family", description="Custody question",
                                   adverse_parties=["Khalid Ahmed"], urgency="urgent"))
    post_event(client, event("custody"))
    post_event(client, event("/time 30m M-1 first call", sender=LAWYER, group=TEAM_GROUP))

    assert client.put("/admin/tenants", json={}).status_code == 401
    resp = client.put("/admin/tenants", headers={"Authorization": "Bearer admin-test"}, json={
        "name": "Second Firm", "slug": "second", "whatsapp_number": "00971 50 000 0002",
        "team_phones": ["+971500000003"]})
    assert resp.status_code == 200 and resp.json()["whatsapp_number"] == "+971500000002"

    assert client.get("/dashboard", follow_redirects=False).status_code == 303
    client.post("/login", data={"password": "dash-test"})
    page = client.get("/dashboard")
    assert page.status_code == 200 and "Al Noor Advocates" in page.text
    assert "M-1" in page.text and "Khalid Ahmed" in page.text and "urgent" in page.text
    assert "30m" in page.text and "first call" in page.text
