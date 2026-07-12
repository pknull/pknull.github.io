from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from collections import Counter
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent


def load_build_module():
    path = ROOT / "bin" / "build-index.py"
    spec = importlib.util.spec_from_file_location("build_index", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BUILD = load_build_module()


class ReferenceParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids: list[str] = []
        self.references: list[tuple[str, str]] = []
        self.images: list[dict[str, str | None]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            self.ids.append(values["id"] or "")

        attr = {"a": "href", "img": "src", "script": "src", "link": "href"}.get(tag)
        if attr and values.get(attr):
            self.references.append((attr, values[attr] or ""))

        if tag == "source" and values.get("srcset"):
            for candidate in (values["srcset"] or "").split(","):
                url = candidate.strip().split()[0]
                self.references.append(("srcset", url))

        if tag == "img":
            self.images.append(
                {
                    "src": values.get("src"),
                    "width": values.get("width"),
                    "height": values.get("height"),
                }
            )


def local_target(page: Path, url: str) -> Path | None:
    if not url or url.startswith(("#", "mailto:", "tel:", "sms:", "data:")):
        return None
    parsed = urlsplit(url)
    if parsed.scheme or parsed.netloc or not parsed.path:
        return None
    target = ROOT / parsed.path.lstrip("/") if parsed.path.startswith("/") else page.parent / parsed.path
    return target / "index.html" if parsed.path.endswith("/") else target


class GeneratedSiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pages: dict[Path, ReferenceParser] = {}
        for page in ROOT.rglob("*.html"):
            if "templates" in page.parts:
                continue
            parser = ReferenceParser()
            parser.feed(page.read_text())
            cls.pages[page] = parser

    def test_internal_references_exist(self) -> None:
        missing: list[str] = []
        for page, parser in self.pages.items():
            for attr, url in parser.references:
                target = local_target(page, url)
                if target is not None and not target.exists():
                    missing.append(f"{page.relative_to(ROOT)}: {attr}={url} -> {target}")
        self.assertEqual([], missing)

    def test_html_ids_are_unique_per_page(self) -> None:
        duplicates: list[str] = []
        for page, parser in self.pages.items():
            repeated = [value for value, count in Counter(parser.ids).items() if count > 1]
            if repeated:
                duplicates.append(f"{page.relative_to(ROOT)}: {', '.join(repeated)}")
        self.assertEqual([], duplicates)

    def test_declared_image_dimensions_match_files(self) -> None:
        mismatches: list[str] = []
        for page, parser in self.pages.items():
            for image in parser.images:
                src = image["src"]
                width = image["width"]
                height = image["height"]
                if not src or not width or not height:
                    continue
                target = local_target(page, src)
                if target is None or not target.exists():
                    continue
                if target.suffix.lower() not in {".gif", ".jpg", ".jpeg", ".png", ".webp"}:
                    continue
                with Image.open(target) as specimen:
                    actual = specimen.size
                declared = (int(width), int(height))
                if actual != declared:
                    mismatches.append(
                        f"{page.relative_to(ROOT)}: {src} declares {declared}, actual {actual}"
                    )
        self.assertEqual([], mismatches)

    def test_json_outputs_parse(self) -> None:
        for path in sorted(ROOT.glob("*.json")) + [ROOT / "images" / "_variants.json"]:
            with self.subTest(path=path.relative_to(ROOT)):
                json.loads(path.read_text())


class GeneratorEdgeCaseTests(unittest.TestCase):
    def test_security_expiry_handles_leap_day(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "security.txt"
            with (
                patch.object(BUILD, "current_utc_date", return_value=date(2028, 2, 29)),
                patch.object(BUILD, "ROOT", Path(directory)),
                patch.object(BUILD, "SECURITY_TXT", target),
            ):
                BUILD.build_security_txt()
            self.assertIn("Expires: 2029-02-28T00:00:00.000Z", target.read_text())

    def test_non_string_post_image_falls_back_without_crashing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            posts_dir = Path(directory)
            (posts_dir / "2026-01-01.md").write_text("---\nimg: 42\n---\n\nBody text.\n")
            with patch.object(BUILD, "POSTS_DIR", posts_dir):
                posts = BUILD.load_posts()
            self.assertEqual(1, len(posts))
            self.assertIsNone(posts[0]["img"])


if __name__ == "__main__":
    unittest.main()
