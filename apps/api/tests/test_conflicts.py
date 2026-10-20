from app import db
from app.conflicts import check, normalize, similarity
from app.models import Contact, Matter, Tenant


def test_normalize_strips_company_suffixes_and_arabic_marks():
    assert normalize("Emaar Properties PJSC") == "emaar properties"
    assert normalize("أَحْمَد") == normalize("احمد")


def test_similarity():
    assert similarity("Ahmed Ali", "ahmed  ali") == 1.0
    assert similarity("Ahmed Ali", "Ahmed Ali Hassan") == 0.9
    assert similarity("Ahmed Ali", "Fatima Noor") < 0.5


def test_check_finds_adverse_party_and_contact(env):
    with db.session_scope() as s:
        tenant = s.query(Tenant).one()
        client = Contact(tenant_id=tenant.id, kind="client", name="Gulf Star Trading LLC")
        s.add(client)
        s.flush()
        s.add(Matter(tenant_id=tenant.id, number=1, client_id=client.id, title="Dispute",
                     adverse_parties=["Omar Khalid"]))
    with db.session_scope() as s:
        tenant = s.query(Tenant).one()
        hits = check(s, tenant.id, "omar khalid")
        assert [h.source for h in hits] == ["adverse party in M-1"]
        hits = check(s, tenant.id, "Gulf Star Trading")
        assert {h.source for h in hits} == {"client", "client in M-1"}
        assert check(s, tenant.id, "Unrelated Person") == []
