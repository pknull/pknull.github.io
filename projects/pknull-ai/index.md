---
title: "PKNULL.AI"
kind: coding
state: active
order: 6
lede: "The site itself: a hand-built personal notebook and workshop index, generated as a static multipage site from Markdown, JSON, and a small Python build step."
etymology:
  word: "null"
  gloss: "Latin nullus — none. The old handle carried forward into a domain."
links:
  - label: "github"
    href: "https://github.com/pknull/pknull.github.io"
  - label: "live"
    href: "https://pknull.ai/"
---

## What It Is

This site is a real codebase, not just a pile of posts in a CMS. It is the public-facing notebook for everything else here: blog entries, project pages, the home page, and the small bits of status/marginalia that make it feel alive.

The content lives in Markdown and JSON. The pages are generated into static HTML. The result is intentionally simple: no framework build chain, no admin backend, no database, no platform dependency beyond static hosting.

---

## Current Shape

The current version is a generated static site with a small handwritten toolchain:

| Piece | Role |
|------|------|
| `posts/*.md` | Notebook entries |
| `projects/*.md` | Project pages and workshop cards |
| `meta.json` / `reading.json` | Home-page and now-strip data |
| `templates/base.html` | Shared page shell |
| `bin/build-index.py` | Builds `posts.json`, `projects.json`, route pages, and sitemap |
| `js/app.js` | Client-side enhancements only: mode toggle, consent, now-strip, code tools, mermaid, comments |
| `css/shell.css` | Site layout and visual language |

The older hash-routed SPA version is gone. It now emits real pages for `/`, `/blog/`, `/post/<date>/`, `/projects/`, and `/projects/<slug>/`, with legacy hash URLs redirected forward.

---

## Why It Looks Like This

I wanted the site to stay inspectable and easy to rewrite by hand. That meant keeping the stack narrow: plain HTML, CSS, JavaScript, Markdown, and a Python builder instead of introducing a larger framework just to publish writing and project notes.

That also keeps the site close to the shape of the writing. Posts are files. Projects are files. The build step assembles them into a public artifact, but the source of truth is still readable without a browser.

---

## Status

Active and under regular revision. It doubles as both the publication surface and a running experiment in what a personal site should feel like when it is treated as a maintained software project rather than a theme selection.
