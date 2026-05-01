#!/usr/bin/env python3
"""Sync most-recent Steam game to gaming.json.

Reads the Steam profile URL from meta.json (under links.games), fetches the
public profile HTML, parses the first entry in the "Recent Activity" block,
and rewrites gaming.json only when the title or app changes (syncedAt is
ignored for diff purposes so the file isn't churned every run).

Soft-fails on any network or parse error: existing gaming.json is left alone.
Requires the Steam profile to have Game details = Public AND
"Always keep my total playtime private" = OFF, but no API key.
"""
import html
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
META_JSON = ROOT / 'meta.json'
GAMING_JSON = ROOT / 'gaming.json'

RECENT_BLOCK_RE = re.compile(
    r'<div class="recent_game">(.*?)(?=<div class="recent_game">|<div class="profile_)',
    re.DOTALL,
)
GAME_NAME_RE = re.compile(
    r'<div class="game_name">\s*<a[^>]*href="(?P<href>[^"]+)"[^>]*>(?P<name>[^<]+)</a>',
    re.DOTALL,
)
APP_ID_RE = re.compile(r'/app/(\d+)')


def find_steam_profile_url():
    meta = json.loads(META_JSON.read_text())
    games = (meta.get('links') or {}).get('games') or []
    for entry in games:
        href = entry.get('href', '')
        if 'steamcommunity.com' in href:
            return href.rstrip('/') + '/'
    return None


def fetch_profile_html(profile_url):
    req = urllib.request.Request(
        profile_url,
        headers={'User-Agent': 'pknull-journal/1.0 (+https://pknull.ai)'},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode('utf-8', errors='replace')


def parse_first_recent_game(profile_html):
    block_match = RECENT_BLOCK_RE.search(profile_html)
    if not block_match:
        return None
    block = block_match.group(1)
    name_match = GAME_NAME_RE.search(block)
    if not name_match:
        return None
    raw_href = name_match.group('href').strip()
    name = html.unescape(name_match.group('name')).strip()
    if not name:
        return None

    app_id_match = APP_ID_RE.search(raw_href)
    if app_id_match:
        href = f'https://store.steampowered.com/app/{app_id_match.group(1)}/'
    else:
        href = raw_href
    return {
        'label': name,
        'href': href,
        'syncedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    }


def diff_excluding_timestamp(a, b):
    return {k: v for k, v in a.items() if k != 'syncedAt'} != {
        k: v for k, v in b.items() if k != 'syncedAt'
    }


def main():
    profile_url = find_steam_profile_url()
    if not profile_url:
        print('  ! no steam profile in meta.json (links.games)', file=sys.stderr)
        return

    try:
        profile_html = fetch_profile_html(profile_url)
    except Exception as exc:
        print(f'  ! steam fetch failed, leaving gaming.json untouched: {exc}', file=sys.stderr)
        return

    record = parse_first_recent_game(profile_html) or {
        'label': None,
        'href': None,
        'syncedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    }
    new_text = json.dumps(record, indent=2, ensure_ascii=False) + '\n'

    if GAMING_JSON.exists():
        try:
            existing = json.loads(GAMING_JSON.read_text())
            if not diff_excluding_timestamp(existing, record):
                print(f'  · gaming.json unchanged (still: {record.get("label") or "—"})')
                return
        except json.JSONDecodeError:
            pass  # malformed — overwrite

    GAMING_JSON.write_text(new_text)
    print(f'  ✓ gaming.json written: {record.get("label") or "—"}')


if __name__ == '__main__':
    main()
