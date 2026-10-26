"""Versioned, deterministic rules. These weights are product defaults, not trained/optimized claims."""
import hashlib
import json
import math
from collections import Counter

ALGORITHM = "rules-1"
WEIGHTS = {"short_term": 1.5, "long_term": 2.5, "explicit": 5.0, "freshness": 0.35,
           "quality": 0.4, "novelty": 0.3, "community": 0.5}


def cache_key(profile, preferences, sources, catalog_revision):
    values = [profile.id, ALGORITHM, preferences.get("locale", "en"), profile.kid,
              profile.max_age, profile.revision, preferences, sources, catalog_revision]
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()


def allowed(work, profile, prefs):
    if profile.kid and (work.age is None or work.age > profile.max_age):
        return False
    return not (set(work.genres) & set(prefs.get("blocked_genres", [])))


def rank(works, profile, preferences, history, feedback, now, membership=None, limit=60, watchlist=()):
    by_id = {w.id: w for w in works}
    long, short = Counter(), Counter()
    reasons_by_genre = {}
    watched_movies = set()
    # Each genuine event has evidence strength; paused/buffering/failures contribute nothing.
    for event in history:
        work = by_id.get(event.work_id)
        if not work:
            continue
        strength = 0.35 if event.source == "netflix_import" else 1.0 if event.event_type == "completed" else 0.10 if event.event_type == "started" else 0
        if work.kind == "movie" and (event.event_type == "completed" or event.source == "netflix_import"):
            watched_movies.add(work.id)
        recency = math.exp(-max(0, now - event.occurred) / (30 * 86400))
        for genre in work.genres:
            long[genre] += strength
            short[genre] += strength * recency
            if strength:
                reasons_by_genre[genre] = work.title
    latest = {}
    for event in sorted(feedback, key=lambda e: (e.created_at, e.id)):
        if not event.undone:
            latest[event.work_id] = event.action
    for work_id, action in latest.items():
        work = by_id.get(work_id)
        if work:
            for genre in work.genres:
                long[genre] += 3 if action == "like" else -1 if action == "dislike" else 0
    for genre in preferences.get("genres", []):
        long[genre] += 0.5
    saved_genres = set()
    for work_id in watchlist:
        work = by_id.get(work_id)
        if work:
            for genre in work.genres:
                long[genre] += 0.15
                saved_genres.add(genre)
    total = max(1, sum(abs(v) for v in long.values()))
    short_total = max(1, sum(short.values()))
    scored = []
    for work in works:
        if work.id in watched_movies or latest.get(work.id) in {"hide", "dislike"} or not allowed(work, profile, preferences):
            continue
        if membership is not None and work.id not in membership:
            continue
        features = {"short_term": sum(short[g] for g in work.genres) / short_total,
                    "long_term": sum(long[g] for g in work.genres) / total,
                    "explicit": 1.0 if latest.get(work.id) == "like" else 0,
                    "freshness": max(0, 1 - (1970 + now / (365.25 * 86400) - (work.year or 1900)) / 10),
                    "quality": work.quality,
                    "novelty": 1.0 if not any(long[g] > 0 for g in work.genres) else 0,
                    "community": 1.0 if membership is not None else 0}
        score = sum(WEIGHTS[k] * v for k, v in features.items())
        reasons = []
        if features["explicit"]:
            reasons.append("You liked this title")
        common = sorted((g for g in work.genres if long[g] > 0), key=lambda g: (-long[g], g))
        if common:
            genre = common[0]
            reasons.append(f"Shares {genre} with {reasons_by_genre[genre]}" if genre in reasons_by_genre else
                           f"Shares {genre} with your saved titles" if genre in saved_genres else f"Matches your interest in {genre}")
        if features["novelty"]:
            reasons.append("Explore a different genre")
        if not reasons:
            reasons.append("Catalog discovery; no personal rating inferred")
        scored.append({"work_id": work.id, "score": round(score, 6), "features": features, "rationale": reasons})
    scored.sort(key=lambda x: (-x["score"], x["work_id"]))
    # Greedy diversity: at most two consecutive items sharing the first genre, when alternatives exist.
    result, recent = [], []
    while scored and len(result) < limit:
        pick = 0
        if len(recent) == 2 and recent[0] == recent[1]:
            pick = next((i for i, item in enumerate(scored) if (by_id[item["work_id"]].genres or [""])[0] != recent[0]), 0)
        item = scored.pop(pick)
        result.append(item)
        recent = (recent + [(by_id[item["work_id"]].genres or [""])[0]])[-2:]
    return result
