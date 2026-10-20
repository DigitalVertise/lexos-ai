"""Runtime configuration, loaded from environment variables (or a .env file)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Core -------------------------------------------------------------
    app_name: str = "LexOS AI"
    environment: str = "development"  # development | production
    database_url: str = "sqlite:///./lexos.db"
    # Shared secret for the admin API (tenant setup). Required in production.
    admin_token: str = ""
    # Password for the read-only dashboard at /dashboard.
    dashboard_token: str = ""

    # --- Bird (WhatsApp) --------------------------------------------------
    bird_api_key: str = ""  # bk_{region}_... workspace key
    bird_webhook_secret: str = ""  # whsec_... from the webhook endpoint
    # Override only for local testing; normally derived from the key prefix.
    bird_api_base: str = ""
    # Reject webhook deliveries older/newer than this (seconds).
    bird_webhook_tolerance: int = 300

    # --- LLM (via LiteLLM, any provider) ----------------------------------
    # Cheap, fast model for intake conversations and routing.
    llm_model: str = "openai/gpt-5-mini"
    # Stronger model used only for /draft.
    llm_draft_model: str = "openai/gpt-5-mini"
    llm_temperature: float = 0.2
    llm_timeout: int = 60
    # OpenAI-compatible gateway (e.g. Vercel AI Gateway https://ai-gateway.vercel.sh/v1).
    # When set, every model id is sent as-is to this endpoint ("openai/gpt-5-mini").
    llm_api_base: str = ""
    llm_api_key: str = ""
    # Speech-to-text for WhatsApp voice notes (LiteLLM transcription model id).
    stt_model: str = "openai/whisper-1"

    # --- Agent runtime (called by the LexOS web app) ---------------------
    # Shared secret the web app sends as "Authorization: Bearer ...".
    agent_runtime_secret: str = ""
    # Default chat model for assistants (gateway model id).
    agent_model: str = "openai/gpt-5-mini"
    # Free neural TTS (Microsoft Edge voices via edge-tts).
    tts_voice_en: str = "en-US-AndrewMultilingualNeural"
    tts_voice_ar: str = "ar-AE-HamdanNeural"
    # Hugging Face (free tier): AI portraits + LeapTalk talking-head videos.
    hf_token: str = ""
    hf_portrait_model: str = "black-forest-labs/FLUX.1-schnell"
    hf_talking_head_space: str = "hugging-apps/leaptalk-talking-head"
    # Optional real-time WebRTC avatar engine (e.g. LiveTalking on a GPU box).
    avatar_realtime_url: str = ""

    # --- LexOS bridge (WhatsApp leads -> LexOS clients/matters) -----------
    # Postgres URL of the LexOS Supabase database. When set, the WhatsApp
    # service stores its own tables in schema "wa" there and mirrors intakes
    # into LexOS. Falls back to database_url.
    lexos_database_url: str = ""

    # --- CRM ----------------------------------------------------------------
    crm_backend: str = "local"  # local | bigin
    zoho_client_id: str = ""
    zoho_client_secret: str = ""
    zoho_refresh_token: str = ""
    # Zoho data-centre domain suffix: com | eu | in | com.au | jp | ca | sa
    zoho_dc: str = "com"

    # --- Bootstrap tenant (lets you deploy with zero shell access) --------
    default_tenant_name: str = ""
    default_tenant_slug: str = ""
    default_tenant_whatsapp: str = ""  # E.164 business number connected in Bird
    default_tenant_team_group: str = ""  # wag_... Bird group ID of the team group
    default_tenant_team_phones: str = ""  # comma-separated E.164 numbers of staff

    @property
    def llm_kwargs(self) -> dict:
        """Extra LiteLLM kwargs for the configured gateway (empty = provider keys from env)."""
        if not self.llm_api_base:
            return {}
        return {"api_base": self.llm_api_base, "api_key": self.llm_api_key or None,
                "custom_llm_provider": "openai"}

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def resolved_bird_api_base(self) -> str:
        if self.bird_api_base:
            return self.bird_api_base.rstrip("/")
        # Keys look like bk_eu1_xxx / bm_us1_xxx; the middle part is the region.
        parts = self.bird_api_key.split("_")
        region = parts[1] if len(parts) >= 3 and parts[1] else "us1"
        return f"https://{region}.platform.bird.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()
