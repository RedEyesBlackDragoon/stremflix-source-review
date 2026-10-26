from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Bootstrap(Input):
    enrollment_token: str = Field(min_length=32, max_length=200)
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=12, max_length=128)


class Login(Input):
    household_id: UUID
    password: str = Field(min_length=1, max_length=128)


class ProfileInput(Input):
    name: str = Field(min_length=1, max_length=60)
    avatar: Literal["teal", "plum", "coral", "blue", "gold"] = "teal"
    kid: bool = False
    max_age: int = Field(default=12, ge=0, le=17)
    pin: str | None = Field(default=None, pattern=r"^\d{4,8}$")


class Pin(Input):
    pin: str = Field(default="", max_length=128)


class Refresh(Input):
    refresh_token: str = Field(min_length=32, max_length=200)


class PairStart(Input):
    name: str = Field(min_length=1, max_length=80)
    platform: Literal["windows", "android-tv", "android-mobile", "web"]


class PairApprove(Input):
    code: str = Field(pattern=r"^[A-F0-9]{8}$")
    profile_id: UUID


class PairComplete(Input):
    secret: str = Field(min_length=32, max_length=200)


class Preferences(Input):
    version: int = Field(ge=0)
    locale: str = Field(default="en", pattern=r"^[a-z]{2}(?:-[A-Z]{2})?$")
    genres: list[str] = Field(default_factory=list, max_length=30)
    blocked_genres: list[str] = Field(default_factory=list, max_length=30)
    hidden_sources: list[UUID] = Field(default_factory=list, max_length=100)
    saved_lists: list[UUID] = Field(default_factory=list, max_length=100)
    row_order: list[str] = Field(default_factory=list, max_length=20)


class FeedbackInput(Input):
    id: UUID
    work_id: UUID
    action: Literal["like", "dislike", "hide"]


class Event(Input):
    id: UUID
    profile_id: UUID
    work_id: UUID
    episode_id: UUID | None = None
    playback_session: UUID
    event_type: Literal["started", "heartbeat", "paused", "seek", "background", "completed", "replay_started", "resolve_conflict"]
    occurred: float = Field(gt=0)
    position: float = Field(ge=0, le=604800)
    duration: float = Field(gt=0, le=604800)
    expected_version: int | None = Field(default=None, ge=0)


class SyncInput(Input):
    events: list[Event] = Field(max_length=200)


class Resolve(Input):
    row_id: UUID
    work_id: UUID | None = None
    action: Literal["confirm", "skip", "reset"]


class SourceInput(Input):
    name: str = Field(min_length=1, max_length=150)
    manifest_url: str = Field(max_length=300)


class MediaIdentity(Input):
    external_id: str = Field(pattern=r"^tt\d{4,12}$")
    season: int | None = Field(default=None, ge=0, le=1000)
    episode: int | None = Field(default=None, ge=0, le=10000)


class StremioBinding(Input):
    stremio_user_id: str = Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_-]+$")
    verification_method: Literal["authenticated_isolated_runtime"]
