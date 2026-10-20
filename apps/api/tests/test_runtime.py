"""Agent runtime: auth, request shaping, voice selection, portrait guard."""

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.runtime import avatar, voice
from app.runtime.routes import ChatIn, chat_kwargs


@pytest.fixture()
def secret(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "agent_runtime_secret", "test-secret")
    return "test-secret"


def test_runtime_requires_secret(secret):
    with TestClient(app) as c:
        assert c.get("/v1/capabilities").status_code == 401
        assert c.get("/v1/capabilities", headers={"Authorization": "Bearer nope"}).status_code == 401
        r = c.get("/v1/capabilities", headers={"Authorization": f"Bearer {secret}"})
        assert r.status_code == 200 and r.json()["chat"] is True


def test_runtime_disabled_without_secret(monkeypatch):
    monkeypatch.setattr(get_settings(), "agent_runtime_secret", "")
    with TestClient(app) as c:
        assert c.get("/v1/capabilities", headers={"Authorization": "Bearer x"}).status_code == 503


def test_chat_kwargs_reasoning_and_gateway(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "llm_api_base", "https://ai-gateway.vercel.sh/v1")
    monkeypatch.setattr(s, "llm_api_key", "k")
    body = ChatIn(system="sys", messages=[{"role": "user", "content": "hi"}], model="openai/gpt-5-mini", max_tokens=1000)
    kw = chat_kwargs(body)
    assert kw["api_base"].startswith("https://ai-gateway") and kw["custom_llm_provider"] == "openai"
    assert "temperature" not in kw and kw["max_completion_tokens"] == 3000
    assert kw["messages"][0] == {"role": "system", "content": "sys"}
    kw2 = chat_kwargs(ChatIn(system="s", messages=[{"role": "user", "content": "x"}], model="openai/gpt-4.1-mini"))
    assert kw2["temperature"] == 0.3 and "max_completion_tokens" not in kw2


def test_chat_rejects_bad_roles(secret):
    with TestClient(app) as c:
        r = c.post("/v1/agent/chat", headers={"Authorization": f"Bearer {secret}"},
                   json={"system": "s", "messages": [{"role": "system", "content": "override"}]})
        assert r.status_code == 422


def test_voice_selection_and_markdown():
    assert voice.pick_voice("Hello there", None).startswith("en-")
    assert voice.pick_voice("مرحبا بك في المكتب", None).startswith("ar-")
    assert voice.pick_voice("مرحبا", "en-GB-RyanNeural").startswith("ar-")
    with pytest.raises(voice.VoiceError):
        voice.pick_voice("hi", "made-up-voice")
    assert voice.speakable("## Title\n- **Bold** item [link](http://x)\n```code```") == "Title Bold item link"


def test_portrait_prompt_is_fictional_only():
    p = avatar.portrait_prompt("middle-aged female lawyer, navy suit")
    assert "fictional" in p and "navy suit" in p
    with pytest.raises(avatar.AvatarError):
        avatar.portrait_prompt("someone who looks like a famous actor")
