#!/usr/bin/env python3
"""Sync Goodreads currently-reading shelf to reading.json.

Reads the Goodreads user URL from meta.json (under links.tracking), fetches the
public currently-reading RSS feed, parses the first item, and rewrites
reading.json only when the title or author changes (syncedAt is ignored for
diff purposes so the file isn't churned every run).

Soft-fails on any network or parse error: existing reading.json is left alone.
"""
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
META_JSON = ROOT / 'meta.json'
READING_JSON = ROOT / 'reading.json'


def find_goodreads_user_id():
    meta = json.loads(META_JSON.read_text())
    tracking = (meta.get('links') or {}).get('tracking') or []
    for entry in tracking:
        href = entry.get('href', '')
        m = re.search(r'goodreads\.com/user/show/(\d+)', href)
        if m:
            return m.group(1)
    return None


def fetch_currently_reading(user_id):
    url = f'https://www.goodreads.com/review/list_rss/{user_id}?shelf=currently-reading'
    req = urllib.request.Request(
        url,
        headers={'User-Agent': 'pknull-journal/1.0 (+https://pknull.ai)'},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return ET.fromstring(resp.read())


def first_item(channel):
    item = channel.find('.//item')
    if item is None:
        return None

    def text(tag):
        el = item.find(tag)
        return (el.text or '').strip() if el is not None else ''

    title = text('title')
    if not title:
        return None
    book_id = text('book_id')
    return {
        'title': title,
        'author': text('author_name') or None,
        'url': f'https://www.goodreads.com/book/show/{book_id}' if book_id else None,
        'syncedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    }


def diff_excluding_timestamp(a, b):
    return {k: v for k, v in a.items() if k != 'syncedAt'} != {
        k: v for k, v in b.items() if k != 'syncedAt'
    }


def main():
    uid = find_goodreads_user_id()
    if not uid:
        print('  ! no goodreads user id in meta.json (links.tracking)', file=sys.stderr)
        return

    try:
        channel = fetch_currently_reading(uid)
    except Exception as exc:
        print(f'  ! goodreads fetch failed, leaving reading.json untouched: {exc}', file=sys.stderr)
        return

    record = first_item(channel) or {
        'title': None,
        'syncedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    }
    new_text = json.dumps(record, indent=2, ensure_ascii=False) + '\n'

    if READING_JSON.exists():
        try:
            existing = json.loads(READING_JSON.read_text())
            if not diff_excluding_timestamp(existing, record):
                print(f'  · reading.json unchanged (still: {record.get("title") or "—"})')
                return
        except json.JSONDecodeError:
            pass  # malformed — overwrite

    READING_JSON.write_text(new_text)
    print(f'  ✓ reading.json written: {record.get("title") or "—"}')


if __name__ == '__main__':
    main()
