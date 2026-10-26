"""Read-only provider compatibility check against official Cinemeta. No account data is transmitted."""
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2] / "household"))
with tempfile.TemporaryDirectory(prefix="household-provider-test-") as scratch:
    os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(scratch) / "catalog.sqlite")
    os.environ["CATALOG_HOST_ALLOWLIST"] = "v3-cinemeta.strem.io,cinemeta-catalogs.strem.io"
    from service.db import engine, SessionLocal
    from service.models import Base, Household, Profile, CuratedSource, Work, CuratedList
    from service.resolver import MetadataResolver
    from service.worker import source_job
    from sqlalchemy import select, func, create_engine
    from sqlalchemy.pool import NullPool
    engine.dispose()
    engine = create_engine(os.environ["DATABASE_URL"], poolclass=NullPool)
    SessionLocal.configure(bind=engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        household = Household(name="Synthetic compatibility check", admin_hash="disabled-fixture")
        db.add(household)
        db.flush()
        source = CuratedSource(household_id=household.id, name="Cinemeta", manifest_url="https://v3-cinemeta.strem.io/manifest.json")
        db.add(source)
        db.flush()
        source_job(db, source)
        profile = Profile(household_id=household.id, name="Synthetic resolver check")
        db.add(profile)
        db.flush()
        resolver = MetadataResolver(db, profile)
        resolved = resolver.search("The Cabinet of Dr. Caligari")
        exact = resolver.by_imdb("tt0010323", "movie")
        db.commit()
        result = {"provider": "Cinemeta", "status": source.status,
                  "works": db.scalar(select(func.count()).select_from(Work)),
                  "collections": db.scalar(select(func.count()).select_from(CuratedList)),
                  "metadata_search_results": len(resolved), "imdb_resolution": exact is not None,
                  "contains_private_data": False}
        assert result["works"] > 0 and result["collections"] > 0
        assert result["metadata_search_results"] > 0 and result["imdb_resolution"]
        print(json.dumps(result))
    engine.dispose()
