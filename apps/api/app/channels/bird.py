"""Bird WhatsApp integration: webhook signature verification and sending.

Docs:
- Webhook signing (Standard Webhooks): https://bird.com/docs/guides/webhooks
- Inbound payload: https://bird.com/docs/guides/whatsapp/webhooks/messages
- Group messages: https://bird.com/docs/guides/whatsapp/groups/receiving
- Send API: https://bird.com/docs/api/reference/create-whatsapp-message
- Inbound media: https://bird.com/docs/guides/whatsapp/receiving-whatsapp (audio/images/documents)
- Media download: https://bird.com/docs/api/reference/get-whatsapp-message-media
- 24-hour window: https://bird.com/docs/guides/whatsapp/sending-whatsapp#the-customer-service-window
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


class WindowClosedError(Exception):
    """Bird refused a free-form send: the 24-hour service window is closed (422 E15044)."""


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
    kind: str  # text | interactive | audio | image | video | document | sticker | location | other
    # Media (inbound audio/image/video/document/sticker), per Bird's receiving guides.
    media_id: str | None = None
    media_url: str | None = None
    media_mime: str | None = None
    media_filename: str | None = None
    caption: str | None = None
    voice: bool = False  # True for a voice note recorded in the chat

    @property
    def is_media(self) -> bool:
        return self.kind in MEDIA_KINDS

    @property
    def sender_key(self) -> str:
        return self.sender_phone or self.sender_bsuid or "unknown"


MEDIA_KINDS = ("audio", "image", "video", "document", "sticker")


def parse_received(event: dict[str, Any]) -> InboundMessage | None:
    """Turn a webhook envelope into an InboundMessage, or None if not handled."""
    if event.get("type") != "whatsapp.received":
        return None
    data = event.get("data") or {}
    if data.get("direction") != "inbound":
        return None
    sender = data.get("from") or {}
    to = data.get("to") or {}

    media_fields: dict[str, Any] = {}
    if text := (data.get("text") or {}).get("body"):
        kind = "text"
    elif reply := data.get("interactive_reply"):
        kind = "interactive"
        rtype = reply.get("type")
        arm = reply.get(rtype) if isinstance(reply.get(rtype), dict) else {}
        text = arm.get("text") or arm.get("slug") or ""
    elif media_kind := next((k for k in MEDIA_KINDS if isinstance(data.get(k), dict)), None):
        kind = media_kind
        media = data[media_kind]
        media_fields = {
            "media_id": media.get("id"),
            "media_url": media.get("url"),
            "media_mime": media.get("mime_type"),
            "media_filename": media.get("filename"),
            "caption": (media.get("caption") or "").strip() or None,
            "voice": bool(media.get("voice")),
        }
        if media_kind == "audio":
            text = "[voice note]" if media_fields["voice"] else "[audio file]"
        elif media_kind == "document":
            name = media_fields["media_filename"] or "document"
            text = f"[document: {name}]" + (f" {media_fields['caption']}" if media_fields["caption"] else "")
        else:
            text = media_fields["caption"] or f"[{media_kind}]"
    elif data.get("location"):
        kind, text = "location", "[location]"
    else:
        kind, text = "other", "[unsupported message]"

    return InboundMessage(
        **(media_fields if kind in MEDIA_KINDS else {}),
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

    def send_template(self, to: str, from_number: str, slug: str, language: str | None = None,
                      body_params: list[str] | None = None) -> str: ...

    def download_media(self, url: str) -> tuple[bytes, str]: ...


def _is_window_closed(resp: httpx.Response) -> bool:
    return resp.status_code == 422 and ("E15044" in resp.text or "WhatsAppServiceWindowClosed" in resp.text)


MAX_MEDIA_BYTES = 25 * 1024 * 1024


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
            if _is_window_closed(resp):
                raise WindowClosedError(to)
            if resp.status_code >= 400:
                log.error("Bird send failed: %s %s", resp.status_code, resp.text[:500])
                resp.raise_for_status()
            ids.append(resp.json().get("id", ""))
        return ids

    def send_template(self, to: str, from_number: str, slug: str, language: str | None = None,
                      body_params: list[str] | None = None) -> str:
        """Send an approved template (reaches the contact outside the 24-hour window)."""
        template: dict[str, Any] = {"slug": slug}
        if language:
            template["language"] = language
        if body_params:
            template["components"] = [{"type": "body", "parameters": [
                {"type": "text", "text": p[:1000]} for p in body_params]}]
        resp = self._client.post(f"{self.base_url}/v1/whatsapp/messages",
                                 json={"to": to, "from": from_number, "template": template})
        if resp.status_code >= 400:
            log.error("Bird template send failed: %s %s", resp.status_code, resp.text[:500])
            resp.raise_for_status()
        return resp.json().get("id", "")

    def download_media(self, url: str) -> tuple[bytes, str]:
        """Fetch inbound media. Bird answers with a 302 to a pre-signed storage URL,
        which must be fetched WITHOUT the Authorization header."""
        if not url.startswith(("https://", "http://localhost")) or ".bird.com/" not in url + "/" and "localhost" not in url:
            raise ValueError("unexpected media URL")
        first = self._client.get(url, follow_redirects=False)
        if first.status_code in (301, 302, 303, 307, 308):
            location = first.headers.get("location", "")
            with httpx.Client(timeout=60.0, follow_redirects=True) as anon:
                resp = anon.get(location)
        else:
            resp = first
        resp.raise_for_status()
        if len(resp.content) > MAX_MEDIA_BYTES:
            raise ValueError("media too large")
        return resp.content, resp.headers.get("content-type", "application/octet-stream")


class NullMessenger:
    """Used when no Bird key is configured (local dev): logs instead of sending."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

        self.templates: list[dict[str, Any]] = []
        # Tests can fill these: recipients whose window is closed, and media bytes by URL.
        self.closed_windows: set[str] = set()
        self.media: dict[str, tuple[bytes, str]] = {}

    def send_text(self, to: str, body: str, from_number: str | None = None,
                  reply_to: str | None = None) -> list[str]:
        if to in self.closed_windows:
            raise WindowClosedError(to)
        self.sent.append({"to": to, "body": body, "from": from_number, "reply_to": reply_to})
        log.info("[dry-run] would send %d chars to %s", len(body), to)
        return [f"dry_{len(self.sent)}"]

    def send_template(self, to: str, from_number: str, slug: str, language: str | None = None,
                      body_params: list[str] | None = None) -> str:
        self.templates.append({"to": to, "from": from_number, "slug": slug,
                               "language": language, "params": body_params})
        return f"dry_tpl_{len(self.templates)}"

    def download_media(self, url: str) -> tuple[bytes, str]:
        if url not in self.media:
            raise ValueError("no media in dry-run")
        return self.media[url]
