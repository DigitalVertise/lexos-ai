"""Slash commands for the firm's team, used in the team WhatsApp group or in a
direct chat with the firm's number from a registered team member's phone."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable

from sqlalchemy import func, select

from .. import conflicts
from ..context import Ctx
from ..models import Matter, Message, TimeEntry

log = logging.getLogger(__name__)

HELP = """*LexOS commands*
/conflict <name> – screen a person or company
/leads – latest intakes
/matter M-12 – matter details
/client M-12 – client card (contact, language, last message)
/reply M-12 <message> – reply to the client from the firm's number (AI pauses)
/accept M-12 – open the matter, lead becomes client
/decline M-12 – decline the matter
/mute M-12 – AI stops replying to that client (you take over)
/unmute M-12 – AI resumes
/time 1h30m M-12 <note> – log time
/hours M-12 – time logged on a matter
/draft <document> <details> – first draft for lawyer review
/help – this list"""

DRAFT_SYSTEM = """You are a drafting assistant at {firm_name}, a law firm in the UAE.
Produce a clear, well-structured FIRST DRAFT of the requested document for a
lawyer to review. Use the jurisdiction indicated (default: UAE onshore law;
mention DIFC/ADGM only if requested). Mark every fact you had to assume as
[TO CONFIRM: ...]. Do not invent statute article numbers; write
[CITE: relevant provision] instead. Plain text only (WhatsApp), no markdown
tables. Start with the line: DRAFT – FOR LAWYER REVIEW – NOT LEGAL ADVICE"""

_DURATION = re.compile(r"^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m(?:in)?)?$", re.I)
_MATTER_REF = re.compile(r"^(?:m-?|#)(\d+)$", re.I)


def parse_duration(token: str) -> int | None:
    """'1h30m' -> 90, '1.5h' -> 90, '45m' -> 45, '20' -> 20 (minutes)."""
    token = token.strip().lower()
    if token.isdigit():
        return int(token)
    m = _DURATION.match(token)
    if not m or not (m.group(1) or m.group(2)):
        return None
    hours = float(m.group(1) or 0)
    minutes = int(m.group(2) or 0)
    total = round(hours * 60) + minutes
    return total or None


def _fmt_minutes(minutes: int) -> str:
    h, m = divmod(minutes, 60)
    return f"{h}h{m:02d}m" if h else f"{m}m"


def _matter_or_reply(ctx: Ctx, ref: str) -> Matter | None:
    matter = ctx.find_matter(ref)
    if matter is None:
        ctx.reply(f"I can't find matter {ref or '(none given)'}. Try /leads.")
    return matter


# -- handlers ----------------------------------------------------------------

def cmd_help(ctx: Ctx, args: str) -> None:
    ctx.reply(HELP)


def cmd_conflict(ctx: Ctx, args: str) -> None:
    name = args.strip()
    if not name:
        ctx.reply("Usage: /conflict <person or company name>")
        return
    hits = conflicts.check(ctx.session, ctx.tenant.id, name)
    if not hits:
        ctx.reply(f"✅ No matches for “{name}”.\n(Screening only — confirm before engagement.)")
        return
    lines = [f"⚠️ {len(hits)} possible match(es) for “{name}”:"]
    for h in hits[:10]:
        lines.append(f"• {h.name} — {h.source} ({int(h.score * 100)}%)")
    ctx.reply("\n".join(lines))


def cmd_leads(ctx: Ctx, args: str) -> None:
    rows = ctx.session.scalars(
        select(Matter).where(Matter.tenant_id == ctx.tenant.id)
        .order_by(Matter.number.desc()).limit(10)
    ).all()
    if not rows:
        ctx.reply("No intakes yet.")
        return
    lines = ["*Latest matters*"]
    for m in rows:
        flag = " ⚠️" if m.conflict_hits else ""
        urgent = " 🚨" if m.urgency == "urgent" else ""
        who = m.client.name if m.client else "-"
        lines.append(f"{m.ref} · {m.status}{flag}{urgent} · {who} · {m.practice_area or '-'}")
    ctx.reply("\n".join(lines))


def cmd_matter(ctx: Ctx, args: str) -> None:
    matter = _matter_or_reply(ctx, args.strip())
    if not matter:
        return
    client = matter.client
    lines = [
        f"*{matter.ref}* — {matter.title}",
        f"Status: {matter.status} · Urgency: {matter.urgency or '-'}",
        f"Client: {client.name if client else '-'} ({(client.phone or client.bsuid) if client else '-'})",
        f"Other side: {', '.join(matter.adverse_parties) or '-'}",
        f"Summary: {matter.summary or '-'}",
    ]
    if matter.conflict_hits:
        lines.append("Conflict matches: " + "; ".join(
            f"{h['name']} ({h['source']})" for h in matter.conflict_hits[:5]))
    ctx.reply("\n".join(lines))


def cmd_client(ctx: Ctx, args: str) -> None:
    matter = _matter_or_reply(ctx, args.strip())
    if not matter:
        return
    client = matter.client
    if client is None:
        ctx.reply(f"{matter.ref} has no client attached.")
        return
    last_in = ctx.session.scalar(
        select(func.max(Message.created_at)).where(
            Message.tenant_id == ctx.tenant.id, Message.contact_id == client.id,
            Message.direction == "inbound"))
    files = ctx.session.scalar(
        select(func.count()).select_from(Message).where(
            Message.tenant_id == ctx.tenant.id, Message.contact_id == client.id,
            Message.media_kind.is_not(None)))
    open_matters = ctx.session.scalars(
        select(Matter).where(Matter.tenant_id == ctx.tenant.id, Matter.client_id == client.id)
        .order_by(Matter.number)).all()
    lines = [
        f"*{client.name or 'Unnamed'}* ({client.kind})",
        f"Phone: {client.phone or client.bsuid or '-'} · Email: {client.email or '-'}",
        f"Language: {client.language or '-'} · AI: {'paused' if client.bot_muted else 'active'}",
        f"Last message: {last_in.strftime('%Y-%m-%d %H:%M UTC') if last_in else '-'}"
        + ("" if ctx.window_open(client) else " (24h window closed: replies use the follow-up template)"),
        f"Files received: {files or 0}",
        "Matters: " + ", ".join(f"{m.ref} ({m.status})" for m in open_matters),
    ]
    if client.lexos_client_id:
        lines.append("In LexOS: yes" + (f" · M-{matter.lexos_matter_number}" if matter.lexos_matter_number else ""))
    ctx.reply("\n".join(lines))


def cmd_reply(ctx: Ctx, args: str) -> None:
    ref, _, body = args.strip().partition(" ")
    body = body.strip()
    if not ref or not body:
        ctx.reply("Usage: /reply M-12 Your message to the client")
        return
    matter = _matter_or_reply(ctx, ref)
    if not matter:
        return
    client = matter.client
    target = client and (client.phone or client.bsuid)
    if not target:
        ctx.reply(f"{matter.ref} has no client number to reply to.")
        return
    # A lawyer is now talking to the client: the AI steps back.
    client.bot_muted = True
    if ctx.send(target, body, contact=client):
        ctx.reply(f"✉️ Sent to {client.name or target}. AI paused for this client (/unmute {matter.ref} to resume).")


def _set_status(ctx: Ctx, args: str, status: str) -> Matter | None:
    matter = _matter_or_reply(ctx, args.strip().split(" ")[0] if args.strip() else "")
    if not matter:
        return None
    matter.status = status
    return matter


def cmd_accept(ctx: Ctx, args: str) -> None:
    matter = _set_status(ctx, args, "open")
    if not matter:
        return
    if matter.client:
        matter.client.kind = "client"
    ctx.reply(f"✅ {matter.ref} is now open. {matter.client.name if matter.client else ''} is a client.")


def cmd_decline(ctx: Ctx, args: str) -> None:
    matter = _set_status(ctx, args, "declined")
    if matter:
        ctx.reply(f"{matter.ref} marked as declined. Remember to inform the prospect.")


def _mute(ctx: Ctx, args: str, muted: bool) -> None:
    matter = _matter_or_reply(ctx, args.strip())
    if not matter or not matter.client:
        return
    matter.client.bot_muted = muted
    if muted:
        ctx.reply(f"🔇 AI paused for {matter.client.name}. You have the conversation.")
    else:
        ctx.reply(f"🔊 AI resumed for {matter.client.name}.")


def cmd_mute(ctx: Ctx, args: str) -> None:
    _mute(ctx, args, True)


def cmd_unmute(ctx: Ctx, args: str) -> None:
    _mute(ctx, args, False)


def cmd_time(ctx: Ctx, args: str) -> None:
    parts = args.split()
    if not parts or (minutes := parse_duration(parts[0])) is None:
        ctx.reply("Usage: /time 1h30m M-12 call with client")
        return
    matter = None
    rest = parts[1:]
    if rest and _MATTER_REF.match(rest[0]):
        matter = ctx.find_matter(rest[0])
        if matter is None:
            ctx.reply(f"I can't find matter {rest[0]}.")
            return
        rest = rest[1:]
    description = " ".join(rest)
    ctx.session.add(TimeEntry(
        tenant_id=ctx.tenant.id,
        matter_id=matter.id if matter else None,
        author_id=ctx.sender.id,
        minutes=minutes,
        description=description,
    ))
    where = f" on {matter.ref}" if matter else " (no matter)"
    ctx.reply(f"⏱️ Logged {_fmt_minutes(minutes)}{where} for {ctx.sender.name or 'you'}"
              + (f": {description}" if description else ""))


def cmd_hours(ctx: Ctx, args: str) -> None:
    matter = _matter_or_reply(ctx, args.strip())
    if not matter:
        return
    entries = ctx.session.scalars(
        select(TimeEntry).where(TimeEntry.tenant_id == ctx.tenant.id,
                                TimeEntry.matter_id == matter.id)
        .order_by(TimeEntry.created_at)
    ).all()
    total = sum(e.minutes for e in entries)
    lines = [f"*{matter.ref}* — {_fmt_minutes(total)} total"]
    for e in entries[-10:]:
        who = e.author.name if e.author else "?"
        lines.append(f"• {_fmt_minutes(e.minutes)} {who}: {e.description or '-'}")
    ctx.reply("\n".join(lines))


def cmd_draft(ctx: Ctx, args: str) -> None:
    request = args.strip()
    if len(request) < 10:
        ctx.reply("Usage: /draft engagement letter for M-12, fixed fee AED 15,000, "
                  "scope: commercial dispute at Dubai Courts")
        return
    # Give the model the matter context if a matter is referenced.
    context = ""
    ref = re.search(r"\bM-?(\d+)\b", request, re.I)
    if ref and (matter := ctx.find_matter(ref.group(0))):
        client = matter.client
        context = (f"\n\nMatter {matter.ref}: {matter.title}\nClient: {client.name if client else '-'}"
                   f"\nOther side: {', '.join(matter.adverse_parties) or '-'}"
                   f"\nSummary: {matter.summary or '-'}")
    ctx.reply("✍️ Drafting… this can take a minute.")
    try:
        draft = ctx.llm.complete(
            DRAFT_SYSTEM.format(firm_name=ctx.tenant.name),
            [{"role": "user", "content": request + context}],
            model=ctx.draft_model,
            max_tokens=3000,
        )
    except Exception:
        log.exception("Draft generation failed")
        ctx.reply("Sorry, drafting failed. Please try again in a moment.")
        return
    ctx.reply(draft.strip())


COMMANDS: dict[str, Callable[[Ctx, str], None]] = {
    "help": cmd_help,
    "conflict": cmd_conflict,
    "leads": cmd_leads,
    "matter": cmd_matter,
    "client": cmd_client,
    "reply": cmd_reply,
    "accept": cmd_accept,
    "decline": cmd_decline,
    "mute": cmd_mute,
    "unmute": cmd_unmute,
    "time": cmd_time,
    "hours": cmd_hours,
    "draft": cmd_draft,
}


def is_command(text: str) -> bool:
    return text.startswith("/")


def handle(ctx: Ctx) -> None:
    text = ctx.msg.text.strip()
    name, _, args = text[1:].partition(" ")
    handler = COMMANDS.get(name.lower().split("@")[0])
    if handler is None:
        ctx.reply(f"Unknown command /{name}. Send /help for the list.")
        return
    handler(ctx, args)
