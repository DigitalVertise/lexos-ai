import time

import pytest

from app.channels.bird import SignatureError, chunk_text, parse_received, sign, verify_signature

from .conftest import SECRET, event


def test_signature_roundtrip():
    body = b'{"type":"whatsapp.received"}'
    ts = int(time.time())
    headers = {"webhook-id": "msg_1", "webhook-timestamp": str(ts),
               "webhook-signature": sign(SECRET, "msg_1", ts, body)}
    assert verify_signature(SECRET, headers, body) == "msg_1"


def test_signature_accepts_any_of_several_during_rotation():
    body, ts = b"{}", int(time.time())
    good = sign(SECRET, "msg_2", ts, body)
    headers = {"webhook-id": "msg_2", "webhook-timestamp": str(ts),
               "webhook-signature": f"v1,AAAAbad= {good}"}
    assert verify_signature(SECRET, headers, body) == "msg_2"


@pytest.mark.parametrize("mutate", ["body", "old", "missing"])
def test_signature_rejections(mutate):
    body, ts = b'{"a":1}', int(time.time())
    headers = {"webhook-id": "msg_3", "webhook-timestamp": str(ts),
               "webhook-signature": sign(SECRET, "msg_3", ts, body)}
    if mutate == "body":
        body = b'{"a":2}'
    elif mutate == "old":
        headers["webhook-timestamp"] = str(ts - 3600)
    else:
        del headers["webhook-signature"]
    with pytest.raises(SignatureError):
        verify_signature(SECRET, headers, body)


def test_parse_group_message():
    msg = parse_received(event("/help", group="wag_x"))
    assert msg.group_id == "wag_x" and msg.text == "/help" and msg.kind == "text"


def test_parse_ignores_other_events():
    assert parse_received({"type": "whatsapp.delivered", "data": {}}) is None


def test_parse_media_uses_caption():
    evt = event("x")
    del evt["data"]["text"]
    evt["data"]["document"] = {"id": "waf_1", "url": "https://us1.platform.bird.com/v1/whatsapp/messages/wam_x/media/waf_1",
                               "mime_type": "application/pdf", "filename": "lease.pdf", "caption": "my contract"}
    msg = parse_received(evt)
    assert msg.kind == "document" and msg.is_media
    assert msg.text == "[document: lease.pdf] my contract"
    assert msg.media_filename == "lease.pdf" and msg.media_mime == "application/pdf" and msg.media_id == "waf_1"


def test_parse_voice_note_and_image():
    evt = event("x")
    del evt["data"]["text"]
    evt["data"]["audio"] = {"id": "waf_2", "url": "https://us1.platform.bird.com/m", "mime_type": "audio/ogg; codecs=opus", "voice": True}
    msg = parse_received(evt)
    assert msg.kind == "audio" and msg.voice and msg.text == "[voice note]"
    evt2 = event("x")
    del evt2["data"]["text"]
    evt2["data"]["image"] = {"id": "waf_3", "url": "https://us1.platform.bird.com/i", "mime_type": "image/jpeg"}
    img = parse_received(evt2)
    assert img.kind == "image" and img.text == "[image]" and img.caption is None


def test_chunk_text_respects_limit():
    body = "\n".join(["x" * 900] * 10)
    parts = chunk_text(body, limit=4000)
    assert all(len(p) <= 4000 for p in parts)
    assert "".join(p.replace("\n", "") for p in parts) == body.replace("\n", "")
