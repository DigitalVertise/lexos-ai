"""LexOS AI API: WhatsApp webhook, admin API and team dashboard."""

from __future__ import annotations

import hmac
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, Form, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import db, router, tenants
from .channels.bird import BirdClient, Messenger, NullMessenger, SignatureError, parse_received, verify_signature
from .config import Settings, get_settings
from .crm import CRM, build_crm
from .llm import LLM, LiteLLM
from .models import Contact, Matter, Message, Tenant, TimeEntry, WebhookEvent

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("lexos")

TEMPLATES = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
TEMPLATES.env.filters["dur"] = lambda m: f"{m // 60}h{m % 60:02d}m" if m >= 60 else f"{m}m"


class Services:
    """Process-wide singletons; replaced in tests."""

    messenger: Messenger
    llm: LLM
    crm: CRM


services = Services()


def configure(settings: Settings) -> None:
    db.init_engine(settings.database_url)
    db.create_all()
    services.messenger = (
        BirdClient(settings.bird_api_key, settings.resolved_bird_api_base)
        if settings.bird_api_key else NullMessenger()
    )
    services.llm = LiteLLM(settings)
    services.crm = build_crm(settings)
    with db.session_scope() as session:
        tenants.bootstrap_from_env(session, settings)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if settings.is_production:
        missing = [n for n in ("bird_api_key", "bird_webhook_secret", "admin_token", "dashboard_token")
                   if not getattr(settings, n)]
        if missing:
            raise RuntimeError(f"Missing required settings in production: {', '.join(missing)}")
    if not getattr(services, "llm", None):
        configure(settings)
    yield


app = FastAPI(title="LexOS AI", version="0.1.0", lifespan=lifespan)

from .runtime.routes import router as runtime_router  # noqa: E402

app.include_router(runtime_router)


# --------------------------------------------------------------------------
# Health
# --------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# --------------------------------------------------------------------------
# Bird webhook
# --------------------------------------------------------------------------

def _process_event(event: dict) -> None:
    msg = parse_received(event)
    if msg is None:
        return
    settings = get_settings()
    try:
        with db.session_scope() as session:
            outcome = router.handle_inbound(
                session, msg, messenger=services.messenger, llm=services.llm,
                crm=services.crm, draft_model=settings.llm_draft_model,
            )
        log.info("Handled %s from %s: %s", msg.provider_id, "group" if msg.group_id else "dm", outcome)
    except Exception:
        log.exception("Failed to handle inbound message %s", msg.provider_id)


@app.post("/webhooks/bird", status_code=200)
async def bird_webhook(request: Request, background: BackgroundTasks) -> dict:
    settings = get_settings()
    body = await request.body()

    if settings.bird_webhook_secret:
        try:
            delivery_id = verify_signature(settings.bird_webhook_secret, dict(request.headers), body,
                                           tolerance=settings.bird_webhook_tolerance)
        except SignatureError as exc:
            log.warning("Rejected webhook: %s", exc)
            raise HTTPException(status_code=401, detail="invalid signature") from exc
    elif settings.is_production:
        raise HTTPException(status_code=500, detail="webhook secret not configured")
    else:
        delivery_id = request.headers.get("webhook-id", "")

    try:
        event = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="invalid JSON") from exc

    # Bird retries reuse the same webhook-id: process each delivery once.
    if delivery_id:
        try:
            with db.session_scope() as session:
                session.add(WebhookEvent(id=delivery_id))
        except IntegrityError:
            return {"status": "duplicate"}

    # Acknowledge fast; the LLM call happens after the response is sent.
    background.add_task(_process_event, event)
    return {"status": "accepted"}


# --------------------------------------------------------------------------
# Admin API (tenant setup)
# --------------------------------------------------------------------------

def require_admin(authorization: str = Header(default="")) -> None:
    token = get_settings().admin_token
    if not token or not hmac.compare_digest(authorization, f"Bearer {token}"):
        raise HTTPException(status_code=401, detail="unauthorized")


class TenantIn(BaseModel):
    name: str
    slug: str = Field(pattern=r"^[a-z0-9-]{2,80}$")
    whatsapp_number: str
    team_group_id: str | None = None
    team_phones: list[str] = []
    settings: dict | None = None


@app.put("/admin/tenants", dependencies=[Depends(require_admin)])
def put_tenant(body: TenantIn, session: Session = Depends(db.get_session)) -> dict:
    try:
        tenant = tenants.upsert_tenant(session, **body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"id": tenant.id, "slug": tenant.slug, "whatsapp_number": tenant.whatsapp_number,
            "team_group_id": tenant.team_group_id}


# --------------------------------------------------------------------------
# Dashboard (read-only, mobile-friendly)
# --------------------------------------------------------------------------

COOKIE = "lexos_dash"


def _dash_ok(request: Request) -> bool:
    token = get_settings().dashboard_token
    if not token:
        return not get_settings().is_production
    return hmac.compare_digest(request.cookies.get(COOKIE, ""), token)


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse("/dashboard")


@app.get("/login", response_class=HTMLResponse, include_in_schema=False)
def login_form(request: Request, error: str = "") -> HTMLResponse:
    return TEMPLATES.TemplateResponse(request, "login.html", {"error": error})


@app.post("/login", include_in_schema=False)
def login(password: str = Form(...)) -> RedirectResponse:
    token = get_settings().dashboard_token
    if not token or not hmac.compare_digest(password, token):
        return RedirectResponse("/login?error=1", status_code=303)
    resp = RedirectResponse("/dashboard", status_code=303)
    resp.set_cookie(COOKIE, token, httponly=True, secure=get_settings().is_production,
                    samesite="lax", max_age=60 * 60 * 24 * 30)
    return resp


@app.get("/dashboard", response_class=HTMLResponse, include_in_schema=False)
def dashboard(request: Request, tenant: str = "", session: Session = Depends(db.get_session)):
    if not _dash_ok(request):
        return RedirectResponse("/login", status_code=303)
    all_tenants = session.scalars(select(Tenant).order_by(Tenant.name)).all()
    current = next((t for t in all_tenants if t.slug == tenant), all_tenants[0] if all_tenants else None)
    data: dict = {"tenants": all_tenants, "tenant": current}
    if current:
        tid = current.id
        data["matters"] = session.scalars(
            select(Matter).where(Matter.tenant_id == tid).order_by(Matter.number.desc()).limit(50)
        ).all()
        data["time_entries"] = session.scalars(
            select(TimeEntry).where(TimeEntry.tenant_id == tid)
            .order_by(TimeEntry.created_at.desc()).limit(30)
        ).all()
        data["messages"] = session.scalars(
            select(Message).where(Message.tenant_id == tid)
            .order_by(Message.created_at.desc()).limit(30)
        ).all()
        contacts = {c.id: c for c in session.scalars(select(Contact).where(Contact.tenant_id == tid))}
        data["contacts"] = contacts
        data["stats"] = {
            "leads": session.scalar(select(func.count()).select_from(Contact).where(
                Contact.tenant_id == tid, Contact.kind == "lead")) or 0,
            "clients": session.scalar(select(func.count()).select_from(Contact).where(
                Contact.tenant_id == tid, Contact.kind == "client")) or 0,
            "conflicts": sum(1 for m in data["matters"] if m.conflict_hits and m.status == "conflict_review"),
            "minutes": session.scalar(select(func.coalesce(func.sum(TimeEntry.minutes), 0)).where(
                TimeEntry.tenant_id == tid)) or 0,
        }
    return TEMPLATES.TemplateResponse(request, "dashboard.html", data)
