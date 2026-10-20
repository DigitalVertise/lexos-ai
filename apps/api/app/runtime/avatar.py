"""Avatars on free/open-source tooling.

- Portraits: FLUX.1-schnell (Apache-2.0) via Hugging Face Inference with the
  firm's HF token. Prompts are always framed as a *fictional* person.
- Talking-head video: LeapTalk (Apache-2.0) on a Hugging Face ZeroGPU Space via
  gradio_client — portrait + speech -> lip-synced MP4. Free quota is limited.
- Real-time WebRTC (LiveTalking/MuseTalk on your own GPU) is configured with
  AVATAR_REALTIME_URL and used directly by the browser.
"""

from __future__ import annotations

import asyncio
import io
import os
import re
import tempfile

from ..config import get_settings


class AvatarError(Exception):
    pass


# Refuse prompts that try to depict a specific real person by name.
_REAL_PERSON = re.compile(r"\b(looks? like|resembl\w*|celebrity|famous|real person|lookalike)\b", re.I)


def portrait_prompt(description: str) -> str:
    d = re.sub(r"\s+", " ", description).strip()
    if _REAL_PERSON.search(d):
        raise AvatarError("Describe a fictional person — portraits of real or famous people are not generated.")
    return (
        "Photorealistic professional head-and-shoulders portrait of a fictional person, "
        f"{d}. Looking at the camera, neutral expression with closed mouth, soft studio light, "
        "plain light background, sharp focus, centered face, business attire."
    )


async def generate_portrait(description: str) -> bytes:
    s = get_settings()
    if not s.hf_token:
        raise AvatarError("Portrait generation is not configured (Hugging Face token missing).")
    prompt = portrait_prompt(description)

    def _run() -> bytes:
        from huggingface_hub import InferenceClient

        client = InferenceClient(token=s.hf_token, timeout=120)
        image = client.text_to_image(prompt, model=s.hf_portrait_model, width=768, height=768)
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()

    return await asyncio.to_thread(_run)


def _suffix(content_type: str) -> str:
    return {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}.get(content_type, ".png")


async def talking_head(image: bytes, content_type: str, audio_mp3: bytes, max_seconds: float = 20.0) -> bytes:
    s = get_settings()
    if not s.hf_token:
        raise AvatarError("Talking-head video is not configured (Hugging Face token missing).")

    def _run() -> bytes:
        from gradio_client import Client, handle_file

        with tempfile.TemporaryDirectory(prefix="lexos_avatar_") as tmp:
            img_path = os.path.join(tmp, "portrait" + _suffix(content_type))
            wav_path = os.path.join(tmp, "speech.mp3")
            with open(img_path, "wb") as f:
                f.write(image)
            with open(wav_path, "wb") as f:
                f.write(audio_mp3)
            client = Client(s.hf_talking_head_space, hf_token=s.hf_token, verbose=False)
            result = client.predict(
                handle_file(img_path), handle_file(wav_path),
                max_seconds, 1, 1.0, 42, True,
                api_name="/generate",
            )
            video = result[0] if isinstance(result, (list, tuple)) else result
            if isinstance(video, dict):
                video = video.get("video") or video.get("path")
            if not video or not os.path.exists(video):
                raise AvatarError("The video engine returned no file.")
            with open(video, "rb") as f:
                return f.read()

    return await asyncio.wait_for(asyncio.to_thread(_run), timeout=240)
