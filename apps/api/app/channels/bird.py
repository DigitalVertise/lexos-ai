"""Bird WhatsApp integration: webhook signature verification and sending.

Docs:
- Webhook signing (Standard Webhooks): https://bird.com/docs/guides/webhooks
- Inbound payload: https://bird.com/docs/guides/whatsapp/webhooks/messages
- Group messages: https://bird.com/docs/guides/whatsapp/groups/receiving
- Send API: https://bird.com/docs/api/reference/create-whatsapp-message
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import time
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

log = logging.getLogger(__name__)

# WhatsApp caps a text body at 4096 characters; stay a little under.
MAX_TEXT = 4000


class SignatureError(Exception):
    pass


def verify_signature(
    secret: str,
    headers: dict[str, str],
    body: bytes,
    tolerance: int = 300,
    now: float | None = None,
) -> str:
    """Verify a Standard Webhooks signature. Returns the delivery ID.

    Signed content is ``{webhook-id}.{webhook-timestamp}.{raw body}``, HMAC-SHA256,
    keyed with the base64-decoded secret after stripping ``whsec_``.
    """
    h = {k.lower(): v for k, v in headers.items()}
    msg_id = h.get("webhook-id")
    ts = h.get("webhook-timestamp")
    sig_header = h.get("webhook-signature")
    if not (msg_id and ts and sig_header):
        raise SignatureError("missing webhook headers")
    try:
        ts_int = int(ts)
    except ValueError as exc:
        raise SignatureError("bad timestamp") from exc
    now = time.time() if now is None else now
    if abs(now - ts_int) > tolerance:
        raise SignatureError("timestamp outside tolerance")

    raw_secret = secret[len("whsec_"):] if secret.startswith("whsec_") else secret
    try:
        key = base64.b64decode(raw_secret)
    except Exception as exc:  # pragma: no cover - misconfiguration
        raise SignatureError("webhook secret is not valid base64") from exc

    signed = f"{msg_id}.{ts}.".encode() + body
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()

    # Header may hold several space-separated "v1,<sig>" entries (secret rotation).
    for part in sig_header.split():
        version, _, value = part.partition(",")
        if version == "v1" and hmac.compare_digest(value, expected):
            return msg_id
    raise SignatureError("signature mismatch")


def sign(secret: str, msg_id: str, ts: int, body: bytes) -> str:
    """Produce a signature header value. Used by tests and local tooling."""
    raw_secret = secret[len("whsec_"):] if secret.startswith("whsec_") else secret
    key = base64.b64decode(raw_secret)
    signed = f"{msg_id}.{ts}.".encode() + body
    return "v1," + base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()


@dataclass
class InboundMessage:
    """The parts of a whatsapp.received event the router needs."""

    provider_id: str
    business_number: str  # data.to.phone_number
    sender_phone: str | None
    sender_bsuid: str | None
    sender_name: str | None
    group_id: str | None  # data.to.group_id; present only for group messages
    text: str  # text body, or a short placeholder for non-text content
    kind: str  # text | interactive | media | location | other

    @property
    def sender_key(self) -> str:
        return self.sender_phone or self.sender_bsuid or "unknown"


def parse_received(event: dict[str, Any]) -> InboundMessage | None:
    """Turn a webhook envelope into an InboundMessage, or None if not handled."""
    if event.get("type") != "whatsapp.received":
        return None
    data = event.get("data") or {}
    if data.get("direction") != "inbound":
        return None
    sender = data.get("from") or {}
    to = data.get("to") or {}

    if text := (data.get("text") or {}).get("body"):
        kind = "text"
    elif reply := data.get("interactive_reply"):
        kind = "interactive"
        rtype = reply.get("type")
        arm = reply.get(rtype) if isinstance(reply.get(rtype), dict) else {}
        text = arm.get("text") or arm.get("slug") or ""
    elif any(data.get(k) for k in ("image", "video", "audio", "document", "sticker")):
        kind = "media"
        media = next(data[k] for k in ("image", "video", "audio", "document", "sticker") if data.get(k))
        caption = media.get("caption") if isinstance(media, dict) else None
        text = caption or "[attachment]"
    elif data.get("location"):
        kind, text = "location", "[location]"
    else:
        kind, text = "other", "[unsupported message]"

    return InboundMessage(
        provider_id=data.get("whatsapp_id", ""),
        business_number=to.get("phone_number", ""),
        sender_phone=sender.get("phone_number"),
        sender_bsuid=sender.get("bsuid"),
        sender_name=sender.get("display_name") or sender.get("username"),
        group_id=to.get("group_id"),
        text=text.strip(),
        kind=kind,
    )


def chunk_text(body: str, limit: int = MAX_TEXT) -> list[str]:
    """Split long text on paragraph/line boundaries to fit WhatsApp's limit."""
    if len(body) <= limit:
        return [body]
    chunks: list[str] = []
    current = ""
    for para in body.split("\n"):
        candidate = f"{current}\n{para}" if current else para
        if len(candidate) <= limit:
            current = candidate
            continue
        if current:
            chunks.append(current)
        while len(para) > limit:
            chunks.append(para[:limit])
            para = para[limit:]
        current = para
    if current:
        chunks.append(current)
    return chunks


class Messenger(Protocol):
    def send_text(self, to: str, body: str, from_number: str | None = None,
                  reply_to: str | None = None) -> list[str]: ...


class BirdClient:
    """Minimal Bird WhatsApp sender."""

    def __init__(self, api_key: str, base_url: str, timeout: float = 20.0):
        self.base_url = base_url.rstrip("/")
        self._client = httpx.Client(
            timeout=timeout,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )

    def send_text(self, to: str, body: str, from_number: str | None = None,
                  reply_to: str | None = None) -> list[str]:
        """Send free-form text. Group IDs (wag_...) are sent without ``from``.

        Returns the Bird message IDs of the sent chunks.
        """
        ids: list[str] = []
        is_group = to.startswith("wag_")
        for i, part in enumerate(chunk_text(body)):
            payload: dict[str, Any] = {"to": to, "text": {"body": part}}
            if not is_group:
                if not from_number:
                    raise ValueError("from_number is required for one-to-one sends")
                payload["from"] = from_number
            if reply_to and i == 0:
                payload["in_reply_to_message_id"] = reply_to
            resp = self._client.post(f"{self.base_url}/v1/whatsapp/messages", json=payload)
            if resp.status_code >= 400:
                log.error("Bird send failed: %s %s", resp.status_code, resp.text[:500])
                resp.raise_for_status()
            ids.append(resp.json().get("id", ""))
        return ids


class NullMessenger:
    """Used when no Bird key is configured (local dev): logs instead of sending."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def send_text(self, to: str, body: str, from_number: str | None = None,
                  reply_to: str | None = None) -> list[str]:
        self.sent.append({"to": to, "body": body, "from": from_number, "reply_to": reply_to})
        log.info("[dry-run] would send %d chars to %s", len(body), to)
        return [f"dry_{len(self.sent)}"]
