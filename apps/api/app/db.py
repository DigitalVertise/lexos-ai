"""Database engine and session handling (SQLAlchemy 2.0)."""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


# On Postgres all WhatsApp tables live in this schema (shared LexOS database).
PG_SCHEMA = "wa"

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def _normalize_url(url: str) -> str:
    # Railway/Supabase/Heroku hand out postgres:// URLs; SQLAlchemy wants a driver.
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def init_engine(url: str) -> Engine:
    global _engine, _SessionLocal
    url = _normalize_url(url)
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    else:
        # Works behind Supabase's transaction pooler (no server-side prepared statements).
        kwargs["connect_args"] = {"prepare_threshold": None}
        kwargs["execution_options"] = {"schema_translate_map": {None: PG_SCHEMA}}
    _engine = create_engine(url, **kwargs)
    _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def get_engine() -> Engine:
    if _engine is None:
        raise RuntimeError("Database engine not initialised; call init_engine() first")
    return _engine


def create_all() -> None:
    from . import models  # noqa: F401  (registers tables)

    engine = get_engine()
    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(text(f"create schema if not exists {PG_SCHEMA}"))
            # Lock the schema down: only the service's own DB role uses it.
            conn.execute(text(f"revoke all on schema {PG_SCHEMA} from public"))
    Base.metadata.create_all(engine)


def is_postgres() -> bool:
    return get_engine().dialect.name == "postgresql"


@contextmanager
def session_scope() -> Iterator[Session]:
    if _SessionLocal is None:
        raise RuntimeError("Database engine not initialised; call init_engine() first")
    session = _SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Iterator[Session]:
    """FastAPI dependency."""
    with session_scope() as session:
        yield session
