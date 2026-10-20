"""Free neural text-to-speech via edge-tts (Microsoft Edge online voices).

No API key. Arabic and English voices; the voice is picked from the text's
script unless the caller asks for a specific one from CURATED_VOICES.
"""

from __future__ import annotations

import re

from ..config import get_settings


class VoiceError(Exception):
    pass


CURATED_VOICES = [
    {"id": "en-US-AndrewMultilingualNeural", "label": "Andrew (English, US, male)"},
    {"id": "en-US-AvaMultilingualNeural", "label": "Ava (English, US, female)"},
    {"id": "en-GB-RyanNeural", "label": "Ryan (English, UK, male)"},
    {"id": "en-GB-SoniaNeural", "label": "Sonia (English, UK, female)"},
    {"id": "ar-AE-HamdanNeural", "label": "Hamdan (Arabic, UAE, male)"},
    {"id": "ar-AE-FatimaNeural", "label": "Fatima (Arabic, UAE, female)"},
    {"id": "ar-EG-ShakirNeural", "label": "Shakir (Arabic, Egypt, male)"},
    {"id": "ar-EG-SalmaNeural", "label": "Salma (Arabic, Egypt, female)"},
]
_ALLOWED = {v["id"] for v in CURATED_VOICES}
_ARABIC = re.compile(r"[؀-ۿ]")


def pick_voice(text: str, requested: str | None) -> str:
    if requested:
        if requested not in _ALLOWED:
            raise VoiceError("unknown voice")
        # Keep the language consistent with the text.
        if _ARABIC.search(text) and not requested.startswith("ar-"):
            return get_settings().tts_voice_ar
        return requested
    s = get_settings()
    return s.tts_voice_ar if len(_ARABIC.findall(text)) > len(text) * 0.2 else s.tts_voice_en


def speakable(text: str) -> str:
    """Strip Markdown so the voice does not read symbols aloud."""
    t = re.sub(r"```.*?```", " ", text, flags=re.S)
    t = re.sub(r"`([^`]*)`", r"\1", t)
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"^\s{0,3}#{1,6}\s*", "", t, flags=re.M)
    t = re.sub(r"^\s*[-*+]\s+", "", t, flags=re.M)
    t = re.sub(r"[*_~>|]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


async def synthesize(text: str, voice: str | None = None) -> bytes:
    import edge_tts

    clean = speakable(text)[:4000]
    if not clean:
        raise VoiceError("nothing to say")
    communicate = edge_tts.Communicate(clean, pick_voice(clean, voice))
    out = bytearray()
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio":
            out.extend(chunk["data"])
    if not out:
        raise VoiceError("no audio produced")
    return bytes(out)
