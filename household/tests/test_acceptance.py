import time
from uuid import uuid4

import pytest
from sqlalchemy import select

from service import models as m
from service.importer import candidates_for, csv_safe, parse_csv
from service.playback import Progress, reconcile
from service.providers import validate_manifest
from service.ranking import cache_key
from service.worker import import_job, source_job


def test_profile_scope_and_kids(env):
    c, a, b = env["client"], env["a"]["id"], env["b"]["id"]
    for path in ["home", "history", "recommendations", "preferences", "watchlist", "export", "imports"]:
        assert c.get(f"/v1/profiles/{b}/{path}", headers=env["ah"]).status_code == 403
    assert c.get(f"/v1/profiles/{a}/home").status_code == 401
    assert len(c.get("/v1/profiles", headers=env["kh"]).json()) == 1
    home = c.get(f'/v1/profiles/{env["kid"]["id"]}/home', headers=env["kh"]).json()
    assert all(i["age"] is not None and i["age"] <= 10 for row in home["rows"] for i in row["items"])
    assert c.post("/v1/profiles", headers=env["kh"], json={"name": "Bypass"}).status_code == 403
    assert c.post(f'/v1/profiles/{env["kid"]["id"]}/imports/netflix', headers=env["kh"], files={"file": ("x.csv", b"Title,Date\na,1/1/24")}).status_code == 403


def test_pair_single_use_refresh_and_revocation(env):
    c = env["client"]
    assert c.post("/v1/auth/pair/complete", json={"secret": env["pair"]["secret"]}).status_code == 410
    token = c.post("/v1/auth/refresh", json={"refresh_token": env["ac"]["refresh_token"]})
    assert token.status_code == 200
    assert c.get("/v1/session", headers=env["ah"]).status_code == 401
    assert c.post("/v1/auth/refresh", json={"refresh_token": env["ac"]["refresh_token"]}).status_code == 401
    header = {"Authorization": "Bearer " + token.json()["access_token"]}
    c.post("/v1/auth/revoke", headers=header)
    assert c.get("/v1/session", headers=header).status_code == 401


def test_token_expiry(env):
    with env["factory"]() as db:
        session = db.get(m.Session, env["ac"]["session_id"])
        session.expires = 1
        db.commit()
    assert env["client"].get("/v1/session", headers=env["ah"]).status_code == 401


def test_bootstrap_cannot_override_owner(env):
    assert env["client"].post("/v1/admin/bootstrap", json={"name": "Hijack", "password": "another-password123",
                                                          "enrollment_token": "synthetic-enrollment-token-" + "x" * 32}).status_code == 409


def test_profile_preferences_versions(env):
    path = f'/v1/profiles/{env["a"]["id"]}/preferences'
    c = env["client"]
    assert c.put(path, headers=env["ah"], json={"version": 0, "genres": ["Family"]}).status_code == 200
    assert c.put(path, headers=env["ah"], json={"version": 0, "genres": ["Drama"]}).status_code == 409
    assert c.get(path, headers=env["ah"]).json()["genres"] == ["Family"]


def test_feedback_cache_isolation_and_undo(env):
    c, a, b, wid = env["client"], env["a"]["id"], env["b"]["id"], env["works"][0]
    before = c.get(f"/v1/profiles/{b}/recommendations", headers=env["bh"]).json()
    fid = str(uuid4())
    assert c.post(f"/v1/profiles/{a}/feedback", headers=env["ah"], json={"id": fid, "work_id": wid, "action": "hide"}).status_code == 201
    assert wid not in [i["id"] for i in c.get(f"/v1/profiles/{a}/recommendations", headers=env["ah"]).json()["items"]]
    assert before == c.get(f"/v1/profiles/{b}/recommendations", headers=env["bh"]).json()
    assert c.delete(f"/v1/profiles/{a}/feedback/{fid}", headers=env["ah"]).status_code == 200
    assert wid in [i["id"] for i in c.get(f"/v1/profiles/{a}/recommendations", headers=env["ah"]).json()["items"]]


def test_playback_idempotency_out_of_order_completion(env):
    c, a, wid = env["client"], env["a"]["id"], env["works"][0]
    event = {"id": str(uuid4()), "profile_id": a, "work_id": wid, "playback_session": str(uuid4()),
             "event_type": "heartbeat", "occurred": time.time() - 30, "position": 200, "duration": 1000}
    assert c.post("/v1/sync/events", headers=env["ah"], json={"events": [event]}).status_code == 200
    assert c.post("/v1/sync/events", headers=env["ah"], json={"events": [event]}).json()["results"][0]["status"] == "duplicate"
    completed = {**event, "id": str(uuid4()), "occurred": time.time() - 10, "position": 950}
    assert c.post("/v1/sync/events", headers=env["ah"], json={"events": [completed]}).status_code == 200
    stale = {**event, "id": str(uuid4()), "occurred": time.time() - 20, "position": 300}
    c.post("/v1/sync/events", headers=env["ah"], json={"events": [stale]})
    state = c.get("/v1/sync/changes", params={"profile_id": a}, headers=env["ah"]).json()["items"][0]
    assert state["completed"] and state["position"] == 950
    assert c.get("/v1/sync/changes", params={"profile_id": env["b"]["id"]}, headers=env["bh"]).json()["items"] == []
    assert c.post("/v1/sync/events", headers=env["bh"], json={"events": [event]}).status_code == 403


def test_netflix_import_idempotency_mapping_reversal(env):
    c, b, a = env["client"], env["b"]["id"], env["a"]["id"]
    data = b'Title,Date\nOrbit Example,10/01/2026\nMystery Example: Season 1: Episode 1,10/02/2026\n'
    def upload():
        return c.post(f"/v1/profiles/{b}/imports/netflix", headers=env["admin"], files={"file": ("history.csv", data)}).json()
    batch = upload()
    assert upload()["id"] == batch["id"]
    with env["factory"]() as db:
        import_job(db, db.get(m.ImportBatch, batch["id"]))
        db.commit()
    review = c.get(f'/v1/imports/{batch["id"]}', headers=env["admin"]).json()
    assert review["counts"] == {"matched": 1, "needs_review": 1}
    assert len(c.get(f"/v1/profiles/{b}/history", headers=env["bh"]).json()["items"]) == 1
    assert c.get(f"/v1/profiles/{a}/history", headers=env["ah"]).json()["items"] == []
    assert c.get("/v1/sync/changes", params={"profile_id": b}, headers=env["bh"]).json()["items"] == []
    matched = next(row for row in review["items"] if row["status"] == "matched")
    assert c.post(f'/v1/imports/{batch["id"]}/resolve', headers=env["admin"], json={"row_id": matched["id"], "action": "reset"}).status_code == 200
    assert c.get(f"/v1/profiles/{b}/history", headers=env["bh"]).json()["items"] == []
    assert c.delete(f'/v1/imports/{batch["id"]}', headers=env["admin"]).status_code == 200


def test_community_original_personalized_subset(env):
    c, pid = env["client"], env["a"]["id"]
    original = c.get(f'/v1/community/lists/{env["list"]}', params={"profile_id": pid}, headers=env["ah"]).json()
    assert [i["id"] for i in original["items"]] == env["works"]
    ranked = c.get(f'/v1/community/lists/{env["list"]}', params={"profile_id": pid, "mode": "personalized"}, headers=env["ah"]).json()
    assert set(i["id"] for i in ranked["items"]) <= set(env["works"])
    assert original["attribution"] == "Test fixture"


@pytest.mark.parametrize("payload", [b"MZinvalid", b"PKarchive", b"Title,Date\x00", b"<html>bad</html>", b"Title,Date\nx,not-a-date", b"Title,Date\nx,1/1/24,extra"])
def test_malformed_csv(payload):
    with pytest.raises(ValueError):
        parse_csv(payload)


def test_bom_quotes_duplicates_dates_and_formula_export():
    rows = parse_csv('\ufeffTitle,Date\n"Orbit, Example",01/02/2024\n"Orbit, Example",01/02/2024\n'.encode())
    assert len(rows) == 1 and rows[0].title == "Orbit, Example"
    assert parse_csv(b"Title,Date\nx,31/12/2024", "DMY")
    assert csv_safe("=CMD()") == "'=CMD()"


def test_ambiguous_matching_not_auto_resolved():
    works = [m.Work(id=str(uuid4()), title="Example", kind="movie", year=y) for y in (1980, 2020)]
    matches = candidates_for("Example", works)
    assert len(matches) == 2 and all(m["confidence"] == 1 for m in matches)


def test_cache_key_includes_profile_policy_and_revision():
    a = m.Profile(id=str(uuid4()), kid=False, max_age=12, revision=1)
    b = m.Profile(id=str(uuid4()), kid=False, max_age=12, revision=1)
    assert cache_key(a, {}, [], 0) != cache_key(b, {}, [], 0)
    old = cache_key(a, {}, [], 0)
    a.revision = 2
    assert cache_key(a, {}, [], 0) != old


def test_conflict_and_completion_reconciliation():
    old = Progress(200, 1000, 100, "session-a", "1", False)
    new = Progress(800, 1000, 110, "session-b", "2", False)
    assert reconcile(old, new, "heartbeat").conflict
    done = Progress(950, 1000, 120, "session-a", "3", True)
    assert reconcile(done, new, "heartbeat") == done
    replay = Progress(0, 1000, 200, "session-c", "4", False)
    assert reconcile(done, replay, "replay_started") == replay


def test_sources_reject_ssrf_and_credentials(monkeypatch):
    monkeypatch.setenv("CATALOG_HOST_ALLOWLIST", "catalog.example")
    assert validate_manifest("https://catalog.example/manifest.json")
    for url in ["http://catalog.example/manifest.json", "https://127.0.0.1/manifest.json",
                "https://u:p@catalog.example/manifest.json", "https://catalog.example/manifest.json?key=secret"]:
        with pytest.raises(ValueError):
            validate_manifest(url)


def test_provider_failure_preserves_home(env, monkeypatch):
    monkeypatch.setenv("CATALOG_HOST_ALLOWLIST", "catalog.example")
    with env["factory"]() as db:
        source = db.scalar(select(m.CuratedSource))
        with pytest.raises(OSError):
            source_job(db, source, lambda _: (_ for _ in ()).throw(OSError("offline")))
    assert env["client"].get(f'/v1/profiles/{env["a"]["id"]}/home', headers=env["ah"]).json()["rows"]


def test_export_delete_cascade_and_no_secret_columns(env):
    c, pid = env["client"], env["b"]["id"]
    exported = c.get(f"/v1/profiles/{pid}/export", headers=env["admin"])
    assert exported.status_code == 200 and "pin_hash" not in exported.text
    assert c.delete(f"/v1/profiles/{pid}", headers=env["admin"]).status_code == 200
    assert c.get("/v1/session", headers=env["bh"]).status_code == 401
    assert not any("stream_url" in col.name or "stremio_password" in col.name for table in m.Base.metadata.tables.values() for col in table.columns)


def test_stremio_binding_is_one_to_one_and_profile_scoped(env):
    c=env["client"]
    body={"stremio_user_id":"synthetic-account-one", "verification_method":"authenticated_isolated_runtime"}
    assert c.post(f'/v1/profiles/{env["a"]["id"]}/stremio-binding',headers=env["ah"],json=body).status_code==200
    assert c.post(f'/v1/profiles/{env["b"]["id"]}/stremio-binding',headers=env["bh"],json=body).status_code==409
    assert c.post(f'/v1/profiles/{env["a"]["id"]}/stremio-binding',headers=env["bh"],json=body).status_code==403
    changed={**body,"stremio_user_id":"synthetic-account-two"}
    assert c.post(f'/v1/profiles/{env["a"]["id"]}/stremio-binding',headers=env["ah"],json=changed).status_code==409
    assert c.delete(f'/v1/profiles/{env["a"]["id"]}/stremio-binding',headers=env["ah"]).status_code==403


def test_repeated_completion_heartbeats_are_one_completion_signal(env):
    c=env["client"]
    body={"id":str(uuid4()),"profile_id":env["a"]["id"],"work_id":env["works"][0],"playback_session":str(uuid4()),
          "event_type":"heartbeat","occurred":time.time()-20,"position":950,"duration":1000}
    assert c.post('/v1/sync/events',headers=env["ah"],json={"events":[body]}).status_code==200
    assert c.post('/v1/sync/events',headers=env["ah"],json={"events":[{**body,"id":str(uuid4()),"occurred":time.time()-10,"position":960}]}).status_code==200
    with env["factory"]() as db:
        events=list(db.scalars(select(m.WatchEvent).where(m.WatchEvent.profile_id==env["a"]["id"],m.WatchEvent.event_type=="completed")))
        assert len(events)==1


def test_nullable_catalog_fields_and_canonical_deduplication(env):
    from service.providers import upsert_work
    with env["factory"]() as db:
        meta={"id":"tt999990000","type":"movie","name":"Synthetic nullable fields","genres":None,"director":None,"cast":None}
        first=upsert_work(db,meta,"Synthetic catalog")
        db.flush()
        second=upsert_work(db,meta,"Another synthetic catalog")
        assert first.id==second.id and first.directors==[] and first.genres==[]


def test_redirect_targets_require_operator_allowlist(monkeypatch):
    from service.providers import fetch_public
    monkeypatch.setenv("CATALOG_HOST_ALLOWLIST","catalog.example")
    for value in ["https://internal.example/private","https://catalog.example/x?key=secret","http://catalog.example/x"]:
        with pytest.raises(ValueError,match="not_allowlisted"):
            fetch_public(value)


def test_metadata_resolution_is_private_and_handles_provider_outages(env, monkeypatch):
    monkeypatch.setenv("CATALOG_HOST_ALLOWLIST", "catalog.example")
    from service.resolver import MetadataResolver
    c=env["client"]
    with env["factory"]() as db:
        profile=db.get(m.Profile,env["a"]["id"])
        def fetch(url):
            if url.endswith("manifest.json"):
                return {"catalogs":[{"id":"top","type":"movie","extraSupported":["search"]}],"resources":["meta"]}
            return {"metas":[{"id":"tt9988888","name":"Private synthetic search result","genres":["Drama"],"year":"2025"}]}
        works=MetadataResolver(db,profile,fetch).search("Private synthetic")
        assert len(works)==1
        assert works[0].provenance=="catalog.example"
        db.commit()
    ahome=c.get(f'/v1/profiles/{env["a"]["id"]}/home',headers=env["ah"]).json()
    bhome=c.get(f'/v1/profiles/{env["b"]["id"]}/home',headers=env["bh"]).json()
    assert any(i["title"]=="Private synthetic search result" for r in ahome["rows"] for i in r["items"])
    assert not any(i["title"]=="Private synthetic search result" for r in bhome["rows"] for i in r["items"])
    with env["factory"]() as db:
        resolver=MetadataResolver(db,db.get(m.Profile,env["b"]["id"]),lambda _: (_ for _ in ()).throw(OSError("offline")))
        assert resolver.search("Unknown synthetic title")==[]
        assert resolver.unavailable


def test_removing_incremental_batch_preserves_shared_watch_and_date_order_conflicts(env):
    c,pid=env["client"],env["b"]["id"]
    def upload(data, order="MDY"):
        return c.post(f"/v1/profiles/{pid}/imports/netflix?date_order={order}",headers=env["admin"],files={"file":("synthetic.csv",data)})
    first_data=b"Title,Date\nOrbit Example,10/01/2026\n"
    first=upload(first_data).json()["id"]
    second=upload(first_data+b"Family Example,10/02/2026\n").json()["id"]
    with env["factory"]() as db:
        import_job(db,db.get(m.ImportBatch,first))
        import_job(db,db.get(m.ImportBatch,second))
        db.commit()
    assert upload(first_data,"DMY").status_code==409
    assert len(c.get(f"/v1/profiles/{pid}/history",headers=env["bh"]).json()["items"])==2
    assert c.delete(f"/v1/imports/{first}",headers=env["admin"]).status_code==200
    assert len(c.get(f"/v1/profiles/{pid}/history",headers=env["bh"]).json()["items"])==2
