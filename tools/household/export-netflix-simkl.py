"""Offline Netflix-to-Simkl preparation; no account credentials or network calls.

Only explicit season/series/book labels enter the import. Remaining labels need review.
Simkl still performs title matching; prepared rows are not verified provider identities.
"""
import argparse
import csv
import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path

EPISODE = re.compile(r":\s*(?:Season\s+\d+|Series\s+\d+|Limited Series|Part\s+\d+|Volume\s+\d+|Collection\s+\d+|Book\s+\d+)\s*:", re.I)
FIELDS = ["Type", "Title", "Watchlist", "WatchedDate", "LastEpWatched", "Rating", "Memo"]


def normalize(rows):
    groups = {}
    events = []
    for index, row in enumerate(rows, 2):
        title = row["Title"].strip()
        if not title or len(title) > 300:
            raise ValueError(f"Invalid title on CSV line {index}")
        day = datetime.strptime(row["Date"].strip(), "%m/%d/%y").date()
        match = EPISODE.search(title)
        base = title[:match.start()].strip() if match else title
        kind = "tv" if match else "review"
        key = (kind, base.casefold())
        group = groups.setdefault(key, {"title": base, "type": kind, "entries": 0,
                                       "first_date": day.isoformat(), "last_date": day.isoformat(), "source_titles": []})
        group["entries"] += 1
        group["first_date"] = min(group["first_date"], day.isoformat())
        group["last_date"] = max(group["last_date"], day.isoformat())
        if title not in group["source_titles"]:
            group["source_titles"].append(title)
        events.append({"title": title, "date": day.isoformat(), "group": base, "type": kind})
    return sorted(groups.values(), key=lambda item: (-item["entries"], item["title"])), events


def write_csv(path, fields, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            # Neutralize spreadsheet formulas without changing the input file.
            writer.writerow({key: "'" + str(value) if str(value).lstrip().startswith(("=", "+", "-", "@")) else value
                             for key, value in row.items()})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path, help="New output directory; never overwrites existing exports")
    args = parser.parse_args()
    if args.input.stat().st_size > 5 * 1024 * 1024:
        raise ValueError("Input exceeds 5 MiB")
    with args.input.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if set(reader.fieldnames or []) != {"Title", "Date"}:
            raise ValueError("Expected Netflix Title and Date columns")
        rows = list(reader)
    groups, events = normalize(rows)
    ready = [group for group in groups if group["type"] == "tv"]
    review = [group for group in groups if group["type"] == "review"]
    args.output.mkdir(parents=True, exist_ok=False)
    write_csv(args.output / "simkl-series-import.csv", FIELDS, [
        {"Type": "tv", "Title": group["title"], "Watchlist": "watching",
         "WatchedDate": datetime.fromisoformat(group["last_date"]).strftime("%d-%m-%Y"),
         "LastEpWatched": "", "Rating": "",
         "Memo": f"Netflix import: {group['entries']} viewing entries; episode completion and rating unknown."}
        for group in ready])
    write_csv(args.output / "needs-title-review.csv", ["Title", "Entries", "LastDate", "Reason"], [
        {"Title": group["title"], "Entries": group["entries"], "LastDate": group["last_date"],
         "Reason": "No explicit series marker; movie/series identity requires review"} for group in review])
    (args.output / "normalized-history.json").write_text(
        json.dumps({"source": "netflix_csv", "date_order": "MDY", "ratings": "unknown",
                    "groups": groups, "events": events}, ensure_ascii=False, indent=2), encoding="utf-8")
    counts = Counter(event["type"] for event in events)
    summary = {"source_entries": len(events), "prepared_series": len(ready),
               "entries_covered_by_series": counts["tv"], "labels_needing_review": len(review),
               "external_uploads": 0, "provider_identity_matches_verified": 0}
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    instructions = """# Netflix history prepared for Watchly through Simkl

1. Sign in to the Simkl account intended for this viewer.
2. Open https://simkl.com/apps/import/csv/ and select simkl-series-import.csv.
3. Choose **Use .csv data** so the file's `watching` status is respected.
4. Inspect Simkl's matching/results and correct wrong or unresolved titles.
5. In https://watchly.elfhosted.com/configure select Simkl as the history source and authorize that account.
6. Enable Top Picks for You, Because You Watched, and Genre & Keyword catalogs.
7. Install the resulting Watchly addon into this viewer's Stremio account.

This is a title-based import file, not a completed or verified cloud import. Simkl account authorization
and Watchly installation have not been performed. These service interactions require your authorization.
Do not select an override that marks every show completed. Episode numbers and ratings are deliberately
blank. `watching` records exposure to a series, not completion of every episode or a positive opinion.
WatchedDate is the latest observed date for each series, not a fabricated time of day.

The Netflix export has labels and dates rather than shared metadata IDs. needs-title-review.csv preserves
labels that could be movies or episodes without season markers. Those entries are not in the import CSV.
normalized-history.json preserves all source entries, grouped explicit series, and original date precision
for the local app importer or later matching. No viewing history has been uploaded by this conversion.

Official format: https://simkl.com/apps/import/csv/
Watchly sources: https://github.com/TimilsinaBimal/Watchly#watch-history-sources
"""
    (args.output / "READ-ME.md").write_text(instructions, encoding="utf-8")
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
