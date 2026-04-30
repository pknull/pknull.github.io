#!/usr/bin/env python3
"""Generate responsive webp variants for post and project images.

Reads photographic images from /images/ and emits {basename}-{width}.webp at
480, 960, and 1440 widths (skipping variants larger than the source). Writes
images/_variants.json as a manifest the build script consumes to render
<picture> markup with srcset.

Idempotent: skips variants newer than their source.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow is required. Install with: pip install pillow", file=sys.stderr)
    sys.exit(2)


ROOT = Path(__file__).resolve().parent.parent
IMAGES_DIR = ROOT / "images"
MANIFEST_PATH = IMAGES_DIR / "_variants.json"

WIDTHS = (480, 960, 1440)
QUALITY = 82
PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
EXCLUDE_PATTERNS = (
    "favicon",
    "badge-",
    "pk-glyph",
    "pookimon",
    "null.svg",
    "aas-sigil",
    "paintbrush",
)


def is_photographic(path: Path) -> bool:
    if path.suffix.lower() not in PHOTO_EXTENSIONS:
        return False
    name = path.name.lower()
    if any(pattern in name for pattern in EXCLUDE_PATTERNS):
        return False
    if "-480.webp" in name or "-960.webp" in name or "-1440.webp" in name:
        return False
    return True


def variant_path(source: Path, width: int) -> Path:
    return source.with_name(f"{source.stem}-{width}.webp")


def needs_rebuild(source: Path, target: Path) -> bool:
    if not target.exists():
        return True
    return target.stat().st_mtime < source.stat().st_mtime


def emit_variants(source: Path) -> tuple[list[dict], int, int]:
    with Image.open(source) as img:
        img = img.convert("RGB") if img.mode in ("RGBA", "P", "LA") else img
        src_w, src_h = img.size
        variants = []
        for width in WIDTHS:
            if width > src_w and width != WIDTHS[-1]:
                continue
            target_w = min(width, src_w)
            target = variant_path(source, width)
            if needs_rebuild(source, target):
                ratio = target_w / src_w
                target_h = max(1, round(src_h * ratio))
                resized = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
                resized.save(target, "WEBP", quality=QUALITY, method=6)
                print(f"  ✓ {target.relative_to(ROOT)} ({target_w}×{target_h})")
            else:
                with Image.open(target) as v:
                    target_w, target_h = v.size
                print(f"  · {target.relative_to(ROOT)} unchanged")
            variants.append(
                {
                    "width": target_w,
                    "height": target_h,
                    "url": "/" + str(target.relative_to(ROOT)).replace("\\", "/"),
                }
            )
    return variants, src_w, src_h


def main() -> int:
    if not IMAGES_DIR.exists():
        print(f"ERROR: {IMAGES_DIR} does not exist", file=sys.stderr)
        return 1

    sources = sorted(p for p in IMAGES_DIR.iterdir() if p.is_file() and is_photographic(p))
    if not sources:
        print("no photographic images found")
        return 0

    manifest: dict[str, dict] = {}
    for source in sources:
        rel = "/" + str(source.relative_to(ROOT)).replace("\\", "/")
        print(f"image: {source.name}")
        variants, src_w, src_h = emit_variants(source)
        if not variants:
            continue
        manifest[rel] = {
            "intrinsic_width": src_w,
            "intrinsic_height": src_h,
            "variants": variants,
        }

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"\nmanifest: {MANIFEST_PATH.relative_to(ROOT)} ({len(manifest)} images)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
