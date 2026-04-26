#!/usr/bin/env python3
"""Build posts.json from posts/*.md.

Run from anywhere; resolves paths relative to repo root.
Idempotent: writes posts.json only when it would change.

Conventions:
  - Each post lives at posts/YYYY-MM-DD.md
  - Filename stem (sans extension) is both the slug and the giscus term
  - Optional YAML frontmatter is stripped before computing the blurb
  - Blurb = first non-image, non-heading paragraph; markdown stripped; capped at 200 chars
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / 'posts'
POSTS_JSON = ROOT / 'posts.json'

SLUG_PATTERN = re.compile(r'^(\d{4})-(\d{2})-(\d{2})$')
FRONTMATTER_PATTERN = re.compile(r'\A---\s*\n.*?\n---\s*\n', re.DOTALL)


def strip_frontmatter(text: str) -> str:
    """Remove YAML frontmatter if present."""
    return FRONTMATTER_PATTERN.sub('', text, count=1)


def compute_blurb(body: str) -> str:
    """First non-image, non-heading paragraph; markdown stripped; capped at 200."""
    for para in re.split(r'\n\s*\n', body):
        p = para.strip()
        if not p or p[0] in ('!', '#'):
            continue
        b = re.sub(r'!\[[^\]]*\]\([^)]*\)', '', p)
        b = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', b)
        b = re.sub(r'[*_`]', '', b)
        b = re.sub(r'\s+', ' ', b).strip()
        if len(b) > 200:
            b = b[:197].rstrip()
            b = re.sub(r'\s+\S*$', '', b) + '…'
        return b
    return ''


def main() -> int:
    if not POSTS_DIR.is_dir():
        print(f'No posts directory at {POSTS_DIR}', file=sys.stderr)
        return 1

    posts = []
    for path in sorted(POSTS_DIR.glob('*.md')):
        slug = path.stem
        m = SLUG_PATTERN.match(slug)
        if not m:
            print(f'Skipping {path.name}: filename does not match YYYY-MM-DD', file=sys.stderr)
            continue
        yyyy, mm, dd = m.groups()
        body = strip_frontmatter(path.read_text()).strip()
        posts.append({
            'slug': slug,
            'date': slug,
            'displayDate': f'{yyyy}.{mm}.{dd}',
            'blurb': compute_blurb(body),
        })

    posts.sort(key=lambda p: p['date'], reverse=True)

    new_content = json.dumps(posts, indent=2, ensure_ascii=False) + '\n'
    if POSTS_JSON.exists() and POSTS_JSON.read_text() == new_content:
        print(f'posts.json up to date ({len(posts)} entries)')
        return 0

    POSTS_JSON.write_text(new_content)
    print(f'Wrote posts.json: {len(posts)} entries')
    return 0


if __name__ == '__main__':
    sys.exit(main())
