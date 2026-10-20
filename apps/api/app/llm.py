"""Thin LLM wrapper over LiteLLM, so any provider (Anthropic, OpenAI, Gemini,
OpenRouter, a local Ollama...) is a config change, not a code change."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Protocol

from .config import Settings

log = logging.getLogger(__name__)


class LLM(Protocol):
    def complete(self, system: str, messages: list[dict[str, str]], *,
                 model: str | None = None, json_mode: bool = False,
                 max_tokens: int = 800) -> str: ...


class LiteLLM:
    def __init__(self, settings: Settings):
        self.s = settings

    def complete(self, system: str, messages: list[dict[str, str]], *,
                 model: str | None = None, json_mode: bool = False,
                 max_tokens: int = 800) -> str:
        import litellm  # imported lazily: heavy, and not needed in tests

        kwargs: dict[str, Any] = {
            "model": model or self.s.llm_model,
            "messages": [{"role": "system", "content": system}, *messages],
            "temperature": self.s.llm_temperature,
            "max_tokens": max_tokens,
            "timeout": self.s.llm_timeout,
            **self.s.llm_kwargs,
        }
        if json_mode and not kwargs["model"].startswith("anthropic/"):
            # Anthropic models follow the JSON instruction in the prompt reliably;
            # other providers get native JSON mode.
            kwargs["response_format"] = {"type": "json_object"}
        if is_reasoning_model(kwargs["model"]):
            # gpt-5 / o-series reject custom temperature; spend fewer tokens thinking.
            kwargs.pop("temperature", None)
            kwargs["reasoning_effort"] = "low"
            kwargs["max_completion_tokens"] = kwargs.pop("max_tokens") + 1500
        litellm.drop_params = True
        resp = litellm.completion(**kwargs)
        return resp.choices[0].message.content or ""


def is_reasoning_model(model: str) -> bool:
    name = model.split("/")[-1]
    return bool(re.match(r"^(gpt-5|o\d)", name)) and "chat" not in name


def parse_json(text: str) -> dict[str, Any]:
    """Extract the first JSON object from a model reply (tolerates code fences)."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fence:
        text = fence.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in model reply")
    return json.loads(text[start : end + 1])
