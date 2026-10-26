import hashlib
import secrets
import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .models import RateLimit, Session

passwords = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def verify(encoded, value):
    try:
        return passwords.verify(encoded, value)
    except (VerificationError, InvalidHashError):
        return False


def limited(db, key, maximum=10, seconds=300):
    """Atomic shared limiter, including failed requests; works across API workers."""
    key = digest(key)
    window = int(time.time() // seconds)
    insert = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
    stmt = insert(RateLimit).values(key=key, window=window, count=1)
    from sqlalchemy import case
    stmt = stmt.on_conflict_do_update(index_elements=[RateLimit.key], set_={
        "window": window,
        "count": case((RateLimit.window == window, RateLimit.count + 1), else_=1),
    })
    db.execute(stmt)
    db.commit()
    row = db.get(RateLimit, key, populate_existing=True)
    if row.count > maximum:
        raise HTTPException(429, "rate_limited", headers={"Retry-After": str(seconds)})


def issue(db, device, profile_id=None, admin=False):
    token, refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    now = time.time()
    session = Session(device_id=device.id, profile_id=profile_id, admin=admin,
                      token_hash=digest(token), refresh_hash=digest(refresh),
                      expires=now + 1800, refresh_expires=now + 30 * 86400)
    db.add(session)
    db.flush()
    return {"access_token": token, "refresh_token": refresh, "expires_in": 1800,
            "session_id": session.id, "profile_id": profile_id, "admin": admin}


def authenticate(db, header):
    if not header or not header.startswith("Bearer "):
        raise HTTPException(401, "authentication_required")
    session = db.scalar(select(Session).where(Session.token_hash == digest(header[7:])))
    if not session or session.revoked or session.expires < time.time():
        raise HTTPException(401, "session_expired_or_revoked")
    from .models import Device
    device = db.get(Device, session.device_id)
    if not device or device.revoked:
        raise HTTPException(401, "device_revoked")
    return session, device
