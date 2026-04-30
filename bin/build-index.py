#!/usr/bin/env python3
"""Build posts.json and projects.json from posts/*.md and projects/*.md.

Idempotent: writes each index only when its content would change.

Conventions:
  posts/YYYY-MM-DD.md
    - Filename stem is the slug (also the giscus term)
    - Optional YAML frontmatter is stripped before computing the blurb
    - Blurb = first non-image, non-heading paragraph (capped at 200 chars)

  projects/<slug>.md
    - Filename stem is the slug
    - YAML frontmatter REQUIRED with at minimum: title, kind, state
    - Optional frontmatter: order, lede, etymology, links
    - Body is the prose after the frontmatter
"""
import json
import hashlib
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print('ERROR: PyYAML is required. Install with: pip install pyyaml', file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / 'posts'
POSTS_JSON = ROOT / 'posts.json'
PROJECTS_DIR = ROOT / 'projects'
PROJECTS_JSON = ROOT / 'projects.json'
INDEX_HTML = ROOT / 'index.html'

POST_SLUG_PATTERN = re.compile(r'^(\d{4})-(\d{2})-(\d{2})$')
FRONTMATTER_PATTERN = re.compile(r'\A---\s*\n(.*?)\n---\s*\n', re.DOTALL)
BUILD_ID_PATTERN = re.compile(r'(<meta name="build-id" content=")([^"]*)(">)')
SHELL_CSS_PATTERN = re.compile(r'(<link rel="stylesheet" href="css/shell\.css)(?:\?v=[^"]*)?(">)')


def split_frontmatter(text):
    """Return (frontmatter_dict_or_None, body_string)."""
    m = FRONTMATTER_PATTERN.match(text)
    if not m:
        return None, text
    try:
        meta = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError as exc:
        raise RuntimeError(f'YAML frontmatter parse error: {exc}')
    body = text[m.end():]
    return meta, body


def compute_blurb(body):
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


def first_image(body):
    """First inline image src, or None. Strips the leading './' if present."""
    m = re.search(r'!\[[^\]]*\]\(([^)\s]+)', body)
    if not m:
        return None
    src = m.group(1).strip()
    if src.startswith('./'):
        src = src[2:]
    return src


def write_if_changed(path, new_content):
    if path.exists() and path.read_text() == new_content:
        print(f'  · {path.name} unchanged')
        return False
    path.write_text(new_content)
    print(f'  ✓ {path.name} written')
    return True


def iter_build_id_sources():
    for path in [ROOT / 'js' / 'app.js', ROOT / 'css' / 'shell.css', ROOT / 'meta.json', ROOT / 'reading.json']:
        if path.exists():
            yield path
    if INDEX_HTML.exists():
        yield INDEX_HTML
    for path in sorted(POSTS_DIR.glob('*.md')):
        yield path
    for path in sorted(PROJECTS_DIR.glob('*.md')):
        yield path


def compute_build_id():
    h = hashlib.sha256()
    for path in iter_build_id_sources():
        h.update(str(path.relative_to(ROOT)).encode('utf-8'))
        data = path.read_text()
        if path == INDEX_HTML:
            data = BUILD_ID_PATTERN.sub(r'\1__BUILD_ID__\3', data)
            data = SHELL_CSS_PATTERN.sub(r'\1?v=__BUILD_ID__\2', data)
        h.update(data.encode('utf-8'))
    return h.hexdigest()[:12]


def update_index_build_id():
    if not INDEX_HTML.exists():
        print('  ! index.html missing; skipped build-id update', file=sys.stderr)
        return
    build_id = compute_build_id()
    text = INDEX_HTML.read_text()
    if BUILD_ID_PATTERN.search(text):
        new_text = BUILD_ID_PATTERN.sub(lambda m: m.group(1) + build_id + m.group(3), text, count=1)
    else:
        needle = '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        insert = needle + f'  <meta name="build-id" content="{build_id}">\n'
        new_text = text.replace(needle, insert, 1)
    new_text = SHELL_CSS_PATTERN.sub(lambda m: m.group(1) + '?v=' + build_id + m.group(2), new_text, count=1)
    write_if_changed(INDEX_HTML, new_text)


def build_posts():
    if not POSTS_DIR.is_dir():
        print(f'  (no posts directory at {POSTS_DIR})')
        return
    posts = []
    for path in sorted(POSTS_DIR.glob('*.md')):
        slug = path.stem
        m = POST_SLUG_PATTERN.match(slug)
        if not m:
            print(f'  ! skipping {path.name}: filename does not match YYYY-MM-DD', file=sys.stderr)
            continue
        yyyy, mm, dd = m.groups()
        meta, body = split_frontmatter(path.read_text())
        meta = meta or {}
        body = body.strip()
        entry = {
            'slug': slug,
            'date': slug,
            'displayDate': f'{yyyy}.{mm}.{dd}',
            'blurb': meta.get('blurb') or compute_blurb(body),
        }
        img = meta.get('img') or first_image(body)
        if img:
            entry['img'] = img
        posts.append(entry)
    posts.sort(key=lambda p: p['date'], reverse=True)
    write_if_changed(POSTS_JSON, json.dumps(posts, indent=2, ensure_ascii=False) + '\n')


def build_projects():
    if not PROJECTS_DIR.is_dir():
        print(f'  (no projects directory at {PROJECTS_DIR})')
        return
    projects = []
    for path in sorted(PROJECTS_DIR.glob('*.md')):
        slug = path.stem
        meta, _body = split_frontmatter(path.read_text())
        if not meta:
            print(f'  ! skipping {path.name}: no YAML frontmatter', file=sys.stderr)
            continue
        if not meta.get('title'):
            print(f'  ! skipping {path.name}: frontmatter missing required `title`', file=sys.stderr)
            continue
        entry = {
            'slug': slug,
            'title': meta['title'],
            'kind': meta.get('kind', 'coding'),
            'state': meta.get('state', 'active'),
            'lede': meta.get('lede', ''),
            'links': meta.get('links') or [],
            'body': f'projects/{slug}.md',
        }
        if meta.get('etymology'):
            entry['etymology'] = meta['etymology']
        # internal sort key: explicit order, else 999
        entry['_order'] = meta.get('order', 999)
        projects.append(entry)
    # Sort by explicit order, then by title
    projects.sort(key=lambda p: (p['_order'], p['title'].lower()))
    for p in projects:
        del p['_order']
    write_if_changed(PROJECTS_JSON, json.dumps(projects, indent=2, ensure_ascii=False) + '\n')


def main():
    print('posts:')
    build_posts()
    print('projects:')
    build_projects()
    print('index:')
    update_index_build_id()
    return 0


if __name__ == '__main__':
    sys.exit(main())
