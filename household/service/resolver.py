"""Metadata-only Stremio resources. Search titles/IMDb IDs never include profile IDs, dates, or account keys."""
from urllib.parse import quote
import httpx

from sqlalchemy import select

from .models import CuratedSource, ProfileMedia, Work
from .providers import catalog_url, fetch_public, upsert_work, validate_manifest
from .ranking import allowed


class MetadataResolver:
    def __init__(self, db, profile, fetch=fetch_public):
        self.db, self.profile, self.fetch = db, profile, fetch
        self.sources = list(db.scalars(select(CuratedSource).where(CuratedSource.household_id == profile.household_id,
                            CuratedSource.enabled.is_(True), CuratedSource.status == "ready").order_by(CuratedSource.id).limit(3)))
        self.manifests = {}
        self.unavailable = set()
        self.searched = set()

    def manifest(self, source):
        if source.id not in self.manifests:
            self.manifests[source.id] = self.fetch(source.manifest_url)
        return self.manifests[source.id]

    def remember(self, source, meta, kind):
        from urllib.parse import urlsplit
        work = upsert_work(self.db, {**meta, "type": kind}, urlsplit(source.manifest_url).hostname)
        if not work or not allowed(work, self.profile, {}):
            return None
        prior = self.db.scalar(select(ProfileMedia.id).where(ProfileMedia.profile_id == self.profile.id, ProfileMedia.work_id == work.id))
        if not prior:
            self.db.add(ProfileMedia(profile_id=self.profile.id, work_id=work.id, source_id=source.id))
            self.profile.revision += 1
            self.db.flush()
        return work

    def search(self, title, episodic=False):
        title = title.split(":")[0].strip() if episodic else title.strip()
        key = (title.casefold(), episodic)
        if key in self.searched:
            return []
        self.searched.add(key)
        found = {}
        for source in self.sources:
            if source.id in self.unavailable:
                continue
            try:
                manifest = self.manifest(source)
                if not isinstance(manifest, dict) or not isinstance(manifest.get("catalogs"), list):
                    continue
                for kind in (["series"] if episodic else ["movie", "series"]):
                    catalog = next((c for c in manifest["catalogs"] if isinstance(c, dict) and c.get("type") == kind
                                    and ("search" in c.get("extraSupported", []) or any(isinstance(e, dict) and e.get("name") == "search" for e in c.get("extra", [])))), None)
                    if not catalog:
                        continue
                    url = catalog_url(source.manifest_url, kind, catalog["id"]).removesuffix(".json") + "/search=" + quote(title, safe="") + ".json"
                    payload = self.fetch(url)
                    if not isinstance(payload, dict) or not isinstance(payload.get("metas"), list):
                        continue
                    for meta in payload["metas"][:30]:
                        if isinstance(meta, dict):
                            work = self.remember(source, meta, kind)
                            if work:
                                found[work.id] = work
            except (ValueError, OSError, httpx.HTTPError, TypeError):
                self.unavailable.add(source.id)
        return list(found.values())

    def by_imdb(self, external_id, kind):
        for source in self.sources:
            if source.id in self.unavailable:
                continue
            try:
                manifest = self.manifest(source)
                if not isinstance(manifest, dict) or "meta" not in manifest.get("resources", []):
                    continue
                parsed = validate_manifest(source.manifest_url)
                base = source.manifest_url.removesuffix("manifest.json")
                if parsed.query:
                    continue
                payload = self.fetch(base + f"meta/{kind}/{external_id}.json")
                meta = payload.get("meta") if isinstance(payload, dict) else None
                if isinstance(meta, dict) and meta.get("id") == external_id:
                    work = self.remember(source, meta, kind)
                    if work:
                        return work
            except (ValueError, OSError, httpx.HTTPError, TypeError):
                # Provider failure is capability-scoped. The native outbox retains the original event.
                self.unavailable.add(source.id)
        return None

    def private_works(self):
        ids = select(ProfileMedia.work_id).where(ProfileMedia.profile_id == self.profile.id)
        return list(self.db.scalars(select(Work).where(Work.id.in_(ids))))
