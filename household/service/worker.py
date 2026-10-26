"""Durable database jobs; bounded provider IO and retries independent of playback."""
import signal
import time

from sqlalchemy import delete, select

from . import models as m
from .db import SessionLocal
from .importer import candidates_for
from .main import map_import
from .providers import catalog_url, fetch_public, upsert_work, validate_manifest
from .ranking import allowed


def import_job(db, batch):
    from .resolver import MetadataResolver
    profile = db.get(m.Profile, batch.profile_id)
    resolver = MetadataResolver(db, profile)
    sources = select(m.CuratedSource.id).where(m.CuratedSource.household_id == profile.household_id, m.CuratedSource.enabled.is_(True))
    ids = select(m.CuratedItem.work_id).join(m.CuratedList).where(m.CuratedList.source_id.in_(sources))
    works = {w.id: w for w in db.scalars(select(m.Work).where(m.Work.id.in_(ids))) if allowed(w, profile, {})}
    for work in resolver.private_works():
        works[work.id] = work
    for row in db.scalars(select(m.ImportRow).where(m.ImportRow.batch_id == batch.id,
                          m.ImportRow.status == "pending_resolution").order_by(m.ImportRow.created_at, m.ImportRow.id).limit(100)):
        row.status = "needs_review"
        local = candidates_for(row.title, list(works.values()), row.probable_episode)
        if not local or local[0]["confidence"] < 1:
            for work in resolver.search(row.title, row.probable_episode):
                works[work.id] = work
        row.candidates = candidates_for(row.title, list(works.values()), row.probable_episode)
        row.confidence = row.candidates[0]["confidence"] if row.candidates else 0
        if (not row.probable_episode and len([c for c in row.candidates if c["confidence"] >= 0.95]) == 1
                and row.confidence == 1):
            work = works[row.candidates[0]["id"]]
            map_import(db, profile, row, work)
    pending = db.scalar(select(m.ImportRow.id).where(m.ImportRow.batch_id == batch.id, m.ImportRow.status == "pending_resolution").limit(1))
    batch.status = "queued" if pending else "review_ready"


def source_job(db, source, fetch=fetch_public):
    validate_manifest(source.manifest_url)
    manifest = fetch(source.manifest_url)
    if not isinstance(manifest, dict) or not isinstance(manifest.get("id"), str) or not isinstance(manifest.get("catalogs"), list):
        raise ValueError("invalid_manifest")
    catalogs = manifest["catalogs"]
    if len(catalogs) > 40:
        raise ValueError("too_many_catalogs")
    successful = 0
    for catalog in catalogs:
        if not isinstance(catalog, dict) or catalog.get("type") not in {"movie", "series"}:
            continue
        if any(isinstance(e, dict) and e.get("isRequired") for e in catalog.get("extra", [])):
            continue
        cid, kind = catalog.get("id", ""), catalog["type"]
        url = catalog_url(source.manifest_url, kind, cid)
        payload = fetch(url)
        if not isinstance(payload, dict) or not isinstance(payload.get("metas"), list):
            raise ValueError("invalid_catalog")
        collection = db.scalar(select(m.CuratedList).where(m.CuratedList.source_id == source.id,
                              m.CuratedList.catalog_id == cid, m.CuratedList.kind == kind))
        if not collection:
            collection = m.CuratedList(source_id=source.id, catalog_id=cid, kind=kind,
                                        name=str(catalog.get("name", cid))[:150], attribution=source.name)
            db.add(collection)
            db.flush()
        new_items, seen = [], set()
        for original_rank, meta in enumerate(payload["metas"][:200]):
            if not isinstance(meta, dict):
                continue
            from urllib.parse import urlsplit
            work = upsert_work(db, {**meta, "type": kind}, urlsplit(source.manifest_url).hostname)
            if work and work.id not in seen:
                seen.add(work.id)
                new_items.append(m.CuratedItem(list_id=collection.id, work_id=work.id, original_rank=original_rank))
        # An empty/transient response cannot erase a last-known-good populated list.
        if new_items:
            db.execute(delete(m.CuratedItem).where(m.CuratedItem.list_id == collection.id))
            db.add_all(new_items)
            collection.fetched = time.time()
            successful += 1
    if not successful:
        raise ValueError("no_usable_catalogs")
    source.status, source.failures = "ready", 0
    source.next_attempt = time.time() + 21600
    source.updated_at = time.time()


def tick():
    with SessionLocal() as db:
        source = db.scalar(select(m.CuratedSource).where(m.CuratedSource.enabled.is_(True),
                             m.CuratedSource.next_attempt <= time.time()).with_for_update(skip_locked=True).limit(1))
        if source:
            sid = source.id
            try:
                source_job(db, source)
                db.commit()
            except Exception:
                db.rollback()
                source = db.get(m.CuratedSource, sid)
                source.failures += 1
                source.status = "unavailable_cached"
                source.next_attempt = time.time() + min(21600, 30 * 2 ** min(source.failures, 10))
                db.commit()
                # Intentionally no provider payloads, URLs, titles, or histories in logs.
    with SessionLocal() as db:
        batch = db.scalar(select(m.ImportBatch).where(m.ImportBatch.status == "queued").with_for_update(skip_locked=True).limit(1))
        if batch:
            import_job(db, batch)
            db.commit()
    with SessionLocal() as db:
        # Expired snapshots are disposable. History and preferences are never cached-only.
        db.execute(delete(m.Snapshot).where(m.Snapshot.expires < time.time() - 86400))
        db.execute(delete(m.Pairing).where(m.Pairing.expires < time.time() - 86400))
        db.execute(delete(m.Session).where(m.Session.refresh_expires < time.time() - 86400))
        db.commit()


def run():
    running = True

    def stop(*_):
        nonlocal running
        running = False

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    while running:
        try:
            tick()
        except Exception:
            print("worker_cycle_failed_retrying", flush=True)
        for _ in range(30):
            if not running:
                break
            time.sleep(1)


if __name__ == "__main__":
    run()
