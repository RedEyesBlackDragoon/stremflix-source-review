"""Credential-free, allowlisted Stremio catalog retrieval. Stream resources never enter this service."""
import ipaddress
import os
import re
import socket
from urllib.parse import quote, urljoin, urlsplit

import httpx
from sqlalchemy import select

from .models import ExternalID, Work


def validate_manifest(url):
    parsed = urlsplit(url)
    allowed = {x.strip().lower() for x in os.getenv("CATALOG_HOST_ALLOWLIST", "").split(",") if x.strip()}
    if (parsed.scheme != "https" or not parsed.hostname or parsed.hostname.lower() not in allowed or
            parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.port not in (None, 443) or
            not re.fullmatch(r"/(?:[a-zA-Z0-9_-]{1,40}/)?manifest\.json", parsed.path)):
        raise ValueError("catalog_not_allowlisted_or_credential_free")
    return parsed


def fetch_public(url, redirects=0):
    parsed = urlsplit(url)
    allowed = {x.strip().lower() for x in os.getenv("CATALOG_HOST_ALLOWLIST", "").split(",") if x.strip()}
    if (parsed.scheme != "https" or parsed.hostname not in allowed or parsed.username or parsed.password or
            parsed.query or parsed.fragment or parsed.port not in (None, 443)):
        raise ValueError("catalog_redirect_not_allowlisted")
    # Pin the validated public IP for the TLS connection, retaining the original TLS SNI/Host.
    addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    ips = sorted({addr[4][0] for addr in addresses})
    if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
        raise ValueError("private_catalog_address")
    ip = ips[0]
    host = f"[{ip}]" if ":" in ip else ip
    target = f"https://{host}{parsed.path}"
    with httpx.Client(timeout=httpx.Timeout(8.0), follow_redirects=False, trust_env=False) as client:
        with client.stream("GET", target, headers={"Host": parsed.hostname, "Accept": "application/json"},
                           extensions={"sni_hostname": parsed.hostname}) as response:
            if response.status_code in {301, 302, 303, 307, 308}:
                if redirects >= 3 or "location" not in response.headers:
                    raise ValueError("catalog_redirect_limit")
                return fetch_public(urljoin(url, response.headers["location"]), redirects + 1)
            response.raise_for_status()
            data = bytearray()
            for chunk in response.iter_bytes():
                data.extend(chunk)
                if len(data) > 2 * 1024 * 1024:
                    raise ValueError("catalog_response_too_large")
    import json
    return json.loads(data)


def catalog_url(manifest, kind, catalog_id):
    parsed = validate_manifest(manifest)
    if kind not in {"movie", "series"} or not re.fullmatch(r"[\w.-]{1,100}", catalog_id):
        raise ValueError("invalid_catalog_resource")
    return f"https://{parsed.hostname}{parsed.path.removesuffix('manifest.json')}catalog/{kind}/{quote(catalog_id, safe='')}.json"


def upsert_work(db, meta, provenance):
    external = meta.get("id", "")
    if not isinstance(external, str) or not re.fullmatch(r"tt\d{4,12}", external):
        return None
    if meta.get("type") not in {"movie", "series"} or not isinstance(meta.get("name"), str):
        return None
    crosswalk = db.scalar(select(ExternalID).where(ExternalID.provider == "imdb", ExternalID.external_id == external))
    if crosswalk:
        return db.get(Work, crosswalk.work_id)
    year = str(meta.get("year") or meta.get("releaseInfo") or "")[:4]
    poster = meta.get("poster")
    if not isinstance(poster, str) or not poster.startswith("https://") or urlsplit(poster).username:
        poster = None
    # Maturity cannot be inferred from genre. Unknown ratings stay unrated and are hidden from kids.
    ratings = {"G": 0, "TV-Y": 0, "TV-G": 0, "PG": 8, "TV-Y7": 7, "TV-PG": 10,
               "PG-13": 13, "TV-14": 14, "R": 17, "NC-17": 18, "TV-MA": 18}
    def strings(field, limit, width):
        value = meta.get(field)
        if isinstance(value, str):
            return [value[:width]]
        return [item[:width] for item in value[:limit] if isinstance(item, str)] if isinstance(value, list) else []
    work = Work(kind=meta["type"], title=meta["name"][:300], year=int(year) if year.isdigit() else None,
                genres=strings("genres", 12, 80), cast=strings("cast", 20, 150), directors=strings("director", 10, 150),
                age=ratings.get(meta.get("certification")), poster=poster,
                description=str(meta.get("description", ""))[:3000], provenance=provenance)
    db.add(work)
    db.flush()
    db.add(ExternalID(work_id=work.id, provider="imdb", external_id=external))
    return work
