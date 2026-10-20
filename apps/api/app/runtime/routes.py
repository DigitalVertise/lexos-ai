"""Agent runtime used by the LexOS web app.

The web app owns users, firms, permissions, package limits and prompts; it
calls this service server-to-server with a shared secret. This service owns
model access (LiteLLM, any provider / Vercel AI Gateway), speech and avatars.

Endpoints (all require ``Authorization: Bearer <AGENT_RUNTIME_SECRET>``):

- POST /v1/agent/chat      stream a reply (Server-Sent Events)
- POST /v1/voice/tts       text -> MP3 (free Microsoft Edge neural voices)
- POST /v1/avatar/portrait AI-generated fictional portrait (Hugging Face)
- POST /v1/avatar/video    portrait + text -> lip-synced MP4 (LeapTalk)
- GET  /v1/capabilities    what is configured (no secrets)
"""

from __future__ import annotations

import hmac
import json
import logging
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from ..config import get_settings
from ..llm import is_reasoning_model
from . import avatar, voice

log = logging.getLogger("lexos.runtime")
router = APIRouter(prefix="/v1", tags=["agent-runtime"])

MAX_IMAGE_BYTES = 6 * 1024 * 1024


def require_runtime(authorization: str = Header(default="")) -> None:
    secret = get_settings().agent_runtime_secret
    if not secret:
        raise HTTPException(status_code=503, detail="agent runtime not configured")
    if not hmac.compare_digest(authorization, f"Bearer {secret}"):
        raise HTTPException(status_code=401, detail="unauthorized")


# --------------------------------------------------------------------------
# Capabilities
# --------------------------------------------------------------------------

@router.get("/capabilities", dependencies=[Depends(require_runtime)])
def capabilities() -> dict:
    s = get_settings()
    return {
        "chat": True,
        "model": s.agent_model,
        "tts": True,
        "portrait": bool(s.hf_token),
        "video": bool(s.hf_token),
        "realtime_avatar": bool(s.avatar_realtime_url),
        "realtime_avatar_url": s.avatar_realtime_url or None,
    }


# --------------------------------------------------------------------------
# Chat (streaming)
# --------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=60_000)


class ChatIn(BaseModel):
    system: str = Field(max_length=120_000)
    messages: list[ChatMessage] = Field(min_length=1, max_length=60)
    model: str | None = Field(default=None, max_length=120)
    max_tokens: int = Field(default=4000, ge=64, le=16_000)


def _sse(payload: dict) -> bytes:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode()


def chat_kwargs(body: ChatIn) -> dict:
    s = get_settings()
    model = body.model or s.agent_model
    kwargs: dict = {
        "model": model,
        "messages": [{"role": "system", "content": body.system},
                     *[m.model_dump() for m in body.messages]],
        "stream": True,
        "timeout": max(s.llm_timeout, 120),
        "stream_options": {"include_usage": True},
        **s.llm_kwargs,
    }
    if is_reasoning_model(model):
        kwargs["max_completion_tokens"] = body.max_tokens + 2000
        kwargs["reasoning_effort"] = "low"
    else:
        kwargs["max_tokens"] = body.max_tokens
        kwargs["temperature"] = 0.3
    return kwargs


@router.post("/agent/chat", dependencies=[Depends(require_runtime)])
async def agent_chat(body: ChatIn) -> StreamingResponse:
    import litellm

    litellm.drop_params = True
    kwargs = chat_kwargs(body)

    async def events():
        usage = None
        try:
            stream = await litellm.acompletion(**kwargs)
            async for chunk in stream:
                if getattr(chunk, "usage", None):
                    usage = chunk.usage
                choices = getattr(chunk, "choices", None) or []
                delta = choices[0].delta.content if choices and choices[0].delta else None
                if delta:
                    yield _sse({"delta": delta})
            yield _sse({
                "done": True, "model": kwargs["model"],
                "input_tokens": getattr(usage, "prompt_tokens", None),
                "output_tokens": getattr(usage, "completion_tokens", None),
            })
        except Exception as exc:  # never leak provider details or prompts
            log.warning("chat stream failed: %s", type(exc).__name__)
            yield _sse({"error": "The AI service did not respond. Please try again."})

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


# --------------------------------------------------------------------------
# Voice
# --------------------------------------------------------------------------

class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    voice: str | None = Field(default=None, max_length=80)


@router.post("/voice/tts", dependencies=[Depends(require_runtime)])
async def tts(body: TtsIn) -> Response:
    try:
        audio = await voice.synthesize(body.text, body.voice)
    except voice.VoiceError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        log.warning("tts failed: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="speech service unavailable") from exc
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


@router.get("/voice/voices", dependencies=[Depends(require_runtime)])
def voices() -> dict:
    return {"voices": voice.CURATED_VOICES}


# --------------------------------------------------------------------------
# Avatar
# --------------------------------------------------------------------------

class PortraitIn(BaseModel):
    description: str = Field(min_length=3, max_length=400)


@router.post("/avatar/portrait", dependencies=[Depends(require_runtime)])
async def portrait(body: PortraitIn) -> Response:
    try:
        png = await avatar.generate_portrait(body.description)
    except avatar.AvatarError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        log.warning("portrait failed: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="image service unavailable") from exc
    return Response(png, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.post("/avatar/video", dependencies=[Depends(require_runtime)])
async def talking_video(
    image: UploadFile = File(...),
    text: str = Form(..., min_length=1, max_length=1200),
    voice_name: str | None = Form(default=None, max_length=80),
) -> Response:
    data = await image.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image too large")
    if image.content_type not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(status_code=415, detail="use a PNG, JPEG or WebP portrait")
    try:
        audio = await voice.synthesize(text, voice_name)
        mp4 = await avatar.talking_head(data, image.content_type, audio)
    except (voice.VoiceError, avatar.AvatarError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        log.warning("talking head failed: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="video service unavailable (free GPU quota may be used up)") from exc
    return Response(mp4, media_type="video/mp4", headers={"Cache-Control": "no-store"})
