#!/usr/bin/env python3
"""Build the static journal site and supporting JSON indexes."""

from __future__ import annotations

import hashlib
import html
import json
import math
import re
import sys
from pathlib import Path
from urllib.parse import quote

try:
    import markdown
except ImportError:
    print("ERROR: python-markdown is required. Install with: pip install markdown", file=sys.stderr)
    sys.exit(2)

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML is required. Install with: pip install pyyaml", file=sys.stderr)
    sys.exit(2)

try:
    from jinja2 import Environment, FileSystemLoader, select_autoescape
except ImportError:
    print("ERROR: Jinja2 is required. Install with: pip install jinja2", file=sys.stderr)
    sys.exit(2)


ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"
PROJECTS_DIR = ROOT / "projects"
TEMPLATES_DIR = ROOT / "templates"
TEMPLATE_NAME = "base.html"
POSTS_JSON = ROOT / "posts.json"
PROJECTS_JSON = ROOT / "projects.json"
SITEMAP_XML = ROOT / "sitemap.xml"
FEED_XML = ROOT / "feed.xml"
IMAGE_VARIANTS_JSON = ROOT / "images" / "_variants.json"
INDEX_HTML = ROOT / "index.html"
BLOG_INDEX = ROOT / "blog" / "index.html"
POST_ROUTE_DIR = ROOT / "post"
NOT_FOUND_HTML = ROOT / "404.html"

SITE_NAME = "PKNULL.AI"
SITE_DESCRIPTION = "PK's Personal Site"
SITE_ROOT = "https://pknull.ai/"
DEFAULT_OG_IMAGE = "https://pknull.ai/images/favicon.svg"
AUTHOR_NAME = "Louis Grenzebach"
AUTHOR_URL = "https://pknull.ai/"
PICTURE_DEFAULT_SIZES = "(max-width: 720px) 100vw, 720px"

POST_SLUG_PATTERN = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
FRONTMATTER_PATTERN = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)
TABLE_PATTERN = re.compile(r"(<table\b[\s\S]*?</table>)", re.IGNORECASE)
IMG_LOADING_PATTERN = re.compile(r"<img\b(?![^>]*\bloading=)", re.IGNORECASE)
TAG_HEADING_PATTERN = re.compile(r"<(/?)h([1-6])(?=[\s>])", re.IGNORECASE)
URL_ATTR_PATTERN = re.compile(r"""\b(href|src)=(["'])(.*?)\2""", re.IGNORECASE)

LEGACY_PROJECTS = {"asha", "thallus"}


def split_frontmatter(text: str):
    match = FRONTMATTER_PATTERN.match(text)
    if not match:
        return None, text
    try:
        meta = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError as exc:
        raise RuntimeError(f"YAML frontmatter parse error: {exc}") from exc
    return meta, text[match.end():]


def compute_blurb(body: str) -> str:
    for para in re.split(r"\n\s*\n", body):
        p = para.strip()
        if not p or p[0] in ("!", "#"):
            continue
        p = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", p)
        p = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", p)
        p = re.sub(r"[*_`]", "", p)
        p = re.sub(r"\s+", " ", p).strip()
        if len(p) > 200:
            p = p[:197].rstrip()
            p = re.sub(r"\s+\S*$", "", p) + "…"
        return p
    return ""


def first_image(body: str) -> str | None:
    match = re.search(r"!\[[^\]]*\]\(([^)\s]+)", body)
    if not match:
        return None
    return normalize_content_url(match.group(1).strip())


def count_words(markdown_text: str) -> int:
    stripped = re.sub(r"```[\s\S]*?```", " ", markdown_text)
    stripped = re.sub(r"`[^`]+`", " ", stripped)
    stripped = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", stripped)
    stripped = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", stripped)
    stripped = re.sub(r"<[^>]+>", " ", stripped)
    return len(re.findall(r"\b[\w'-]+\b", stripped))


def to_display_date(iso: str) -> str:
    if re.match(r"^\d{4}\.\d{2}\.\d{2}$", iso):
        return iso
    yyyy, mm, dd = iso.split("-")
    return f"{yyyy}.{mm}.{dd}"


def ensure_trailing_slash(path: str) -> str:
    if path == "/":
        return path
    return path.rstrip("/") + "/"


def home_path() -> str:
    return "/"


def blog_path() -> str:
    return "/blog/"


def projects_path() -> str:
    return "/projects/"


def post_path(slug: str) -> str:
    return f"/post/{slug}/"


def project_path(slug: str) -> str:
    return f"/projects/{slug}/"


def absolute_url(path: str) -> str:
    if not path:
        return SITE_ROOT
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if path == "/":
        return SITE_ROOT
    if path.endswith("/") or "." not in path.rsplit("/", 1)[-1]:
        return SITE_ROOT.rstrip("/") + ensure_trailing_slash(path)
    return SITE_ROOT.rstrip("/") + path


def validator_url_for(canonical: str) -> str:
    return "https://validator.w3.org/nu/?doc=" + quote(canonical, safe="")


def path_from_hash(hash_value: str) -> str | None:
    if not hash_value or hash_value == "#":
        return home_path()
    if hash_value == "#/":
        return home_path()
    if hash_value.startswith("#/"):
        raw = hash_value[2:].strip("/")
        if not raw:
            return home_path()
        if raw == "blog":
            return blog_path()
        if raw == "projects":
            return projects_path()
        if raw.startswith("post/"):
            slug = raw[5:].strip("/")
            return post_path(slug) if slug else blog_path()
        if raw.startswith("projects/"):
            slug = raw[9:].strip("/")
            return project_path(slug) if slug else projects_path()
        return None

    raw = hash_value.lstrip("#")
    if raw == "blog":
        return blog_path()
    if raw.startswith("blog:"):
        slug = raw[5:].strip("/")
        return post_path(slug) if slug else blog_path()
    if raw == "meta":
        return home_path()
    if raw in LEGACY_PROJECTS:
        return project_path(raw)
    return None


def normalize_content_url(url: str) -> str:
    if not url:
        return url
    if url.startswith("#"):
        return path_from_hash(url) or url
    if url.startswith("./images/"):
        return "/images/" + url[len("./images/") :]
    if url.startswith("images/"):
        return "/" + url
    if url.startswith("./") and re.match(r"^\./[^/]+\.(?:png|jpe?g|webp|gif|svg)$", url, re.IGNORECASE):
        return "/" + url[2:]
    return url


def rewrite_html_urls(rendered_html: str) -> str:
    def repl(match: re.Match[str]) -> str:
        attr, quote_char, value = match.groups()
        normalized = html.escape(normalize_content_url(value), quote=True)
        return f"{attr}={quote_char}{normalized}{quote_char}"

    return URL_ATTR_PATTERN.sub(repl, rendered_html)


def bump_headings(rendered_html: str) -> str:
    def repl(match: re.Match[str]) -> str:
        slash, level = match.groups()
        return f"<{slash}h{min(int(level) + 1, 6)}"

    return TAG_HEADING_PATTERN.sub(repl, rendered_html)


def wrap_tables(rendered_html: str) -> str:
    return TABLE_PATTERN.sub(r'<div class="tbl-wrap">\1</div>', rendered_html)


def add_lazy_loading(rendered_html: str) -> str:
    return IMG_LOADING_PATTERN.sub('<img loading="lazy" ', rendered_html)


def load_image_manifest():
    if not IMAGE_VARIANTS_JSON.exists():
        return {}
    return json.loads(IMAGE_VARIANTS_JSON.read_text())


IMAGE_MANIFEST = load_image_manifest()


def largest_variant(src: str) -> str:
    """Return the URL of the largest variant for src, or src unchanged."""
    info = IMAGE_MANIFEST.get(src)
    if not info or not info.get("variants"):
        return src
    return max(info["variants"], key=lambda v: v["width"])["url"]


def picture_for(src: str, alt: str = "", *, sizes: str = PICTURE_DEFAULT_SIZES, lazy: bool = True) -> str:
    """Render <picture> markup for src if responsive variants exist; else <img>."""
    info = IMAGE_MANIFEST.get(src)
    if not info or not info.get("variants"):
        attrs = [f'src="{html.escape(src, quote=True)}"', f'alt="{html.escape(alt, quote=True)}"']
        if lazy:
            attrs.append('loading="lazy"')
        return f"<img {' '.join(attrs)}>"

    variants = sorted(info["variants"], key=lambda v: v["width"])
    srcset = ", ".join(f'{html.escape(v["url"], quote=True)} {v["width"]}w' for v in variants)
    fallback = next((v for v in variants if v["width"] >= 960), variants[-1])
    fallback_w = fallback["width"]
    fallback_h = fallback["height"]
    fallback_url = html.escape(fallback["url"], quote=True)
    img_attrs = [
        f'src="{fallback_url}"',
        f'alt="{html.escape(alt, quote=True)}"',
        f'width="{fallback_w}"',
        f'height="{fallback_h}"',
    ]
    if lazy:
        img_attrs.append('loading="lazy"')
    img_attrs.append('decoding="async"')
    return (
        f'<picture><source type="image/webp" srcset="{srcset}" sizes="{html.escape(sizes, quote=True)}">'
        f'<img {" ".join(img_attrs)}></picture>'
    )


IMG_TAG_PATTERN = re.compile(r"<img\b[^>]*\bsrc=\"([^\"]+)\"[^>]*>", re.IGNORECASE)
IMG_ALT_PATTERN = re.compile(r"\balt=\"([^\"]*)\"", re.IGNORECASE)


def pictureize_html(rendered_html: str) -> str:
    """Replace <img> tags whose src has variants with <picture> markup."""

    def repl(match: re.Match[str]) -> str:
        src = match.group(0)
        url = match.group(1)
        if url not in IMAGE_MANIFEST:
            return src
        alt_match = IMG_ALT_PATTERN.search(src)
        alt = alt_match.group(1) if alt_match else ""
        return picture_for(url, html.unescape(alt))

    return IMG_TAG_PATTERN.sub(repl, rendered_html)


def make_markdown_renderer():
    return markdown.Markdown(extensions=["extra", "sane_lists", "md_in_html"])


def render_markdown(markdown_text: str) -> str:
    md = make_markdown_renderer()
    rendered = md.convert(markdown_text.strip())
    rendered = bump_headings(rendered)
    rendered = rewrite_html_urls(rendered)
    rendered = wrap_tables(rendered)
    rendered = add_lazy_loading(rendered)
    rendered = pictureize_html(rendered)
    return rendered


def strip_outer_paragraph(rendered_html: str) -> str:
    match = re.fullmatch(r"<p>(.*)</p>", rendered_html, re.DOTALL)
    return match.group(1) if match else rendered_html


def render_inline_markdown(text: str) -> str:
    md = make_markdown_renderer()
    rendered = md.convert(text.strip())
    rendered = rewrite_html_urls(rendered)
    return strip_outer_paragraph(rendered)


def write_if_changed(path: Path, content: str) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text() == content:
        print(f"  · {path.relative_to(ROOT)} unchanged")
        return False
    path.write_text(content)
    print(f"  ✓ {path.relative_to(ROOT)} written")
    return True


def iter_build_id_sources():
    fixed = [
        ROOT / "bin" / "build-index.py",
        ROOT / "js" / "app.js",
        ROOT / "css" / "shell.css",
        ROOT / "css" / "_fonts.css",
        ROOT / "meta.json",
        ROOT / "reading.json",
        IMAGE_VARIANTS_JSON,
        TEMPLATES_DIR / TEMPLATE_NAME,
    ]
    for path in fixed:
        if path.exists():
            yield path
    for path in sorted(POSTS_DIR.glob("*.md")):
        yield path
    for path in sorted(PROJECTS_DIR.glob("*.md")):
        yield path


def compute_build_id() -> str:
    digest = hashlib.sha256()
    for path in iter_build_id_sources():
        digest.update(str(path.relative_to(ROOT)).encode("utf-8"))
        digest.update(path.read_text().encode("utf-8"))
    return digest.hexdigest()[:12]


def load_json(path: Path):
    return json.loads(path.read_text()) if path.exists() else {}


def load_posts():
    posts = []
    for path in sorted(POSTS_DIR.glob("*.md")):
        slug = path.stem
        match = POST_SLUG_PATTERN.match(slug)
        if not match:
            print(f"  ! skipping {path.name}: filename does not match YYYY-MM-DD", file=sys.stderr)
            continue
        meta, body = split_frontmatter(path.read_text())
        meta = meta or {}
        body = body.strip()
        img = normalize_content_url(meta.get("img")) if meta.get("img") else first_image(body)
        post = {
            "slug": slug,
            "date": slug,
            "displayDate": to_display_date(slug),
            "blurb": meta.get("blurb") or compute_blurb(body),
            "img": img,
            "body_md": body,
            "word_count": count_words(body),
            "path": post_path(slug),
            "canonical": absolute_url(post_path(slug)),
        }
        posts.append(post)
    posts.sort(key=lambda item: item["date"], reverse=True)
    return posts


def load_projects():
    projects = []
    for path in sorted(PROJECTS_DIR.glob("*.md")):
        slug = path.stem
        meta, body = split_frontmatter(path.read_text())
        if not meta:
            print(f"  ! skipping {path.name}: no YAML frontmatter", file=sys.stderr)
            continue
        if not meta.get("title"):
            print(f"  ! skipping {path.name}: frontmatter missing required `title`", file=sys.stderr)
            continue
        project = {
            "slug": slug,
            "title": meta["title"],
            "kind": meta.get("kind", "coding"),
            "state": meta.get("state", "active"),
            "lede": meta.get("lede", ""),
            "links": meta.get("links") or [],
            "etymology": meta.get("etymology"),
            "body_md": body.strip(),
            "body": f"projects/{slug}.md",
            "_order": meta.get("order", 999),
            "path": project_path(slug),
            "canonical": absolute_url(project_path(slug)),
        }
        projects.append(project)
    projects.sort(key=lambda item: (item["_order"], item["title"].lower()))
    for project in projects:
        del project["_order"]
    return projects


def build_posts_json(posts):
    payload = []
    for post in posts:
        entry = {
            "slug": post["slug"],
            "date": post["date"],
            "displayDate": post["displayDate"],
            "blurb": post["blurb"],
        }
        if post.get("img"):
            entry["img"] = largest_variant(post["img"])
        payload.append(entry)
    write_if_changed(POSTS_JSON, json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def build_projects_json(projects):
    payload = []
    for project in projects:
        payload.append(
            {
                "slug": project["slug"],
                "title": project["title"],
                "kind": project["kind"],
                "state": project["state"],
                "lede": project["lede"],
                "links": project["links"],
                "body": project["body"],
                **({"etymology": project["etymology"]} if project.get("etymology") else {}),
            }
        )
    write_if_changed(PROJECTS_JSON, json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def render_featured_posts(posts):
    if not posts:
        return '<p class="empty">No posts yet.</p>'
    items = []
    for post in posts:
        img_html = (
            picture_for(post["img"], "", sizes="(max-width: 720px) 100vw, 480px")
            if post.get("img")
            else f'<span class="ph-date">{html.escape(post["displayDate"])}</span>'
        )
        items.append(
            '<li class="post-feat"><a class="post-feat-link" href="{href}">'
            '<div class="post-feat-img">{img}</div>'
            '<div class="post-feat-body">'
            '<div class="post-feat-meta"><span class="post-feat-meta-date">{date}</span></div>'
            '<p class="post-feat-blurb">{blurb}</p>'
            "</div></a></li>".format(
                href=html.escape(post["path"], quote=True),
                img=img_html,
                date=html.escape(post["displayDate"]),
                blurb=html.escape(post["blurb"] or "(entry)"),
            )
        )
    return '<ol class="post-feat-list">' + "".join(items) + "</ol>"


def render_recent_post_list(posts):
    if not posts:
        return ""
    items = []
    for post in posts:
        items.append(
            '<li><a href="{href}">'
            '<span class="pl-date">{date}</span>'
            '<span class="pl-title">{title}</span>'
            '<span class="pl-tag" aria-hidden="true">→</span>'
            "</a></li>".format(
                href=html.escape(post["path"], quote=True),
                date=html.escape(post["displayDate"]),
                title=html.escape(post["blurb"] or "(entry)"),
            )
        )
    return '<ol class="post-list tight">' + "".join(items) + "</ol>"


def render_home_project_card(project):
    kind = project["kind"] or "coding"
    state = project["state"] or "active"
    etym = project.get("etymology")
    etym_html = ""
    if etym and etym.get("word"):
        etym_html = (
            '<div class="proj-card-etym"><span class="proj-card-etym-word">{word}</span>{gloss}</div>'
        ).format(
            word=html.escape(etym["word"]),
            gloss=f" — {html.escape(etym['gloss'])}" if etym.get("gloss") else "",
        )
    return (
        '<li class="proj-card state-{state} kind-{kind}">'
        '<a class="proj-link" href="{href}">'
        '<div class="proj-card-head">'
        '<h3 class="proj-card-name"><span class="proj-dot" aria-hidden="true"></span>{title}</h3>'
        "</div>"
        '<div class="proj-card-state">{kind_label} · {state_label}</div>'
        "{lede}"
        "{etym}"
        "</a></li>"
    ).format(
        state=html.escape(state),
        kind=html.escape(kind),
        href=html.escape(project["path"], quote=True),
        title=html.escape(project["title"]),
        kind_label=html.escape(kind),
        state_label=html.escape(state),
        lede=f'<p class="proj-card-lede">{html.escape(project["lede"])}</p>' if project.get("lede") else "",
        etym=etym_html,
    )


def render_home_projects(projects):
    if not projects:
        return '<p class="empty">No projects yet.</p>'
    return '<ol class="proj-list">' + "".join(render_home_project_card(project) for project in projects) + "</ol>"


def render_standing(standing):
    if not standing:
        return ""
    rows = []
    for item in standing:
        rows.append(
            '<div class="aside-row"><dt>{key}</dt><dd>{val}</dd></div>'.format(
                key=html.escape(item.get("key", "")),
                val=render_inline_markdown(item.get("val", "")),
            )
        )
    return (
        '<aside class="hero-aside" aria-label="Standing">'
        '<div class="aside-hd">Standing</div>'
        '<dl class="aside-list">{rows}</dl>'
        "</aside>"
    ).format(rows="".join(rows))


def render_about(meta):
    bio = meta.get("bio") or []
    portrait = normalize_content_url(meta.get("portrait", ""))
    bio_html = "".join(f"<p>{render_inline_markdown(paragraph)}</p>" for paragraph in bio)
    if not portrait and not bio_html:
        return ""
    return (
        '<aside class="home-about" aria-labelledby="about-h2">'
        '<div class="col-hd"><h2 id="about-h2"><em>About</em></h2></div>'
        '<div class="about-body">'
        '{portrait}'
        '<div class="about-bio">{bio}</div>'
        "</div></aside>"
    ).format(
        portrait=(
            f'<div class="about-portrait">{picture_for(portrait, "", sizes="(max-width: 720px) 50vw, 220px")}</div>'
            if portrait
            else ""
        ),
        bio=bio_html,
    )


def render_link_groups(links):
    if not links:
        return ""
    groups = []
    for group_name, items in links.items():
        item_html = "".join(
            '<li><a href="{href}">{label}</a></li>'.format(
                href=html.escape(normalize_content_url(item["href"]), quote=True),
                label=html.escape(item["label"]),
            )
            for item in items
        )
        groups.append(
            '<div class="link-col"><div class="col-hd mono caps dim">{name}</div><ul class="plain">{items}</ul></div>'.format(
                name=html.escape(group_name),
                items=item_html,
            )
        )
    return (
        '<section class="home-links" aria-labelledby="elsewhere-h2">'
        '<div class="col-hd"><h2 id="elsewhere-h2"><em>Elsewhere</em></h2></div>'
        '<div class="link-grid">{groups}</div>'
        "</section>"
    ).format(groups="".join(groups))


def pills_for(project):
    kind = project.get("kind") or "coding"
    state = project.get("state") or "active"
    kind_class = "pill-writing" if kind == "writing" else "pill-coding"
    if state == "archived":
        state_class = "pill-archived"
    elif state == "inactive":
        state_class = "pill-inactive"
    else:
        state_class = "pill-active"
    return (
        '<div class="proj-pills">'
        '<span class="proj-pill {kind_class}">{kind}</span>'
        '<span class="proj-pill {state_class}">{state}</span>'
        "</div>"
    ).format(
        kind_class=kind_class,
        state_class=state_class,
        kind=html.escape(kind),
        state=html.escape(state),
    )


def render_home_page(posts, projects, meta):
    featured = posts[:3]
    rest = posts[3:8]
    home_projects = projects[:4]
    standing = (meta.get("standing") or [])[:6]
    return (
        '<section class="hero" aria-labelledby="hero-title">'
        '<div class="hero-body">'
        '<div class="hero-kicker">est. 2025 · a notebook by louis g.</div>'
        '<h1 class="hero-title" id="hero-title">Engineer, worldbuilder, late-night <em>nightcap</em> blogger. Writing things down before I forget them.</h1>'
        '<p class="hero-lede">Three decades in software, mostly systems and security. Currently in Eugene, building <a href="/projects/asha/">Asha</a> and a cosmic horror novel called <a href="/projects/hush/">The Hush</a>. Updated whenever the day quiets down.</p>'
        '<div class="hero-actions"><a href="/blog/" class="btn-pri">Read the journal →</a><a href="/projects/" class="btn-sec">See the workshop</a></div>'
        '</div>{standing}</section>'
        '<div class="home-split">'
        '<section class="col-recent" aria-labelledby="recent-h2">'
        '<div class="col-hd"><h2 id="recent-h2"><em>Recent entries</em></h2><a href="/blog/">view all {post_count} →</a></div>'
        '{featured}{recent}'
        "</section>"
        '<section class="col-shop" aria-labelledby="shop-h2">'
        '<div class="col-hd"><h2 id="shop-h2"><em>In the workshop</em></h2><a href="/projects/">all projects →</a></div>'
        "{projects_html}"
        "</section>"
        "{about}"
        "</div>"
        "{links}"
    ).format(
        standing=render_standing(standing),
        post_count=len(posts),
        featured=render_featured_posts(featured),
        recent=render_recent_post_list(rest),
        projects_html=render_home_projects(home_projects),
        about=render_about(meta),
        links=render_link_groups(meta.get("links")),
    )


def render_blog_page(posts):
    if not posts:
        groups_html = '<p class="empty">No entries yet.</p>'
    else:
        grouped = {}
        order = []
        for post in posts:
            month = post["displayDate"][:7]
            if month not in grouped:
                grouped[month] = []
                order.append(month)
            grouped[month].append(post)
        sections = []
        for month in order:
            items = []
            for post in grouped[month]:
                title = re.split(r"[.!?]", post["blurb"], maxsplit=1)[0] if post["blurb"] else post["displayDate"]
                items.append(
                    '<li><a href="{href}"><div class="pl-meta"><span>{date}</span></div><div class="pl-title-big">{title}</div>{blurb}</a></li>'.format(
                        href=html.escape(post["path"], quote=True),
                        date=html.escape(post["displayDate"]),
                        title=html.escape(title),
                        blurb=f'<p class="pl-blurb">{html.escape(post["blurb"])}</p>' if post.get("blurb") else "",
                    )
                )
            sections.append(
                '<section class="month-group"><div class="month-hd">{month}</div><ol class="post-list big">{items}</ol></section>'.format(
                    month=html.escape(month),
                    items="".join(items),
                )
            )
        groups_html = "".join(sections)
    return (
        '<header class="page-hd"><p class="hd-kicker dim"><a href="/">← home</a></p><h1>Blog</h1><p class="page-lede">Notebook entries, newest first.</p></header>'
        + groups_html
    )


def render_post_navigation(posts, slug):
    index = next((i for i, post in enumerate(posts) if post["slug"] == slug), -1)
    if index == -1:
        return ""
    newer = posts[index - 1] if index > 0 else None
    older = posts[index + 1] if index < len(posts) - 1 else None
    if not older and not newer:
        return ""
    return (
        '<nav class="post-nav">'
        '{older}'
        '{newer}'
        "</nav>"
    ).format(
        older=(
            f'<a href="{html.escape(older["path"], quote=True)}">← {html.escape(older["displayDate"])}</a>'
            if older
            else "<span></span>"
        ),
        newer=(
            f'<a href="{html.escape(newer["path"], quote=True)}">{html.escape(newer["displayDate"])} →</a>'
            if newer
            else "<span></span>"
        ),
    )


def render_post_page(post, posts):
    minutes = max(1, math.ceil(post["word_count"] / 200))
    body_html = render_markdown(post["body_md"])
    return (
        '<p class="back-link"><a href="/blog/">← All entries</a></p>'
        '<article class="post">'
        '<header class="post-hd"><h1>{title}</h1><div class="post-meta"><span class="mono">notebook entry</span><span class="mono dim">{minutes} min read</span></div></header>'
        '<div class="post-body">{body}</div>'
        '{nav}'
        "</article>"
    ).format(
        title=html.escape(post["displayDate"]),
        minutes=minutes,
        body=body_html,
        nav=render_post_navigation(posts, post["slug"]),
    )


def render_projects_page(projects):
    if not projects:
        cards = '<p class="empty">No projects yet.</p>'
    else:
        rendered = []
        for project in projects:
            links_html = "".join(
                '<a href="{href}">{label}</a>'.format(
                    href=html.escape(normalize_content_url(link["href"]), quote=True),
                    label=html.escape(link["label"]),
                )
                for link in project.get("links") or []
            )
            if links_html:
                links_html = (
                    '<div class="proj-card-meta">'
                    + links_html.replace("</a><a ", '</a><span aria-hidden="true">·</span><a ')
                    + f'<span aria-hidden="true">·</span><a href="{html.escape(project["path"], quote=True)}">Read →</a></div>'
                )
            else:
                links_html = f'<div class="proj-card-meta"><a href="{html.escape(project["path"], quote=True)}">Read →</a></div>'
            rendered.append(
                '<article class="proj-card"><header class="proj-card-hd"><a class="proj-card-name-link" href="{href}"><h2 class="proj-card-name">{title}</h2></a>{pills}</header>{lede}{etym}{links}</article>'.format(
                    href=html.escape(project["path"], quote=True),
                    title=html.escape(project["title"]),
                    pills=pills_for(project),
                    lede=f'<p class="proj-card-lede">{html.escape(project["lede"])}</p>' if project.get("lede") else "",
                    etym=(
                        '<p class="proj-etym"><span class="caps mono">etym.</span> {word}{gloss}</p>'.format(
                            word=html.escape(project["etymology"]["word"]),
                            gloss=f" — {html.escape(project['etymology']['gloss'])}" if project.get("etymology", {}).get("gloss") else "",
                        )
                        if project.get("etymology")
                        else ""
                    ),
                    links=links_html,
                )
            )
        cards = "".join(rendered)
    return (
        '<header class="page-hd"><p class="hd-kicker dim"><a href="/">← home</a></p><h1>Projects</h1><p class="page-lede">Long-running threads. Each has its own page; click a name for the prose.</p></header>'
        + cards
    )


def render_project_detail_page(project):
    body_html = render_markdown(project["body_md"])
    links_html = ""
    if project.get("links"):
        links_html = '<div class="proj-card-meta">' + "".join(
            '<a href="{href}">{label}</a>{sep}'.format(
                href=html.escape(normalize_content_url(link["href"]), quote=True),
                label=html.escape(link["label"]),
                sep='<span aria-hidden="true">·</span>' if index < len(project["links"]) - 1 else "",
            )
            for index, link in enumerate(project["links"])
        ) + "</div>"

    header_html = (
        '<header class="proj-card-hd"><div class="proj-card-name-static"><h1 class="proj-card-name">{title}</h1></div>{pills}</header>{lede}{etym}{links}'.format(
            title=html.escape(project["title"]),
            pills=pills_for(project),
            lede=f'<p class="proj-card-lede">{html.escape(project["lede"])}</p>' if project.get("lede") else "",
            etym=(
                '<p class="proj-etym"><span class="caps mono">etym.</span> {word}{gloss}</p>'.format(
                    word=html.escape(project["etymology"]["word"]),
                    gloss=f" — {html.escape(project['etymology']['gloss'])}" if project.get("etymology", {}).get("gloss") else "",
                )
                if project.get("etymology")
                else ""
            ),
            links=links_html,
        )
    )
    return (
        '<p class="back-link"><a href="/projects/">← All projects</a></p>'
        '<article class="proj-card proj-card--detail">{header}<div class="post-body">{body}</div></article>'
    ).format(header=header_html, body=body_html)


def render_not_found_page():
    return (
        '<header class="page-hd"><p class="hd-kicker dim"><a href="/">← home</a></p><h1>Not Found</h1><p class="page-lede">That page does not exist.</p></header>'
        '<p class="empty">Try the journal, the workshop, or head back home.</p>'
    )


def page_context(
    *,
    build_id,
    main_html,
    nav,
    page_kind,
    main_class,
    title="",
    description=SITE_DESCRIPTION,
    canonical=SITE_ROOT,
    og_image=DEFAULT_OG_IMAGE,
    giscus_term="",
    json_ld="",
):
    full_title = f"{title} · {SITE_NAME}" if title else SITE_NAME
    return {
        "build_id": build_id,
        "full_title": full_title,
        "description": description,
        "canonical": canonical,
        "og_image": og_image,
        "og_type": "article" if page_kind == "post" else "website",
        "nav": nav,
        "page_kind": page_kind,
        "main_class": main_class,
        "main_html": main_html,
        "giscus_term": giscus_term,
        "validator_url": validator_url_for(canonical),
        "json_ld": json_ld,
    }


def make_environment():
    return Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(["html", "xml"]),
    )


def write_page(template, path: Path, **context):
    write_if_changed(path, template.render(**context))


def build_sitemap(posts, projects):
    urls = [absolute_url(home_path()), absolute_url(blog_path()), absolute_url(projects_path())]
    urls.extend(post["canonical"] for post in posts)
    urls.extend(project["canonical"] for project in projects)
    entries = "".join(f"  <url>\n    <loc>{html.escape(url)}</loc>\n  </url>\n" for url in urls)
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + entries + "</urlset>\n"
    write_if_changed(SITEMAP_XML, sitemap)


def build_feed(posts):
    feed_url = absolute_url("/feed.xml")
    home_url = absolute_url(home_path())
    if posts:
        updated = f"{posts[0]['date']}T00:00:00Z"
    else:
        updated = "1970-01-01T00:00:00Z"
    entries = []
    for post in posts:
        body_html = render_markdown(post["body_md"])
        entries.append(
            "  <entry>\n"
            f"    <title>{html.escape(post['displayDate'])}</title>\n"
            f"    <link href=\"{html.escape(post['canonical'])}\"/>\n"
            f"    <id>{html.escape(post['canonical'])}</id>\n"
            f"    <updated>{post['date']}T00:00:00Z</updated>\n"
            f"    <published>{post['date']}T00:00:00Z</published>\n"
            f"    <author><name>{html.escape(AUTHOR_NAME)}</name></author>\n"
            f"    <summary>{html.escape(post['blurb'] or '')}</summary>\n"
            f"    <content type=\"html\">{html.escape(body_html)}</content>\n"
            "  </entry>\n"
        )
    feed = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<feed xmlns="http://www.w3.org/2005/Atom">\n'
        f"  <title>{html.escape(SITE_NAME)}</title>\n"
        f"  <subtitle>{html.escape(SITE_DESCRIPTION)}</subtitle>\n"
        f"  <link href=\"{html.escape(home_url)}\"/>\n"
        f"  <link rel=\"self\" type=\"application/atom+xml\" href=\"{html.escape(feed_url)}\"/>\n"
        f"  <id>{html.escape(home_url)}</id>\n"
        f"  <updated>{updated}</updated>\n"
        f"  <author><name>{html.escape(AUTHOR_NAME)}</name><uri>{html.escape(AUTHOR_URL)}</uri></author>\n"
        f"  <rights>© pk · CC BY 4.0</rights>\n"
        + "".join(entries)
        + "</feed>\n"
    )
    write_if_changed(FEED_XML, feed)


def jsonld_breadcrumbs(items):
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": idx + 1, "name": name, "item": absolute_url(path)}
            for idx, (name, path) in enumerate(items)
        ],
    }


def jsonld_article(post):
    payload = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "headline": post["displayDate"],
        "datePublished": post["date"],
        "dateModified": post["date"],
        "author": {"@type": "Person", "name": AUTHOR_NAME, "url": AUTHOR_URL},
        "mainEntityOfPage": {"@type": "WebPage", "@id": post["canonical"]},
        "url": post["canonical"],
        "wordCount": post["word_count"],
        "description": post["blurb"] or f'Notebook entry from {post["displayDate"]}.',
    }
    if post.get("img"):
        payload["image"] = absolute_url(largest_variant(post["img"]))
    return payload


def jsonld_project(project):
    payload = {
        "@context": "https://schema.org",
        "@type": "CreativeWork",
        "name": project["title"],
        "url": project["canonical"],
        "author": {"@type": "Person", "name": AUTHOR_NAME, "url": AUTHOR_URL},
        "creativeWorkStatus": project["state"],
    }
    if project.get("lede"):
        payload["description"] = project["lede"]
    return payload


def jsonld_website():
    return {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": SITE_NAME,
        "url": SITE_ROOT,
        "author": {"@type": "Person", "name": AUTHOR_NAME, "url": AUTHOR_URL},
    }


def render_jsonld(*payloads):
    if not payloads:
        return ""
    blocks = []
    for payload in payloads:
        if not payload:
            continue
        blocks.append(
            '<script type="application/ld+json">'
            + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            + "</script>"
        )
    return "\n".join(blocks)


def main():
    build_id = compute_build_id()
    env = make_environment()
    template = env.get_template(TEMPLATE_NAME)

    posts = load_posts()
    projects = load_projects()
    meta = load_json(ROOT / "meta.json")

    print("posts:")
    build_posts_json(posts)

    print("projects:")
    build_projects_json(projects)

    print("pages:")
    write_page(
        template,
        INDEX_HTML,
        **page_context(
            build_id=build_id,
            main_html=render_home_page(posts, projects, meta),
            nav="home",
            page_kind="home",
            main_class="main",
            description="Engineer, worldbuilder, late-night blogger. Personal writing, projects, and workshop notes.",
            canonical=absolute_url(home_path()),
            json_ld=render_jsonld(jsonld_website()),
        ),
    )
    write_page(
        template,
        BLOG_INDEX,
        **page_context(
            build_id=build_id,
            main_html=render_blog_page(posts),
            nav="blog",
            page_kind="blog",
            main_class="main",
            title="Blog",
            description="Notebook entries, newest first.",
            canonical=absolute_url(blog_path()),
            json_ld=render_jsonld(
                jsonld_breadcrumbs([("Home", home_path()), ("Blog", blog_path())])
            ),
        ),
    )
    for post in posts:
        write_page(
            template,
            POST_ROUTE_DIR / post["slug"] / "index.html",
            **page_context(
                build_id=build_id,
                main_html=render_post_page(post, posts),
                nav="blog",
                page_kind="post",
                main_class="main main--post",
                title=post["displayDate"],
                description=post["blurb"] or f'Notebook entry from {post["displayDate"]}.',
                canonical=post["canonical"],
                og_image=absolute_url(largest_variant(post["img"])) if post.get("img") else DEFAULT_OG_IMAGE,
                giscus_term=post["slug"],
                json_ld=render_jsonld(
                    jsonld_article(post),
                    jsonld_breadcrumbs([
                        ("Home", home_path()),
                        ("Blog", blog_path()),
                        (post["displayDate"], post["path"]),
                    ]),
                ),
            ),
        )
    write_page(
        template,
        ROOT / "projects" / "index.html",
        **page_context(
            build_id=build_id,
            main_html=render_projects_page(projects),
            nav="projects",
            page_kind="projects",
            main_class="main",
            title="Projects",
            description="Long-running threads, experiments, and project notes.",
            canonical=absolute_url(projects_path()),
            json_ld=render_jsonld(
                jsonld_breadcrumbs([("Home", home_path()), ("Projects", projects_path())])
            ),
        ),
    )
    for project in projects:
        write_page(
            template,
            ROOT / "projects" / project["slug"] / "index.html",
            **page_context(
                build_id=build_id,
                main_html=render_project_detail_page(project),
                nav="projects",
                page_kind="project",
                main_class="main main--post",
                title=project["title"],
                description=project["lede"] or f'Project notes for {project["title"]}.',
                canonical=project["canonical"],
                json_ld=render_jsonld(
                    jsonld_project(project),
                    jsonld_breadcrumbs([
                        ("Home", home_path()),
                        ("Projects", projects_path()),
                        (project["title"], project["path"]),
                    ]),
                ),
            ),
        )
    write_page(
        template,
        NOT_FOUND_HTML,
        **page_context(
            build_id=build_id,
            main_html=render_not_found_page(),
            nav="",
            page_kind="error",
            main_class="main",
            title="Not Found",
            description="That page does not exist.",
            canonical=absolute_url("/404.html"),
        ),
    )
    print("sitemap:")
    build_sitemap(posts, projects)
    print("feed:")
    build_feed(posts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
