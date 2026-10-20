"""Conflict-of-interest check.

Searches every contact and every matter's adverse parties in the firm's
database for names similar to the query. It is a screening aid: a hit means
"a lawyer must review", never "conflict confirmed", and no hit does not clear
a matter on its own.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Contact, Matter

# Common legal suffixes that should not drive a match.
_STOPWORDS = {
    "llc", "l.l.c", "ltd", "limited", "fz", "fze", "fzco", "fzllc", "dmcc", "pjsc", "psc",
    "co", "company", "inc", "corp", "plc", "the", "and", "group", "holding", "holdings",
    "trading", "est", "establishment", "mr", "mrs", "ms", "dr",
}
# Arabic diacritics (harakat) and tatweel.
_AR_MARKS = re.compile(r"[ً-ٰٟـ]")
_AR_FOLD = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ة": "ه", "ى": "ي"})


def normalize(name: str) -> str:
    name = unicodedata.normalize("NFKC", name or "").lower()
    name = _AR_MARKS.sub("", name).translate(_AR_FOLD)
    name = re.sub(r"[^\w\s]", " ", name)
    tokens = [t for t in name.split() if t not in _STOPWORDS]
    return " ".join(tokens)


def similarity(a: str, b: str) -> float:
    na, nb = normalize(a), normalize(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    ta, tb = set(na.split()), set(nb.split())
    # All tokens of the shorter name appear in the longer one ("Ahmed Ali" vs
    # "Ahmed Ali Hassan"): strong signal, but below an exact match.
    if ta and tb and (ta <= tb or tb <= ta):
        return 0.9
    return SequenceMatcher(None, na, nb).ratio()


@dataclass
class ConflictHit:
    name: str
    score: float
    source: str  # "client", "lead", "opposing", "team", "adverse party in M-3"...
    matter_ref: str | None = None

    def as_dict(self) -> dict:
        return {"name": self.name, "score": round(self.score, 2), "source": self.source,
                "matter": self.matter_ref}


def check(session: Session, tenant_id: str, query: str, threshold: float = 0.82,
          exclude_matter_id: str | None = None,
          exclude_contact_id: str | None = None) -> list[ConflictHit]:
    hits: list[ConflictHit] = []
    if not normalize(query):
        return hits

    for c in session.scalars(select(Contact).where(Contact.tenant_id == tenant_id)):
        if c.id == exclude_contact_id:
            continue
        if c.name and (score := similarity(query, c.name)) >= threshold:
            hits.append(ConflictHit(c.name, score, c.kind))

    stmt = select(Matter).where(Matter.tenant_id == tenant_id)
    for m in session.scalars(stmt):
        if m.id == exclude_matter_id:
            continue
        for party in m.adverse_parties or []:
            if (score := similarity(query, party)) >= threshold:
                hits.append(ConflictHit(party, score, f"adverse party in {m.ref}", m.ref))
        if (m.client and m.client.name and m.client_id != exclude_contact_id
                and (score := similarity(query, m.client.name)) >= threshold):
            hits.append(ConflictHit(m.client.name, score, f"client in {m.ref}", m.ref))

    # De-duplicate (same name + source), best score first.
    seen: set[tuple[str, str]] = set()
    unique: list[ConflictHit] = []
    for h in sorted(hits, key=lambda h: -h.score):
        key = (normalize(h.name), h.source)
        if key not in seen:
            seen.add(key)
            unique.append(h)
    return unique
