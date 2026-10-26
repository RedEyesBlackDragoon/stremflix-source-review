"""Portable relational schema. Production uses PostgreSQL; SQLite is for local development/tests."""
import time
import uuid

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def uid():
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    pass


class Entity:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
    updated_at: Mapped[float] = mapped_column(Float, default=time.time, onupdate=time.time)


class Household(Entity, Base):
    __tablename__ = "households"
    name: Mapped[str] = mapped_column(String(80))
    admin_hash: Mapped[str] = mapped_column(Text)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)


class Profile(Entity, Base):
    __tablename__ = "profiles"
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    avatar: Mapped[str] = mapped_column(String(24), default="teal")
    kid: Mapped[bool] = mapped_column(Boolean, default=False)
    max_age: Mapped[int] = mapped_column(Integer, default=12)
    pin_hash: Mapped[str | None] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=1)


class Binding(Entity, Base):
    __tablename__ = "profile_stremio_bindings"
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), unique=True)
    stremio_user_id: Mapped[str] = mapped_column(String(128), unique=True)
    status: Mapped[str] = mapped_column(String(24), default="pending_verification")
    verified_at: Mapped[float | None] = mapped_column(Float)


class Device(Entity, Base):
    __tablename__ = "devices"
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    platform: Mapped[str] = mapped_column(String(30))
    capabilities: Mapped[dict] = mapped_column(JSON, default=dict)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class Session(Entity, Base):
    __tablename__ = "device_profile_sessions"
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    profile_id: Mapped[str | None] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"))
    admin: Mapped[bool] = mapped_column(Boolean, default=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    refresh_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires: Mapped[float] = mapped_column(Float)
    refresh_expires: Mapped[float] = mapped_column(Float)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class Pairing(Entity, Base):
    __tablename__ = "pairings"
    secret_hash: Mapped[str] = mapped_column(String(64), unique=True)
    code: Mapped[str] = mapped_column(String(12), unique=True)
    expires: Mapped[float] = mapped_column(Float)
    device_name: Mapped[str] = mapped_column(String(80))
    platform: Mapped[str] = mapped_column(String(30))
    household_id: Mapped[str | None] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"))
    profile_id: Mapped[str | None] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"))
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)


class Work(Entity, Base):
    __tablename__ = "media_works"
    kind: Mapped[str] = mapped_column(String(12))
    title: Mapped[str] = mapped_column(String(300), index=True)
    year: Mapped[int | None] = mapped_column(Integer)
    genres: Mapped[list] = mapped_column(JSON, default=list)
    cast: Mapped[list] = mapped_column(JSON, default=list)
    directors: Mapped[list] = mapped_column(JSON, default=list)
    age: Mapped[int | None] = mapped_column(Integer)
    language: Mapped[str | None] = mapped_column(String(30))
    runtime: Mapped[int | None] = mapped_column(Integer)
    poster: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text, default="")
    provenance: Mapped[str] = mapped_column(String(150))
    quality: Mapped[float] = mapped_column(Float, default=0.5)


class ExternalID(Entity, Base):
    __tablename__ = "media_external_ids"
    work_id: Mapped[str] = mapped_column(ForeignKey("media_works.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(40))
    external_id: Mapped[str] = mapped_column(String(128))
    __table_args__ = (UniqueConstraint("provider", "external_id"),)


class Episode(Entity, Base):
    __tablename__ = "episodes"
    work_id: Mapped[str] = mapped_column(ForeignKey("media_works.id", ondelete="CASCADE"))
    season: Mapped[int] = mapped_column(Integer)
    number: Mapped[int] = mapped_column(Integer)
    __table_args__ = (UniqueConstraint("work_id", "season", "number"),)


class ProfileMedia(Entity, Base):
    __tablename__ = "profile_metadata_works"
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    work_id: Mapped[str] = mapped_column(ForeignKey("media_works.id", ondelete="CASCADE"))
    source_id: Mapped[str] = mapped_column(ForeignKey("curated_sources.id", ondelete="CASCADE"))
    __table_args__ = (UniqueConstraint("profile_id", "work_id"),)


class WatchEvent(Entity, Base):
    __tablename__ = "watch_events"
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"))
    work_id: Mapped[str] = mapped_column(ForeignKey("media_works.id", ondelete="CASCADE"))
    episode_id: Mapped[str | None] = mapped_column(ForeignKey("episodes.id", ondelete="CASCADE"))
    device_id: Mapped[str | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"))
    batch_id: Mapped[str | None] = mapped_column(ForeignKey("import_batches.id", ondelete="CASCADE"))
    source: Mapped[str] = mapped_column(String(30))
    source_event_id: Mapped[str] = mapped_column(String(100))
    event_type: Mapped[str] = mapped_column(String(24))
    occurred: Mapped[float] = mapped_column(Float)
    playback_session: Mapped[str | None] = mapped_column(String(36))
    position: Mapped[float] = mapped_column(Float, default=0)
    duration: Mapped[float] = mapped_column(Float, default=0)
    __table_args__ = (UniqueConstraint("profile_id", "source", "source_event_id"), Index("ix_watch_profile_time", "profile_id", "occurred"))


class Playback(Entity, Base):
    __tablename__ = "playback_states"
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"))
    work_id: Mapped[str] = mapped_column(ForeignKey("media_works.id", ondelete="CASCADE"))
    # Empty string represents a movie, making the unique constraint portable and NULL-safe.
    episode_key: Mapped[str] = mapped_column(String(36), default="")
    playback_session: Mapped[str] = mapped_column(String(36))
    position: Mapped[float] = mapped_column(Float)
    duration: Mapped[float] = mapped_column(Float)
    completed: Mapped[bool] = mapped_column(Boolean)
    occurred: Mapped[float] = mapped_column(Float)
    source_event_id: Mapped[str] = mapped_column(String(100))
    version: Mapped[int] = mapped_column(Integer, default=1)
    conflict: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (UniqueConstraint("profile_id", "work_id", "episode_key"),)


class Watchlist(Entity, Base):
    __tablename__ = "watchlist_entries"
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"))
    work_id: Mapped[str] = mapped_column(ForeignKey("media_works.id", ondelete="CASCADE"))
    __table_args__ = (UniqueConstraint("profile_id", "work_id"),)


class Feedback(Entity, Base):
    __tablename__ = "feedback_events"
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"))
    work_id: Mapped[str] = mapped_column(ForeignKey("media_works.id", ondelete="CASCADE"))
    action: Mapped[str] = mapped_column(String(20))
    undone: Mapped[bool] = mapped_column(Boolean, default=False)


class Preference(Entity, Base):
    __tablename__ = "profile_preferences"
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), unique=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    value: Mapped[dict] = mapped_column(JSON, default=dict)


class Checkpoint(Entity, Base):
    __tablename__ = "library_sync_checkpoints"
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"))
    cursor: Mapped[str] = mapped_column(String(100))


class ImportBatch(Entity, Base):
    __tablename__ = "import_batches"
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    digest: Mapped[str] = mapped_column(String(64))
    date_order: Mapped[str] = mapped_column(String(3), default="MDY")
    status: Mapped[str] = mapped_column(String(24), default="queued")
    __table_args__ = (UniqueConstraint("profile_id", "digest"),)


class ImportRow(Entity, Base):
    __tablename__ = "import_rows"
    batch_id: Mapped[str] = mapped_column(ForeignKey("import_batches.id", ondelete="CASCADE"), index=True)
    source_hash: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(300))
    watched_at: Mapped[float] = mapped_column(Float)
    probable_episode: Mapped[bool] = mapped_column(Boolean)
    status: Mapped[str] = mapped_column(String(24), default="needs_review")
    confidence: Mapped[float] = mapped_column(Float, default=0)
    candidates: Mapped[list] = mapped_column(JSON, default=list)
    work_id: Mapped[str | None] = mapped_column(ForeignKey("media_works.id", ondelete="SET NULL"))
    __table_args__ = (UniqueConstraint("batch_id", "source_hash"),)


class CuratedSource(Entity, Base):
    __tablename__ = "curated_sources"
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(150))
    manifest_url: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(30), default="pending")
    next_attempt: Mapped[float] = mapped_column(Float, default=0)
    failures: Mapped[int] = mapped_column(Integer, default=0)


class CuratedList(Entity, Base):
    __tablename__ = "curated_lists"
    source_id: Mapped[str] = mapped_column(ForeignKey("curated_sources.id", ondelete="CASCADE"))
    catalog_id: Mapped[str] = mapped_column(String(150))
    kind: Mapped[str] = mapped_column(String(12))
    name: Mapped[str] = mapped_column(String(150))
    attribution: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    fetched: Mapped[float] = mapped_column(Float, default=0)
    __table_args__ = (UniqueConstraint("source_id", "catalog_id", "kind"),)


class CuratedItem(Entity, Base):
    __tablename__ = "curated_list_items"
    list_id: Mapped[str] = mapped_column(ForeignKey("curated_lists.id", ondelete="CASCADE"))
    work_id: Mapped[str] = mapped_column(ForeignKey("media_works.id", ondelete="CASCADE"))
    original_rank: Mapped[int] = mapped_column(Integer)
    __table_args__ = (UniqueConstraint("list_id", "work_id"),)


class Snapshot(Entity, Base):
    __tablename__ = "recommendation_snapshots"
    profile_id: Mapped[str] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    cache_key: Mapped[str] = mapped_column(String(64), unique=True)
    algorithm: Mapped[str] = mapped_column(String(30))
    expires: Mapped[float] = mapped_column(Float)


class RecommendationItem(Entity, Base):
    __tablename__ = "recommendation_items"
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("recommendation_snapshots.id", ondelete="CASCADE"))
    work_id: Mapped[str] = mapped_column(ForeignKey("media_works.id", ondelete="CASCADE"))
    rank: Mapped[int] = mapped_column(Integer)
    score: Mapped[float] = mapped_column(Float)
    features: Mapped[dict] = mapped_column(JSON)
    rationale: Mapped[list] = mapped_column(JSON)


class Audit(Entity, Base):
    __tablename__ = "audit_events"
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(60))
    target_id: Mapped[str] = mapped_column(String(36))


class RateLimit(Base):
    __tablename__ = "rate_limits"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    window: Mapped[int] = mapped_column(Integer)
    count: Mapped[int] = mapped_column(Integer, default=1)
