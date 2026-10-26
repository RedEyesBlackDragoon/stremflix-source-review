import hashlib
import os
import secrets
import time
import asyncio
import multiprocessing
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from . import models as m, schemas as s
from .db import database
from .importer import MAX_BYTES, parse_csv_restricted
from .playback import Progress, reconcile
from .ranking import ALGORITHM, allowed, cache_key, rank
from .security import authenticate, digest, issue, limited, passwords, verify

app = FastAPI(title="STREMFLIX Household API", version="0.1.0", openapi_url="/v1/openapi.json")
DB = Annotated[DBSession, Depends(database)]


@app.middleware("http")
async def secure_headers(request, call_next):
    if os.getenv("ENVIRONMENT") == "production" and request.url.scheme != "https":
        return JSONResponse({"detail": "https_required"}, 400)
    length = request.headers.get("content-length")
    if length and (not length.isdigit() or int(length) > MAX_BYTES + 65536):
        return JSONResponse({"detail": "request_too_large"}, 413)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    return response


@app.exception_handler(IntegrityError)
async def constraint_error(_, __):
    return JSONResponse({"detail": "conflict_retry_or_refresh"}, 409)


def principal(db: DB, authorization: Annotated[str | None, Header()] = None):
    return authenticate(db, authorization)


Auth = Annotated[tuple, Depends(principal)]


def admin(auth):
    if not auth[0].admin:
        raise HTTPException(403, "administrator_required")


def profile_for(db, auth, pid, admin_only=False):
    profile = db.get(m.Profile, str(pid))
    if not profile or profile.household_id != auth[1].household_id:
        raise HTTPException(404, "profile_not_found")
    if admin_only:
        admin(auth)
    elif not auth[0].admin and auth[0].profile_id != profile.id:
        raise HTTPException(403, "profile_not_authorized")
    return profile


def audit(db, auth, action, target_id):
    db.add(m.Audit(household_id=auth[1].household_id, action=action, target_id=target_id))


def prefs_for(db, pid):
    pref = db.scalar(select(m.Preference).where(m.Preference.profile_id == pid))
    return pref.value if pref else {}


def visible_works(db, auth, profile_id):
    hidden = prefs_for(db, profile_id).get("hidden_sources", [])
    ids = select(m.CuratedItem.work_id).join(m.CuratedList, m.CuratedItem.list_id == m.CuratedList.id).join(
        m.CuratedSource, m.CuratedList.source_id == m.CuratedSource.id).where(
        m.CuratedSource.household_id == auth[1].household_id, m.CuratedSource.enabled.is_(True), m.CuratedSource.id.not_in(hidden))
    private = select(m.ProfileMedia.work_id).join(m.Profile, m.ProfileMedia.profile_id == m.Profile.id).where(
        m.ProfileMedia.profile_id == profile_id, m.Profile.household_id == auth[1].household_id, m.ProfileMedia.source_id.not_in(hidden))
    own_history = select(m.WatchEvent.work_id).where(m.WatchEvent.profile_id == profile_id)
    own_list = select(m.Watchlist.work_id).where(m.Watchlist.profile_id == profile_id)
    return list(db.scalars(select(m.Work).where(m.Work.id.in_(ids.union(private, own_history, own_list)))).all())


def work_for(db, auth, profile, wid):
    works = visible_works(db, auth, profile.id)
    work = next((w for w in works if w.id == str(wid)), None)
    if not work or not allowed(work, profile, prefs_for(db, profile.id)):
        raise HTTPException(404, "work_not_available")
    return work


def work_json(db, work):
    ext = db.scalar(select(m.ExternalID).where(m.ExternalID.work_id == work.id, m.ExternalID.provider == "imdb"))
    return {"id": work.id, "external_id": ext.external_id if ext else None, "type": work.kind,
            "title": work.title, "year": work.year, "genres": work.genres, "age": work.age,
            "poster": work.poster, "description": work.description, "cast": work.cast,
            "directors": work.directors, "provenance": work.provenance}


def profile_json(profile):
    return {"id": profile.id, "name": profile.name, "avatar": profile.avatar, "kid": profile.kid,
            "max_age": profile.max_age, "has_pin": bool(profile.pin_hash), "version": profile.revision}


@app.get("/v1/health")
def health():
    return {"status": "ok", "version": app.version}


@app.get("/v1/ready")
def ready(db: DB):
    db.execute(text("SELECT 1"))
    db.execute(select(m.Household.id).limit(1))
    return {"status": "ready"}


@app.post("/v1/admin/bootstrap", status_code=201)
def bootstrap(body: s.Bootstrap, request: Request, db: DB):
    limited(db, "bootstrap:" + request.client.host, 5)
    expected = os.getenv("BOOTSTRAP_TOKEN", "")
    if len(expected) < 32 or not secrets.compare_digest(expected, body.enrollment_token):
        raise HTTPException(403, "invalid_enrollment_token")
    # Singleton deployment ownership, including concurrent first-run attempts.
    if db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(10241997)"))
    if db.scalar(select(m.Household.id).limit(1)):
        raise HTTPException(409, "already_enrolled")
    household = m.Household(id="00000000-0000-4000-8000-000000000001", name=body.name, admin_hash=passwords.hash(body.password))
    db.add(household)
    db.flush()
    device = m.Device(household_id=household.id, name="Administrator", platform="web")
    db.add(device)
    db.flush()
    credentials = issue(db, device, admin=True)
    db.add(m.Audit(household_id=household.id, action="bootstrap", target_id=device.id))
    db.commit()
    return {**credentials, "household_id": household.id}


@app.post("/v1/admin/login")
def login(body: s.Login, request: Request, db: DB):
    limited(db, "admin-login:" + request.client.host, 5)
    household = db.get(m.Household, str(body.household_id))
    if not household or not verify(household.admin_hash, body.password):
        raise HTTPException(403, "invalid_administrator_credentials")
    device = m.Device(household_id=household.id, name="Administrator", platform="web")
    db.add(device)
    db.flush()
    result = issue(db, device, admin=True)
    db.commit()
    return {**result, "household_id": household.id}


@app.get("/v1/session")
def session_info(auth: Auth):
    return {"admin": auth[0].admin, "profile_id": auth[0].profile_id, "household_id": auth[1].household_id,
            "device_id": auth[1].id}


@app.post("/v1/auth/refresh")
def refresh(body: s.Refresh, request: Request, db: DB):
    limited(db, "refresh:" + request.client.host, 60)
    session = db.scalar(select(m.Session).where(m.Session.refresh_hash == digest(body.refresh_token)).with_for_update())
    if not session or session.revoked or session.refresh_expires < time.time():
        raise HTTPException(401, "refresh_expired_or_revoked")
    device = db.get(m.Device, session.device_id)
    if device.revoked:
        raise HTTPException(401, "device_revoked")
    session.revoked = True
    result = issue(db, device, session.profile_id, session.admin)
    db.commit()
    return result


@app.post("/v1/auth/revoke")
def revoke(db: DB, auth: Auth):
    auth[0].revoked = True
    db.commit()
    return {"revoked": True}


@app.post("/v1/auth/pair/start", status_code=201)
def pair_start(body: s.PairStart, request: Request, db: DB):
    limited(db, "pair-start:" + request.client.host, 6)
    secret = secrets.token_urlsafe(32)
    pairing = m.Pairing(secret_hash=digest(secret), code=secrets.token_hex(4).upper(), expires=time.time() + 300,
                        device_name=body.name, platform=body.platform)
    db.add(pairing)
    db.commit()
    return {"secret": secret, "code": pairing.code, "expires_in": 300}


@app.post("/v1/auth/pair/approve")
def pair_approve(body: s.PairApprove, db: DB, auth: Auth):
    profile = profile_for(db, auth, body.profile_id, admin_only=True)
    limited(db, "pair-approve:" + auth[1].id, 10)
    pairing = db.scalar(select(m.Pairing).where(m.Pairing.code == body.code).with_for_update())
    if not pairing or pairing.consumed or pairing.expires < time.time() or pairing.household_id:
        raise HTTPException(404, "pairing_expired_or_unknown")
    pairing.household_id, pairing.profile_id = profile.household_id, profile.id
    audit(db, auth, "pair_approved", pairing.id)
    db.commit()
    return {"approved": True}


@app.post("/v1/auth/pair/complete")
def pair_complete(body: s.PairComplete, request: Request, db: DB):
    limited(db, "pair-complete:" + request.client.host, 60)
    pairing = db.scalar(select(m.Pairing).where(m.Pairing.secret_hash == digest(body.secret)).with_for_update())
    if not pairing or pairing.expires < time.time() or pairing.consumed:
        raise HTTPException(410, "pairing_expired_or_consumed")
    if not pairing.household_id:
        raise HTTPException(409, "awaiting_admin_approval")
    pairing.consumed = True
    device = m.Device(household_id=pairing.household_id, name=pairing.device_name, platform=pairing.platform)
    db.add(device)
    db.flush()
    result = issue(db, device, pairing.profile_id)
    db.commit()
    return result


@app.get("/v1/devices")
def devices(db: DB, auth: Auth):
    admin(auth)
    return [{"id": d.id, "name": d.name, "platform": d.platform, "revoked": d.revoked} for d in
            db.scalars(select(m.Device).where(m.Device.household_id == auth[1].household_id))]


@app.delete("/v1/devices/{did}")
def remove_device(did: UUID, db: DB, auth: Auth):
    admin(auth)
    device = db.get(m.Device, str(did))
    if not device or device.household_id != auth[1].household_id:
        raise HTTPException(404, "device_not_found")
    device.revoked = True
    audit(db, auth, "device_revoked", device.id)
    db.commit()
    return {"revoked": True}


@app.get("/v1/profiles")
def profiles(db: DB, auth: Auth):
    query = select(m.Profile).where(m.Profile.household_id == auth[1].household_id)
    if not auth[0].admin:
        query = query.where(m.Profile.id == auth[0].profile_id)
    return [profile_json(p) for p in db.scalars(query.order_by(m.Profile.created_at))]


@app.post("/v1/profiles", status_code=201)
def add_profile(body: s.ProfileInput, db: DB, auth: Auth):
    admin(auth)
    if db.scalar(select(func.count()).select_from(m.Profile).where(m.Profile.household_id == auth[1].household_id)) >= 20:
        raise HTTPException(409, "household_profile_limit")
    profile = m.Profile(household_id=auth[1].household_id, name=body.name, avatar=body.avatar,
                        kid=body.kid, max_age=body.max_age, pin_hash=passwords.hash(body.pin) if body.pin else None)
    db.add(profile)
    db.flush()
    audit(db, auth, "profile_created", profile.id)
    db.commit()
    return profile_json(profile)


@app.patch("/v1/profiles/{pid}")
def edit_profile(pid: UUID, body: s.ProfileInput, db: DB, auth: Auth, if_match: Annotated[str, Header()]):
    profile = profile_for(db, auth, pid, admin_only=True)
    if if_match != str(profile.revision):
        raise HTTPException(409, "version_conflict")
    profile.name, profile.avatar, profile.kid, profile.max_age = body.name, body.avatar, body.kid, body.max_age
    profile.pin_hash = passwords.hash(body.pin) if body.pin else None
    profile.revision += 1
    audit(db, auth, "profile_updated", profile.id)
    db.commit()
    return profile_json(profile)


@app.delete("/v1/profiles/{pid}")
def remove_profile(pid: UUID, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid, admin_only=True)
    audit(db, auth, "profile_deleted", profile.id)
    db.delete(profile)
    db.commit()
    return {"deleted": True}


@app.post("/v1/profiles/{pid}/pin/verify")
def check_pin(pid: UUID, body: s.Pin, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid)
    limited(db, "pin:" + profile.id + auth[1].id, 5)
    if profile.pin_hash and not verify(profile.pin_hash, body.pin):
        raise HTTPException(403, "incorrect_pin")
    return {"verified": True}


@app.post("/v1/profiles/{pid}/activate")
def activate_profile(pid: UUID, body: s.Pin, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid)
    limited(db, "activate:" + profile.id + auth[1].id, 5)
    already_scoped = not auth[0].admin and auth[0].profile_id == profile.id
    if profile.pin_hash and not already_scoped and not verify(profile.pin_hash, body.pin):
        raise HTTPException(403, "incorrect_pin")
    result = issue(db, auth[1], profile.id)
    db.commit()
    return result


@app.get("/v1/profiles/{pid}/preferences")
def get_preferences(pid: UUID, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid)
    pref = db.scalar(select(m.Preference).where(m.Preference.profile_id == profile.id))
    return {"version": pref.version if pref else 0, **(pref.value if pref else {})}


@app.put("/v1/profiles/{pid}/preferences")
def put_preferences(pid: UUID, body: s.Preferences, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid)
    if profile.kid:
        admin(auth)
    pref = db.scalar(select(m.Preference).where(m.Preference.profile_id == profile.id).with_for_update())
    if body.version != (pref.version if pref else 0):
        raise HTTPException(409, "version_conflict")
    value = body.model_dump(mode="json", exclude={"version"})
    if not pref:
        pref = m.Preference(profile_id=profile.id, version=0)
        db.add(pref)
    pref.value = value
    pref.version += 1
    profile.revision += 1
    db.commit()
    return {"version": pref.version, **value}


@app.post("/v1/profiles/{pid}/feedback", status_code=201)
def feedback(pid: UUID, body: s.FeedbackInput, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid)
    work_for(db, auth, profile, body.work_id)
    existing = db.get(m.Feedback, str(body.id))
    if existing:
        if existing.profile_id != profile.id or existing.work_id != str(body.work_id) or existing.action != body.action:
            raise HTTPException(409, "idempotency_conflict")
        return {"id": existing.id}
    db.add(m.Feedback(id=str(body.id), profile_id=profile.id, work_id=str(body.work_id), action=body.action))
    profile.revision += 1
    db.commit()
    return {"id": str(body.id)}


@app.delete("/v1/profiles/{pid}/feedback/{fid}")
def undo_feedback(pid: UUID, fid: UUID, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid)
    event = db.get(m.Feedback, str(fid))
    if not event or event.profile_id != profile.id:
        raise HTTPException(404, "feedback_not_found")
    event.undone = True
    profile.revision += 1
    db.commit()
    return {"undone": True}


@app.get("/v1/profiles/{pid}/watchlist")
def get_watchlist(pid: UUID, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid)
    ids = set(db.scalars(select(m.Watchlist.work_id).where(m.Watchlist.profile_id == profile.id)))
    prefs = prefs_for(db, profile.id)
    return [work_json(db, w) for w in visible_works(db, auth, profile.id) if w.id in ids and allowed(w, profile, prefs)]


@app.put("/v1/profiles/{pid}/watchlist/{wid}")
def save_work(pid: UUID, wid: UUID, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid)
    work_for(db, auth, profile, wid)
    if not db.scalar(select(m.Watchlist).where(m.Watchlist.profile_id == profile.id, m.Watchlist.work_id == str(wid))):
        db.add(m.Watchlist(profile_id=profile.id, work_id=str(wid)))
        profile.revision += 1
    db.commit()
    return {"saved": True}


@app.delete("/v1/profiles/{pid}/watchlist/{wid}")
def unsave_work(pid: UUID, wid: UUID, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid)
    db.execute(delete(m.Watchlist).where(m.Watchlist.profile_id == profile.id, m.Watchlist.work_id == str(wid)))
    profile.revision += 1
    db.commit()
    return {"saved": False}


def recommendations(db, auth, profile, refresh=False):
    prefs = prefs_for(db, profile.id)
    works = visible_works(db, auth, profile.id)
    sources = [(c.id, c.updated_at) for c in db.scalars(select(m.CuratedSource).where(m.CuratedSource.household_id == auth[1].household_id))]
    key = cache_key(profile, prefs, sources, max((w.updated_at for w in works), default=0))
    snapshot = db.scalar(select(m.Snapshot).where(m.Snapshot.cache_key == key))
    if refresh or not snapshot or snapshot.expires < time.time():
        history = list(db.scalars(select(m.WatchEvent).where(m.WatchEvent.profile_id == profile.id)))
        feedback = list(db.scalars(select(m.Feedback).where(m.Feedback.profile_id == profile.id)))
        saved = list(db.scalars(select(m.Watchlist.work_id).where(m.Watchlist.profile_id == profile.id)))
        ranked = rank(works, profile, prefs, history, feedback, time.time(), watchlist=saved)
        if not snapshot:
            snapshot = m.Snapshot(profile_id=profile.id, cache_key=key, algorithm=ALGORITHM, expires=time.time() + 900)
            db.add(snapshot)
            db.flush()
        else:
            db.execute(delete(m.RecommendationItem).where(m.RecommendationItem.snapshot_id == snapshot.id))
            snapshot.expires = time.time() + 900
        for index, item in enumerate(ranked):
            db.add(m.RecommendationItem(snapshot_id=snapshot.id, rank=index, **item))
        db.commit()
    by_id = {w.id: w for w in works}
    entries = db.scalars(select(m.RecommendationItem).where(m.RecommendationItem.snapshot_id == snapshot.id).order_by(m.RecommendationItem.rank))
    return [{**work_json(db, by_id[i.work_id]), "rationale": i.rationale, "features": i.features, "score": i.score}
            for i in entries if i.work_id in by_id and allowed(by_id[i.work_id], profile, prefs)]


@app.get("/v1/profiles/{pid}/recommendations")
def get_recommendations(pid: UUID, db: DB, auth: Auth, refresh: bool = False):
    return {"algorithm": ALGORITHM, "items": recommendations(db, auth, profile_for(db, auth, pid), refresh)}


@app.get("/v1/profiles/{pid}/home")
def home(pid: UUID, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid)
    items = recommendations(db, auth, profile)
    works = {w.id: w for w in visible_works(db, auth, profile.id)}
    prefs = prefs_for(db, profile.id)
    continuing = [{**work_json(db, works[p.work_id]), "position": p.position, "duration": p.duration,
                   "episode_id": p.episode_key or None, "conflict": p.conflict, "version": p.version}
                  for p in db.scalars(select(m.Playback).where(m.Playback.profile_id == profile.id,
                                         m.Playback.completed.is_(False), m.Playback.position > 15).order_by(m.Playback.occurred.desc()))
                  if p.work_id in works and allowed(works[p.work_id], profile, prefs)]
    rows = [{"id": "continue", "name": "Continue Watching", "items": continuing},
            {"id": "picks", "name": "Top Picks for You", "items": items},
            {"id": "list", "name": "Your List", "items": get_watchlist(pid, db, auth)},
            {"id": "different", "name": "Discover Something Different", "items": [i for i in items if i["features"]["novelty"]]}]
    order = prefs.get("row_order", [])
    rows.sort(key=lambda row: order.index(row["id"]) if row["id"] in order else len(order))
    return {"profile": profile_json(profile), "rows": [r for r in rows if r["items"]], "computed_at": time.time(),
            "empty_message": "Add a permitted metadata catalog in Admin Settings to discover titles. Catalogs do not provide streams."}


@app.get("/v1/profiles/{pid}/search")
def search(pid: UUID, db: DB, auth: Auth, q: str = Query(default="", max_length=200),
           kind: str | None = None, genre: str | None = None, min_year: int = 0, max_year: int = 3000,
           language: str | None = None, max_runtime: int | None = None,
           unwatched: bool = False, cursor: int = Query(default=0, ge=0), limit: int = Query(default=40, ge=1, le=100)):
    from difflib import SequenceMatcher
    from .importer import normalized
    profile = profile_for(db, auth, pid)
    if len(q.strip()) >= 2 and cursor == 0:
        from .resolver import MetadataResolver
        MetadataResolver(db, profile).search(q)
        db.commit()
    prefs, needle = prefs_for(db, profile.id), normalized(q)
    watched = set(db.scalars(select(m.WatchEvent.work_id).where(m.WatchEvent.profile_id == profile.id))) if unwatched else set()
    works = [w for w in visible_works(db, auth, profile.id) if allowed(w, profile, prefs) and w.id not in watched
             and (not kind or w.kind == kind) and (not genre or genre in w.genres)
             and (not w.year or min_year <= w.year <= max_year)
             and (not language or w.language == language) and (not max_runtime or w.runtime and w.runtime <= max_runtime)
             and (not needle or needle in normalized(w.title) or SequenceMatcher(None, needle, normalized(w.title)).ratio() > 0.65)]
    works.sort(key=lambda w: (w.title.casefold(), w.id))
    return {"items": [work_json(db, w) for w in works[cursor:cursor + limit]],
            "next_cursor": cursor + limit if cursor + limit < len(works) else None}


@app.post("/v1/sync/events")
def sync_events(body: s.SyncInput, db: DB, auth: Auth):
    results = []
    for item in body.events:
        profile = profile_for(db, auth, item.profile_id)
        # Serialize all state changes for this profile on PostgreSQL.
        db.execute(select(m.Profile.id).where(m.Profile.id == profile.id).with_for_update())
        work = work_for(db, auth, profile, item.work_id)
        if item.occurred > time.time() + 120 or item.position > item.duration + 30:
            raise HTTPException(422, "invalid_playback_time")
        if work.kind == "series" and item.episode_id is None:
            raise HTTPException(422, "episode_required_for_series_progress")
        if item.episode_id:
            episode = db.get(m.Episode, str(item.episode_id))
            if not episode or episode.work_id != work.id:
                raise HTTPException(422, "invalid_episode")
        existing = db.scalar(select(m.WatchEvent).where(m.WatchEvent.profile_id == profile.id,
                             m.WatchEvent.source == "stremio_client", m.WatchEvent.source_event_id == str(item.id)))
        if existing:
            if existing.work_id != work.id or existing.playback_session != str(item.playback_session):
                raise HTTPException(409, "idempotency_conflict")
            results.append({"id": str(item.id), "status": "duplicate"})
            continue
        key = str(item.episode_id) if item.episode_id else ""
        previous = db.scalar(select(m.Playback).where(m.Playback.profile_id == profile.id,
                             m.Playback.work_id == work.id, m.Playback.episode_key == key).with_for_update())
        if item.expected_version is not None and item.expected_version != (previous.version if previous else 0):
            raise HTTPException(409, "playback_version_conflict")
        complete = item.position / item.duration >= (0.85 if item.episode_id else 0.90)
        incoming = Progress(item.position, item.duration, item.occurred, str(item.playback_session), str(item.id), complete)
        old = Progress(previous.position, previous.duration, previous.occurred, previous.playback_session,
                       previous.source_event_id, previous.completed, previous.conflict) if previous else None
        if item.event_type == "resolve_conflict" and item.expected_version is None:
            raise HTTPException(422, "resolution_requires_version")
        resolved = incoming if item.event_type == "resolve_conflict" else reconcile(old, incoming, item.event_type)
        previous_completion = db.scalar(select(m.WatchEvent.id).where(m.WatchEvent.profile_id == profile.id,
                            m.WatchEvent.work_id == work.id, m.WatchEvent.playback_session == str(item.playback_session),
                            m.WatchEvent.event_type == "completed").limit(1)) if complete else None
        event_type = "completed" if complete and not previous_completion else "heartbeat" if item.event_type == "completed" else item.event_type
        db.add(m.WatchEvent(profile_id=profile.id, work_id=work.id, episode_id=str(item.episode_id) if item.episode_id else None,
                           device_id=auth[1].id, source="stremio_client", source_event_id=str(item.id),
                           event_type=event_type, occurred=item.occurred,
                           playback_session=str(item.playback_session), position=item.position, duration=item.duration))
        if resolved != old:
            values = {"position": resolved.position, "duration": resolved.duration, "occurred": resolved.occurred,
                      "playback_session": resolved.playback_session, "source_event_id": resolved.source_event_id,
                      "completed": resolved.completed, "conflict": resolved.conflict}
            if previous:
                for key_name, value in values.items():
                    setattr(previous, key_name, value)
                previous.version += 1
            else:
                previous = m.Playback(profile_id=profile.id, work_id=work.id, episode_key=key, **values)
                db.add(previous)
        if complete or item.event_type in {"started", "replay_started"}:
            profile.revision += 1
        db.flush()
        results.append({"id": str(item.id), "status": "accepted", "version": previous.version, "conflict": previous.conflict})
    db.commit()
    return {"results": results}


@app.post("/v1/profiles/{pid}/media/resolve")
def media_identity(pid: UUID, body: s.MediaIdentity, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid)
    crosswalk = db.scalar(select(m.ExternalID).where(m.ExternalID.provider == "imdb", m.ExternalID.external_id == body.external_id))
    visible = {w.id for w in visible_works(db, auth, profile.id)}
    if not crosswalk or crosswalk.work_id not in visible:
        from .resolver import MetadataResolver
        work = MetadataResolver(db, profile).by_imdb(body.external_id, "series" if body.season is not None else "movie")
        if not work:
            raise HTTPException(404, "catalog_identity_unresolved")
        db.commit()
        crosswalk = db.scalar(select(m.ExternalID).where(m.ExternalID.provider == "imdb", m.ExternalID.external_id == body.external_id))
    work = work_for(db, auth, profile, crosswalk.work_id)
    episode = None
    if work.kind == "series":
        if body.season is None or body.episode is None:
            raise HTTPException(422, "season_and_episode_required")
        episode = db.scalar(select(m.Episode).where(m.Episode.work_id == work.id,
                             m.Episode.season == body.season, m.Episode.number == body.episode))
        if not episode:
            episode = m.Episode(work_id=work.id, season=body.season, number=body.episode)
            db.add(episode)
            db.commit()
    return {"work_id": work.id, "episode_id": episode.id if episode else None}


@app.get("/v1/sync/changes")
def changes(profile_id: UUID, db: DB, auth: Auth, cursor: float = Query(default=0, ge=0)):
    profile = profile_for(db, auth, profile_id)
    # Capturing the high-water time before the query prevents a missed update between query and cursor.
    until = time.time()
    states = db.scalars(select(m.Playback).where(m.Playback.profile_id == profile.id,
                         m.Playback.updated_at >= cursor, m.Playback.updated_at <= until).order_by(m.Playback.updated_at, m.Playback.id).limit(200))
    values = [{"work_id": p.work_id, "episode_id": p.episode_key or None, "position": p.position,
               "duration": p.duration, "completed": p.completed, "version": p.version,
               "conflict": p.conflict, "updated_at": p.updated_at} for p in states]
    # Inclusive cursor intentionally permits duplicates and never skips equal timestamps.
    return {"items": values, "cursor": values[-1]["updated_at"] if len(values) == 200 else until}


@app.get("/v1/profiles/{pid}/history")
def history(pid: UUID, db: DB, auth: Auth, cursor: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=100)):
    profile = profile_for(db, auth, pid)
    works = {w.id: w for w in visible_works(db, auth, profile.id) if allowed(w, profile, prefs_for(db, profile.id))}
    events = list(db.scalars(select(m.WatchEvent).where(m.WatchEvent.profile_id == profile.id,
                   m.WatchEvent.work_id.in_(works)).order_by(m.WatchEvent.occurred.desc(), m.WatchEvent.id).offset(cursor).limit(limit + 1)))
    return {"items": [{"id": e.id, "work": work_json(db, works[e.work_id]), "source": e.source,
                        "occurred": e.occurred, "event_type": e.event_type} for e in events[:limit]],
            "next_cursor": cursor + limit if len(events) > limit else None}


@app.post("/v1/profiles/{pid}/imports/netflix", status_code=202)
async def netflix(pid: UUID, file: UploadFile, db: DB, auth: Auth, date_order: str = "MDY"):
    profile = profile_for(db, auth, pid, admin_only=True)
    limited(db, "import:" + auth[1].id, 10)
    content = await file.read(MAX_BYTES + 1)
    try:
        with ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn")) as parser:
            parsed = await asyncio.get_running_loop().run_in_executor(parser, parse_csv_restricted, content, date_order)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    file_digest = hashlib.sha256(content).hexdigest()
    existing = db.scalar(select(m.ImportBatch).where(m.ImportBatch.profile_id == profile.id, m.ImportBatch.digest == file_digest))
    if existing:
        if existing.date_order != date_order:
            raise HTTPException(409, "date_order_changed_remove_import_before_reimport")
        return {"id": existing.id, "status": existing.status, "duplicate": True}
    batch = m.ImportBatch(profile_id=profile.id, digest=file_digest, date_order=date_order)
    db.add(batch)
    db.flush()
    for row in parsed:
        db.add(m.ImportRow(batch_id=batch.id, source_hash=row.source_hash, title=row.title,
                           watched_at=row.watched_at, probable_episode=row.probable_episode, status="pending_resolution"))
    audit(db, auth, "netflix_import_created", batch.id)
    db.commit()
    return {"id": batch.id, "status": "queued", "rows": len(parsed)}


def batch_for(db, auth, bid):
    batch = db.get(m.ImportBatch, str(bid))
    if not batch:
        raise HTTPException(404, "import_not_found")
    profile = profile_for(db, auth, batch.profile_id, admin_only=True)
    return batch, profile


@app.get("/v1/profiles/{pid}/imports")
def imports(pid: UUID, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid, admin_only=True)
    return [{"id": b.id, "status": b.status, "created_at": b.created_at} for b in
            db.scalars(select(m.ImportBatch).where(m.ImportBatch.profile_id == profile.id).order_by(m.ImportBatch.created_at.desc()).limit(100))]


@app.get("/v1/imports/{bid}")
def get_import(bid: UUID, db: DB, auth: Auth, cursor: int = Query(default=0, ge=0), limit: int = Query(default=100, ge=1, le=200)):
    batch, _ = batch_for(db, auth, bid)
    counts = dict(db.execute(select(m.ImportRow.status, func.count()).where(m.ImportRow.batch_id == batch.id).group_by(m.ImportRow.status)).all())
    rows = list(db.scalars(select(m.ImportRow).where(m.ImportRow.batch_id == batch.id).order_by(m.ImportRow.created_at, m.ImportRow.id).offset(cursor).limit(limit + 1)))
    return {"id": batch.id, "status": batch.status, "counts": counts,
            "items": [{"id": r.id, "title": r.title, "watched_at": r.watched_at, "status": r.status,
                       "confidence": r.confidence, "candidates": r.candidates, "work_id": r.work_id,
                       "probable_episode": r.probable_episode} for r in rows[:limit]],
            "next_cursor": cursor + limit if len(rows) > limit else None}


def map_import(db, profile, row, work):
    row.work_id, row.status = work.id, "matched"
    prior = db.scalar(select(m.WatchEvent).where(m.WatchEvent.profile_id == profile.id,
                        m.WatchEvent.source == "netflix_import", m.WatchEvent.source_event_id == row.source_hash))
    if prior:
        row.work_id = prior.work_id
    else:
        # A CSV episode is an interest event only; it creates no completed episode or season.
        db.add(m.WatchEvent(profile_id=profile.id, work_id=work.id, batch_id=row.batch_id,
                           source="netflix_import", source_event_id=row.source_hash,
                           event_type="imported_episode" if row.probable_episode else "imported_watch", occurred=row.watched_at))
    profile.revision += 1


@app.post("/v1/imports/{bid}/resolve")
def resolve_import(bid: UUID, body: s.Resolve, db: DB, auth: Auth):
    batch, profile = batch_for(db, auth, bid)
    row = db.get(m.ImportRow, str(body.row_id))
    if not row or row.batch_id != batch.id:
        raise HTTPException(404, "row_not_found")
    # Remove all matching imported evidence for this row; never touch Stremio progress.
    db.execute(delete(m.WatchEvent).where(m.WatchEvent.profile_id == profile.id, m.WatchEvent.source == "netflix_import", m.WatchEvent.source_event_id == row.source_hash))
    db.flush()
    row.work_id = None
    row.status = "skipped" if body.action == "skip" else "needs_review"
    if body.action == "confirm":
        if body.work_id is None:
            raise HTTPException(422, "work_required")
        work = work_for(db, auth, profile, body.work_id)
        map_import(db, profile, row, work)
    # Repeated batches reference the same genuine dated watch, so its mapping decision is canonical.
    related = db.scalars(select(m.ImportRow).join(m.ImportBatch).where(m.ImportBatch.profile_id == profile.id,
                         m.ImportRow.source_hash == row.source_hash, m.ImportRow.id != row.id))
    for other in related:
        other.work_id, other.status = row.work_id, row.status
    profile.revision += 1
    db.commit()
    return {"status": row.status}


@app.delete("/v1/imports/{bid}")
def delete_import(bid: UUID, db: DB, auth: Auth):
    batch, profile = batch_for(db, auth, bid)
    # Preserve a shared watch if another retained incremental batch still establishes its provenance.
    for event in db.scalars(select(m.WatchEvent).where(m.WatchEvent.batch_id == batch.id)):
        replacement = db.scalar(select(m.ImportRow).join(m.ImportBatch).where(m.ImportBatch.profile_id == profile.id,
                               m.ImportBatch.id != batch.id, m.ImportRow.source_hash == event.source_event_id,
                               m.ImportRow.status == "matched", m.ImportRow.work_id == event.work_id)
                                .order_by(m.ImportBatch.created_at, m.ImportBatch.id).limit(1))
        if replacement:
            event.batch_id = replacement.batch_id
    db.flush()
    db.delete(batch)
    profile.revision += 1
    audit(db, auth, "netflix_import_deleted", batch.id)
    db.commit()
    return {"deleted": True}


@app.get("/v1/profiles/{pid}/export")
def export_profile(pid: UUID, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid, admin_only=True)
    def rows(model):
        records = db.scalars(select(model).where(model.profile_id == profile.id))
        return [{c.name: getattr(r, c.name) for c in model.__table__.columns if c.name not in {"pin_hash"}} for r in records]
    batches = list(db.scalars(select(m.ImportBatch).where(m.ImportBatch.profile_id == profile.id)))
    imported = db.scalars(select(m.ImportRow).where(m.ImportRow.batch_id.in_([b.id for b in batches])))
    result = {"schema": 1, "profile": profile_json(profile), "preferences": prefs_for(db, profile.id),
              "events": rows(m.WatchEvent), "playback": rows(m.Playback), "feedback": rows(m.Feedback),
              "watchlist": rows(m.Watchlist), "bindings": rows(m.Binding), "metadata_links": rows(m.ProfileMedia), "import_batches": rows(m.ImportBatch),
              "import_rows": [{c.name: getattr(r, c.name) for c in m.ImportRow.__table__.columns} for r in imported]}
    audit(db, auth, "profile_exported", profile.id)
    db.commit()
    return result


@app.get("/v1/community/sources")
def sources(db: DB, auth: Auth):
    admin(auth)
    return [{"id": c.id, "name": c.name, "manifest_url": c.manifest_url, "status": c.status} for c in
            db.scalars(select(m.CuratedSource).where(m.CuratedSource.household_id == auth[1].household_id))]


@app.post("/v1/community/sources", status_code=201)
def add_source(body: s.SourceInput, db: DB, auth: Auth):
    from .providers import validate_manifest
    admin(auth)
    try:
        validate_manifest(body.manifest_url)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    source = m.CuratedSource(household_id=auth[1].household_id, name=body.name, manifest_url=body.manifest_url)
    db.add(source)
    db.flush()
    audit(db, auth, "source_added", source.id)
    db.commit()
    return {"id": source.id}


@app.delete("/v1/community/sources/{sid}")
def delete_source(sid: UUID, db: DB, auth: Auth):
    admin(auth)
    source = db.get(m.CuratedSource, str(sid))
    if not source or source.household_id != auth[1].household_id:
        raise HTTPException(404, "source_not_found")
    db.delete(source)
    audit(db, auth, "source_removed", str(sid))
    db.commit()
    return {"deleted": True}


@app.get("/v1/community/lists")
def lists(profile_id: UUID, db: DB, auth: Auth):
    profile = profile_for(db, auth, profile_id)
    hidden = prefs_for(db, profile.id).get("hidden_sources", [])
    rows = db.execute(select(m.CuratedList, m.CuratedSource).join(m.CuratedSource).where(
        m.CuratedSource.household_id == auth[1].household_id, m.CuratedSource.enabled.is_(True)))
    return [{"id": collection.id, "name": collection.name, "source": source.name,
             "attribution": collection.attribution, "fetched": collection.fetched,
             "stale": source.status != "ready" or collection.fetched < time.time() - 86400,
             "description": collection.description, "source_id": source.id}
            for collection, source in rows if source.id not in hidden]


@app.get("/v1/community/lists/{lid}")
def get_list(lid: UUID, profile_id: UUID, db: DB, auth: Auth, mode: str = "original"):
    profile = profile_for(db, auth, profile_id)
    collection = db.get(m.CuratedList, str(lid))
    source = db.get(m.CuratedSource, collection.source_id) if collection else None
    if not source or source.household_id != auth[1].household_id or not source.enabled:
        raise HTTPException(404, "list_not_found")
    memberships = list(db.scalars(select(m.CuratedItem).where(m.CuratedItem.list_id == collection.id).order_by(m.CuratedItem.original_rank)))
    works = {w.id: w for w in visible_works(db, auth, profile.id)}
    prefs = prefs_for(db, profile.id)
    if mode == "personalized":
        ranked = rank(list(works.values()), profile, prefs,
                      list(db.scalars(select(m.WatchEvent).where(m.WatchEvent.profile_id == profile.id))),
                      list(db.scalars(select(m.Feedback).where(m.Feedback.profile_id == profile.id))),
                      time.time(), {i.work_id for i in memberships}, limit=200)
        entries = [{**work_json(db, works[i["work_id"]]), "rationale": i["rationale"]} for i in ranked]
    elif mode == "original":
        entries = [{**work_json(db, works[i.work_id]), "original_rank": i.original_rank}
                   for i in memberships if i.work_id in works and allowed(works[i.work_id], profile, prefs)]
    else:
        raise HTTPException(422, "unknown_list_mode")
    return {"name": collection.name, "attribution": collection.attribution, "fetched": collection.fetched,
            "stale": source.status != "ready", "mode": mode, "items": entries}


@app.post("/v1/community/lists/{lid}/report")
def report_list(lid: UUID, profile_id: UUID, db: DB, auth: Auth):
    get_list(lid, profile_id, db, auth)
    audit(db, auth, "broken_list_reported", str(lid))
    db.commit()
    return {"reported": True}


@app.post("/v1/profiles/{pid}/stremio-binding")
def bind_stremio(pid: UUID, body: s.StremioBinding, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid)
    existing = db.scalar(select(m.Binding).where(m.Binding.profile_id == profile.id))
    if existing:
        if existing.stremio_user_id != body.stremio_user_id:
            raise HTTPException(409, "reconnect_original_stremio_account")
        return {"status": existing.status}
    duplicate = db.scalar(select(m.Binding).where(m.Binding.stremio_user_id == body.stremio_user_id))
    if duplicate:
        raise HTTPException(409, "stremio_account_already_bound")
    db.add(m.Binding(profile_id=profile.id, stremio_user_id=body.stremio_user_id,
                     status="client_runtime_verified", verified_at=time.time()))
    audit(db, auth, "stremio_account_bound", profile.id)
    db.commit()
    return {"status": "client_runtime_verified"}


@app.delete("/v1/profiles/{pid}/stremio-binding")
def remove_binding(pid: UUID, db: DB, auth: Auth):
    profile = profile_for(db, auth, pid, admin_only=True)
    db.execute(delete(m.Binding).where(m.Binding.profile_id == profile.id))
    audit(db, auth, "stremio_account_unbound", profile.id)
    db.commit()
    return {"unbound": True}


app.mount("/", StaticFiles(directory=Path(__file__).parent.parent / "web", html=True), name="household")
