"""Disposable UI-test service; contains synthetic records only and binds to loopback."""
import os
import sys
import tempfile
from pathlib import Path

def run():
    sys.path.insert(0, str(Path(__file__).parents[1]))
    scratch = tempfile.TemporaryDirectory(prefix="household-ui-test-")
    os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(scratch.name) / "test.sqlite")
    os.environ["BOOTSTRAP_TOKEN"] = "synthetic-ui-enrollment-token-000000000000"
    os.environ["CATALOG_HOST_ALLOWLIST"] = "catalog.example"

    from service.models import Base, CuratedSource, CuratedList, CuratedItem, ExternalID, Work  # noqa: E402
    from service.db import engine  # noqa: E402
    from service.main import app, DB, Auth, admin  # noqa: E402
    import uvicorn  # noqa: E402

    Base.metadata.create_all(engine)
    static_route = app.router.routes.pop()


    @app.post("/__test__/catalog")
    def synthetic_catalog(db: DB, auth: Auth):
        admin(auth)
        from sqlalchemy import select
        if db.scalar(select(ExternalID.id).where(ExternalID.external_id == "tt9990000")):
            return {"seeded": True}
        source = CuratedSource(household_id=auth[1].household_id, name="Synthetic curator", manifest_url="https://catalog.example/manifest.json", status="ready")
        db.add(source)
        db.flush()
        collection = CuratedList(source_id=source.id, catalog_id="synthetic", kind="movie", name="Synthetic test collection", attribution="Synthetic curator")
        db.add(collection)
        db.flush()
        for index, (title, genre) in enumerate([("Synthetic Orbit Example", "Sci-Fi"), ("Synthetic Garden", "Drama"), ("Synthetic Journey", "Adventure")]):
            work = Work(title=title, kind="movie", genres=[genre], year=2024, age=8, provenance="Synthetic fixture")
            db.add(work)
            db.flush()
            db.add(ExternalID(work_id=work.id, provider="imdb", external_id=f"tt999000{index}"))
            db.add(CuratedItem(list_id=collection.id, work_id=work.id, original_rank=index))
        db.commit()
        return {"seeded": True}


    app.router.routes.append(static_route)
    uvicorn.run(app, host="127.0.0.1", port=8876, access_log=False)


if __name__ == "__main__":
    run()
