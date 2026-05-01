#!/usr/bin/env python3
"""Sync most-active GitHub repo to coding.json.

Reads the GitHub user URL from meta.json (under links.work), fetches the
public events API, aggregates push/PR/create/release events by repo over
the last 7 days, and picks the leader. If the repo maps to a project page
in projects.json, links to that internal page (using the project title
as label); otherwise links to github.com (using the repo name).

Soft-fails on any network or parse error: existing coding.json is left alone.
No auth required — uses the unauthenticated public events endpoint.
"""
import json
import re
import sys
import urllib.request
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
META_JSON = ROOT / 'meta.json'
PROJECTS_JSON = ROOT / 'projects.json'
CODING_JSON = ROOT / 'coding.json'

WINDOW_DAYS = 7
RELEVANT_TYPES = {'PushEvent', 'PullRequestEvent', 'CreateEvent', 'ReleaseEvent'}
GITHUB_USER_RE = re.compile(r'github\.com/([\w-]+)/?$')
GITHUB_REPO_RE = re.compile(r'github\.com/([\w-]+)/([\w.-]+?)/?$')


def find_github_user():
    meta = json.loads(META_JSON.read_text())
    work = (meta.get('links') or {}).get('work') or []
    for entry in work:
        m = GITHUB_USER_RE.search(entry.get('href', ''))
        if m:
            return m.group(1)
    return None


def fetch_events(user):
    url = f'https://api.github.com/users/{user}/events/public?per_page=100'
    req = urllib.request.Request(
        url,
        headers={
            'User-Agent': 'pknull-journal/1.0 (+https://pknull.ai)',
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


def build_repo_to_project_map():
    """Return dict: 'owner/repo' -> {'slug': str, 'title': str}."""
    if not PROJECTS_JSON.exists():
        return {}
    projects = json.loads(PROJECTS_JSON.read_text())
    mapping = {}
    for p in projects:
        slug = p.get('slug')
        title = p.get('title') or slug
        if not slug:
            continue
        for link in p.get('links') or []:
            href = link.get('href', '')
            m = GITHUB_REPO_RE.search(href)
            if m:
                mapping[f'{m.group(1)}/{m.group(2)}'] = {'slug': slug, 'title': title}
    return mapping


def pick_leader(events):
    cutoff = datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)
    counts = Counter()
    for e in events:
        if e.get('type') not in RELEVANT_TYPES:
            continue
        try:
            ts = datetime.strptime(e['created_at'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        except (KeyError, ValueError):
            continue
        if ts < cutoff:
            continue
        repo_name = (e.get('repo') or {}).get('name')
        if repo_name:
            counts[repo_name] += 1
    if not counts:
        return None
    repo, _ = counts.most_common(1)[0]
    return repo


def make_record(repo, project_map):
    if not repo:
        return {
            'label': None,
            'href': None,
            'syncedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        }
    project = project_map.get(repo)
    if project:
        label = project['title']
        href = f'/projects/{project["slug"]}/'
    else:
        label = repo.split('/', 1)[-1]
        href = f'https://github.com/{repo}'
    return {
        'label': label,
        'href': href,
        'syncedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    }


def diff_excluding_timestamp(a, b):
    return {k: v for k, v in a.items() if k != 'syncedAt'} != {
        k: v for k, v in b.items() if k != 'syncedAt'
    }


def main():
    user = find_github_user()
    if not user:
        print('  ! no github user in meta.json (links.work)', file=sys.stderr)
        return

    try:
        events = fetch_events(user)
    except Exception as exc:
        print(f'  ! github fetch failed, leaving coding.json untouched: {exc}', file=sys.stderr)
        return

    repo = pick_leader(events)
    project_map = build_repo_to_project_map()
    record = make_record(repo, project_map)
    new_text = json.dumps(record, indent=2, ensure_ascii=False) + '\n'

    if CODING_JSON.exists():
        try:
            existing = json.loads(CODING_JSON.read_text())
            if not diff_excluding_timestamp(existing, record):
                print(f'  · coding.json unchanged (still: {record.get("label") or "—"})')
                return
        except json.JSONDecodeError:
            pass  # malformed — overwrite

    CODING_JSON.write_text(new_text)
    print(f'  ✓ coding.json written: {record.get("label") or "—"}')


if __name__ == '__main__':
    main()
