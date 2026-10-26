import os
import sys
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).parents[1]))
os.environ["BOOTSTRAP_TOKEN"] = "synthetic-enrollment-token-" + "x" * 32

from service.db import database
from service.main import app
from service.models import Base, CuratedItem, CuratedList, CuratedSource, ExternalID, Work


@pytest.fixture
def env(tmp_path):
    postgres = os.getenv("TEST_DATABASE_URL")
    schema = "test_" + uuid.uuid4().hex
    bootstrap_engine = None
    if postgres:
        bootstrap_engine = create_engine(postgres)
        with bootstrap_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(postgres, connect_args={"options": f"-csearch_path={schema}"})
    else:
        engine = create_engine(f"sqlite:///{tmp_path}/test.sqlite", connect_args={"check_same_thread": False})
        @event.listens_for(engine, "connect")
        def fks(conn, _):
            conn.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    def override():
        with factory() as db:
            yield db
    app.dependency_overrides[database] = override
    with TestClient(app) as client:
        response = client.post("/v1/admin/bootstrap", json={"name": "Synthetic home", "password": "synthetic-password-123",
                                                            "enrollment_token": os.environ["BOOTSTRAP_TOKEN"]})
        assert response.status_code == 201, response.text
        credentials = response.json()
        admin = {"Authorization": "Bearer " + credentials["access_token"]}
        a = client.post("/v1/profiles", headers=admin, json={"name": "Profile A"}).json()
        b = client.post("/v1/profiles", headers=admin, json={"name": "Profile B"}).json()
        kid = client.post("/v1/profiles", headers=admin, json={"name": "Kids", "kid": True, "max_age": 10}).json()
        with factory() as db:
            source = CuratedSource(household_id=credentials["household_id"], name="Synthetic curated test catalog",
                                   manifest_url="https://catalog.example/manifest.json", status="ready")
            db.add(source)
            db.flush()
            collection = CuratedList(source_id=source.id, catalog_id="test", kind="movie", name="Synthetic collection", attribution="Test fixture")
            db.add(collection)
            db.flush()
            works = []
            for index, (title, age, genre) in enumerate([("Orbit Example", 8, "Science Fiction"), ("Another Orbit", 13, "Science Fiction"),
                                                         ("Garden Example", None, "Drama"), ("Family Example", 0, "Family")]):
                work = Work(kind="movie", title=title, age=age, genres=[genre], year=2024, provenance="synthetic")
                db.add(work)
                db.flush()
                db.add(ExternalID(work_id=work.id, provider="imdb", external_id=f"tt990000{index}"))
                db.add(CuratedItem(list_id=collection.id, work_id=work.id, original_rank=index))
                works.append(work.id)
            db.commit()
            collection_id = collection.id
        def pair(profile):
            start = client.post("/v1/auth/pair/start", json={"name": "Test device", "platform": "windows"}).json()
            assert client.post("/v1/auth/pair/approve", headers=admin, json={"code": start["code"], "profile_id": profile["id"]}).status_code == 200
            result = client.post("/v1/auth/pair/complete", json={"secret": start["secret"]}).json()
            return {"Authorization": "Bearer " + result["access_token"]}, result, start
        ah, ac, start = pair(a)
        bh, bc, _ = pair(b)
        kh, kc, _ = pair(kid)
        yield {"client": client, "admin": admin, "credentials": credentials, "a": a, "b": b, "kid": kid,
               "ah": ah, "bh": bh, "kh": kh, "ac": ac, "bc": bc, "kc": kc, "pair": start,
               "works": works, "factory": factory, "list": collection_id}
    app.dependency_overrides.clear()
    engine.dispose()
    if bootstrap_engine:
        with bootstrap_engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        bootstrap_engine.dispose()
