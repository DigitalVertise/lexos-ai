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
    llm_model: str = "anthropic/claude-haiku-5-5"
    # Stronger model used only for /draft.
    llm_draft_model: str = "anthropic/claude-sonnet-5-5"
    llm_temperature: float = 0.2
    llm_timeout: int = 60

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
