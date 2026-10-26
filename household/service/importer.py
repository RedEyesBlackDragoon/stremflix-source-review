"""Restricted CSV parsing. No archives, formula evaluation, network calls or credential handling."""
import csv
import hashlib
import io
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 50000


def normalized(title):
    return " ".join(re.sub(r"[^\w\s]", " ", unicodedata.normalize("NFKC", title).casefold()).split())


@dataclass(frozen=True)
class ParsedWatch:
    title: str
    watched_at: float
    source_hash: str
    probable_episode: bool


def parse_csv(data: bytes, date_order="MDY") -> list[ParsedWatch]:
    if not data or len(data) > MAX_BYTES or b"\x00" in data or data.startswith((b"PK", b"MZ", b"\x1f\x8b")):
        raise ValueError("invalid_csv_or_size")
    if date_order not in {"MDY", "DMY"}:
        raise ValueError("invalid_date_order")
    try:
        text = data.decode("utf-8-sig", errors="strict")
        reader = csv.DictReader(io.StringIO(text), strict=True)
        if not reader.fieldnames or set(reader.fieldnames) != {"Title", "Date"}:
            raise ValueError("expected_netflix_Title_Date_columns")
        rows, seen = [], set()
        for index, row in enumerate(reader):
            if index >= MAX_ROWS:
                raise ValueError("too_many_rows")
            if None in row or not row.get("Title") or not row.get("Date"):
                raise ValueError("invalid_row")
            title = row["Title"].strip()
            if len(title) > 300 or any(ord(c) < 32 for c in title):
                raise ValueError("invalid_title")
            value = row["Date"].strip()
            formats = ["%Y-%m-%d", "%Y/%m/%d", "%B %d, %Y", "%d %B %Y"]
            formats += ["%m/%d/%y", "%m/%d/%Y", "%m-%d-%Y"] if date_order == "MDY" else ["%d/%m/%y", "%d/%m/%Y", "%d-%m-%Y"]
            parsed = None
            for fmt in formats:
                try:
                    parsed = datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
                    break
                except ValueError:
                    continue
            if not parsed or not 1997 <= parsed.year <= datetime.now(timezone.utc).year + 1:
                raise ValueError("invalid_date_select_MDY_or_DMY")
            # Netflix CSV has date-only precision; keep UTC midnight, never fabricate time-of-day.
            key = hashlib.sha256(f"{normalized(title)}\0{parsed.date().isoformat()}".encode()).hexdigest()
            if key in seen:
                continue
            seen.add(key)
            episodic = bool(re.search(r"(?i)(?:season|episode|temporada|saison|staffel|\bS\d+\b|\bE\d+\b)", title) or title.count(":") >= 2)
            rows.append(ParsedWatch(title, parsed.timestamp(), key, episodic))
        return rows
    except (UnicodeError, csv.Error) as error:
        raise ValueError("invalid_utf8_csv") from error


def candidates_for(title, works, probable_episode=False):
    needle = normalized(title)
    base = normalized(title.split(":")[0]) if probable_episode else needle
    candidates = []
    for work in works:
        target = normalized(work.title)
        confidence = 1.0 if needle == target else SequenceMatcher(None, base, target).ratio() * 0.90
        if probable_episode and work.kind != "series":
            confidence *= 0.5
        if confidence >= 0.55:
            candidates.append({"id": work.id, "title": work.title, "year": work.year, "confidence": round(confidence, 3), "provenance": work.provenance})
    return sorted(candidates, key=lambda x: (-x["confidence"], x["id"]))[:8]


def csv_safe(value):
    value = str(value)
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value


def parse_csv_restricted(data, date_order):
    # This function runs in a disposable parser process, without database or provider clients.
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    except ImportError:
        # Windows still enforces byte/row limits and process separation; POSIX resource caps are unavailable.
        pass
    return parse_csv(data, date_order)
