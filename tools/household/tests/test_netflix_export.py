import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("netflix_export", Path(__file__).parents[1] / "export-netflix-simkl.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class NetflixExportTest(unittest.TestCase):
    def test_episode_labels_collapse_without_inventing_episode_numbers(self):
        groups, events = exporter.normalize([
            {"Title": "A Show: Season 2: Finale", "Date": "10/22/26"},
            {"Title": "A Show: Season 1: Pilot", "Date": "4/19/25"}])
        self.assertEqual(1, len(groups))
        self.assertEqual("tv", groups[0]["type"])
        self.assertEqual(2, groups[0]["entries"])
        self.assertEqual("2026-10-22", groups[0]["last_date"])
        self.assertEqual(2, len(events))
        self.assertNotIn("rating", groups[0])

    def test_colon_movie_title_is_not_truncated_or_assumed_to_be_a_show(self):
        groups, _ = exporter.normalize([{"Title": "Spider-Man: Homecoming", "Date": "10/22/26"}])
        self.assertEqual("Spider-Man: Homecoming", groups[0]["title"])
        self.assertEqual("review", groups[0]["type"])

    def test_limited_series_and_book_labels_are_recognized(self):
        for label in ["Limited Series", "Book 1", "Part 2"]:
            groups, _ = exporter.normalize([{"Title": f"A Title: {label}: Episode", "Date": "10/22/26"}])
            self.assertEqual("A Title", groups[0]["title"])
            self.assertEqual("tv", groups[0]["type"])


if __name__ == "__main__":
    unittest.main()
