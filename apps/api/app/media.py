"""Inbound WhatsApp media: voice-note transcription and language detection."""

from __future__ import annotations

import io
import logging
import re
from collections.abc import Callable

from .config import Settings

log = logging.getLogger(__name__)

# Speech-to-text providers accept these containers (Whisper-compatible APIs).
_EXT = {
    "audio/ogg": "ogg", "audio/opus": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a",
    "audio/aac": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav", "audio/webm": "webm",
    "audio/amr": "amr",
}

Transcriber = Callable[[bytes, str], str]


def extension_for(mime: str) -> str:
    base = (mime or "").split(";")[0].strip().lower()
    return _EXT.get(base, "ogg")


def build_transcriber(settings: Settings) -> Transcriber | None:
    """LiteLLM transcription with the configured STT model, or None if disabled."""
    if not settings.stt_model:
        return None

    def transcribe(data: bytes, mime: str) -> str:
        import litellm  # heavy; lazy

        f = io.BytesIO(data)
        f.name = f"voice.{extension_for(mime)}"
        resp = litellm.transcription(model=settings.stt_model, file=f,
                                     timeout=settings.llm_timeout, **settings.llm_kwargs)
        return (getattr(resp, "text", None) or (resp.get("text") if isinstance(resp, dict) else "") or "").strip()

    return transcribe


_ARABIC = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")
_LATIN = re.compile(r"[A-Za-z]")


def detect_language(text: str) -> str | None:
    """'ar' or 'en' from the script used, or None if there is no signal."""
    ar, en = len(_ARABIC.findall(text or "")), len(_LATIN.findall(text or ""))
    if ar == en == 0:
        return None
    return "ar" if ar >= en else "en"
