(function() {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // Toast
  // ─────────────────────────────────────────────────────────────
  function showToast(message, type) {
    type = type || 'info';
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(function() {
      toast.classList.add('toast-visible');
    });

    setTimeout(function() {
      toast.classList.remove('toast-visible');
      setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
  }

  // ─────────────────────────────────────────────────────────────
  // Tri-state mode toggle (auto / light / dark)
  // ─────────────────────────────────────────────────────────────
  var MODES = ['auto', 'light', 'dark'];
  var modeToggleBtn = document.getElementById('mode-toggle');
  var hljsTheme = document.getElementById('hljs-theme');
  var prefersDarkMq = window.matchMedia('(prefers-color-scheme: dark)');

  // Daily cache-buster
  var CACHE_VERSION = (document.querySelector('meta[name="build-id"]') || {}).content || new Date().toISOString().slice(0, 10);

  var HLJS_THEMES = {
    dark:  { href: 'css/hljs-dark.css' },
    light: { href: 'css/hljs-light.css' }
  };

  function getStoredMode() {
    var v = localStorage.getItem('pk-mode');
    return MODES.indexOf(v) >= 0 ? v : 'auto';
  }

  function resolveMode(mode) {
    if (mode === 'auto') return prefersDarkMq.matches ? 'dark' : 'light';
    return mode;
  }

  function applyMode(mode) {
    var resolved = resolveMode(mode);
    if (resolved === 'dark') {
      document.documentElement.setAttribute('data-mode', 'dark');
    } else {
      document.documentElement.removeAttribute('data-mode');
    }
    setHighlightTheme(resolved === 'dark');
    if (modeToggleBtn) {
      modeToggleBtn.textContent = mode.toUpperCase();
      modeToggleBtn.setAttribute('aria-label', 'Color mode: ' + mode + '. Click to cycle.');
    }
    updateMermaidTheme(resolved === 'dark');
    updateGiscusTheme();
  }

  function setHighlightTheme(isDark) {
    if (!hljsTheme) return;
    var theme = isDark ? HLJS_THEMES.dark : HLJS_THEMES.light;
    hljsTheme.disabled = false;
    hljsTheme.href = theme.href + '?v=' + CACHE_VERSION;
  }

  var currentMode = getStoredMode();
  applyMode(currentMode);

  if (modeToggleBtn) {
    modeToggleBtn.addEventListener('click', function() {
      var idx = MODES.indexOf(currentMode);
      currentMode = MODES[(idx + 1) % MODES.length];
      localStorage.setItem('pk-mode', currentMode);
      applyMode(currentMode);
    });
  }

  // Re-resolve auto mode on system change
  if (prefersDarkMq.addEventListener) {
    prefersDarkMq.addEventListener('change', function() {
      if (currentMode === 'auto') applyMode('auto');
    });
  } else if (prefersDarkMq.addListener) {
    prefersDarkMq.addListener(function() {
      if (currentMode === 'auto') applyMode('auto');
    });
  }

  function isDarkResolved() {
    return document.documentElement.getAttribute('data-mode') === 'dark';
  }

  // ─────────────────────────────────────────────────────────────
  // Consent banner (analytics)
  // ─────────────────────────────────────────────────────────────
  var consentBanner = document.getElementById('consent-banner');
  var consentAccept = document.getElementById('consent-accept');
  var consentDecline = document.getElementById('consent-decline');
  var storedConsent = localStorage.getItem('analytics_consent');
  var previousActiveElement = null;

  function showConsentBanner() {
    previousActiveElement = document.activeElement;
    consentBanner.hidden = false;
    consentBanner.setAttribute('aria-hidden', 'false');
    consentAccept.focus();
  }

  function hideConsentBanner() {
    consentBanner.hidden = true;
    consentBanner.setAttribute('aria-hidden', 'true');
    if (previousActiveElement && previousActiveElement.focus) {
      previousActiveElement.focus();
    }
  }

  consentBanner.addEventListener('keydown', function(e) {
    if (e.key === 'Tab') {
      var focusable = consentBanner.querySelectorAll('button');
      var first = focusable[0];
      var last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    if (e.key === 'Escape') {
      localStorage.setItem('analytics_consent', 'denied');
      hideConsentBanner();
    }
  });

  if (!storedConsent) showConsentBanner();

  consentAccept.onclick = function() {
    localStorage.setItem('analytics_consent', 'granted');
    if (typeof loadGoogleAnalytics === 'function') loadGoogleAnalytics();
    hideConsentBanner();
  };

  consentDecline.onclick = function() {
    localStorage.setItem('analytics_consent', 'denied');
    hideConsentBanner();
  };

  // ─────────────────────────────────────────────────────────────
  // Markdown pipeline (preserved verbatim from prior version)
  // ─────────────────────────────────────────────────────────────
  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function extractAbbreviations(md) {
    var abbrs = {};
    var lines = md.split('\n');
    var contentLines = [];
    var abbrPattern = /^\*\[([^\]]+)\]:\s*(.+)$/;

    for (var i = 0; i < lines.length; i++) {
      var match = lines[i].match(abbrPattern);
      if (match) {
        abbrs[match[1]] = match[2];
      } else {
        contentLines.push(lines[i]);
      }
    }
    return { content: contentLines.join('\n'), abbrs: abbrs };
  }

  function applyAbbreviations(html, abbrs) {
    var keys = Object.keys(abbrs);
    if (keys.length === 0) return html;

    keys.sort(function(a, b) { return b.length - a.length; });
    var pattern = new RegExp('\\b(' + keys.map(escapeRegExp).join('|') + ')\\b', 'g');
    var template = document.createElement('template');
    template.innerHTML = html;
    var walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT, null, false);

    function shouldSkip(node) {
      var el = node.parentElement;
      while (el) {
        var tag = el.tagName && el.tagName.toLowerCase();
        if (tag === 'code' || tag === 'pre' || tag === 'kbd' || tag === 'samp' || tag === 'abbr') return true;
        el = el.parentElement;
      }
      return false;
    }

    while (walker.nextNode()) {
      var node = walker.currentNode;
      var text = node.nodeValue;
      if (!text || !text.trim()) continue;
      if (shouldSkip(node)) continue;

      var lastIndex = 0;
      var match;
      var frag = null;
      pattern.lastIndex = 0;

      while ((match = pattern.exec(text)) !== null) {
        if (!frag) frag = document.createDocumentFragment();
        if (match.index > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        var term = match[1];
        var abbr = document.createElement('abbr');
        abbr.title = abbrs[term];
        abbr.textContent = term;
        frag.appendChild(abbr);
        lastIndex = match.index + term.length;
      }

      if (frag) {
        if (lastIndex < text.length) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex)));
        }
        node.parentNode.replaceChild(frag, node);
      }
    }

    return template.innerHTML;
  }

  function renderMarkdown(md) {
    var extracted = extractAbbreviations(md);
    var html = marked.parse(extracted.content);
    return applyAbbreviations(html, extracted.abbrs);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Convert ISO date (2025-12-04) to display form (2025.12.04). Tolerates
  // legacy callers that pass the display form already.
  function toDisplayDate(iso) {
    if (/^\d{4}\.\d{2}\.\d{2}$/.test(iso)) return iso;
    var parts = iso.split('-');
    return parts[0] + '.' + parts[1] + '.' + parts[2];
  }

  // ─────────────────────────────────────────────────────────────
  // Read time
  // ─────────────────────────────────────────────────────────────
  function addReadTimeForPost() {
    var mainEl = document.getElementById('main');
    var hd = mainEl.querySelector('.post-hd');
    var body = mainEl.querySelector('.post-body');
    if (!hd || !body) return;
    var words = body.textContent.trim().split(/\s+/).filter(function(w) { return w.length > 0; }).length;
    var minutes = Math.max(1, Math.ceil(words / 200));
    var meta = hd.querySelector('.post-meta');
    if (meta) {
      var span = document.createElement('span');
      span.className = 'mono dim';
      span.textContent = minutes + ' min read';
      meta.appendChild(span);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Code copy / expand
  // ─────────────────────────────────────────────────────────────
  function copyToClipboard(text, onSuccess, onError) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(onSuccess)
        .catch(function() {
          fallbackCopy(text, onSuccess, onError);
        });
    } else {
      fallbackCopy(text, onSuccess, onError);
    }
  }

  function fallbackCopy(text, onSuccess, onError) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      var success = document.execCommand('copy');
      if (success) onSuccess(); else onError();
    } catch (e) {
      onError();
    }
    document.body.removeChild(textarea);
  }

  function addCodeCopyButtons() {
    var codeBlocks = document.querySelectorAll('pre > code');
    codeBlocks.forEach(function(code) {
      var pre = code.parentElement;
      if (pre.querySelector('.code-toolbar')) return;

      var toolbar = document.createElement('div');
      toolbar.className = 'code-toolbar';

      var copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy';
      copyBtn.textContent = 'copy';
      copyBtn.setAttribute('aria-label', 'Copy code to clipboard');
      copyBtn.onclick = function() {
        var text = code.textContent;
        copyToClipboard(text,
          function() {
            copyBtn.textContent = 'copied';
            copyBtn.classList.add('copied');
            setTimeout(function() {
              copyBtn.textContent = 'copy';
              copyBtn.classList.remove('copied');
            }, 1500);
          },
          function() {
            copyBtn.textContent = 'failed';
            showToast('Failed to copy to clipboard', 'error');
            setTimeout(function() { copyBtn.textContent = 'copy'; }, 1500);
          }
        );
      };

      var expandBtn = document.createElement('button');
      expandBtn.className = 'code-expand';
      expandBtn.textContent = 'expand';
      expandBtn.setAttribute('aria-label', 'Toggle full width');
      expandBtn.onclick = function() {
        pre.classList.toggle('expanded');
        expandBtn.textContent = pre.classList.contains('expanded') ? 'collapse' : 'expand';
      };

      toolbar.appendChild(copyBtn);
      toolbar.appendChild(expandBtn);
      pre.appendChild(toolbar);
    });
  }

  function setLazyImages(scope) {
    var root = scope || document;
    var imgs = root.querySelectorAll('img');
    imgs.forEach(function(img) {
      if (!img.hasAttribute('loading')) img.loading = 'lazy';
    });
  }

  // Open off-site links in a new tab. Internal targets (#/route, anchors,
  // same-host URLs, javascript:) are left alone so SPA routing still works.
  function markExternalLinks(scope) {
    var root = scope || document;
    var here = window.location.hostname;
    root.querySelectorAll('a[href]').forEach(function(a) {
      var href = a.getAttribute('href');
      if (!href) return;
      if (a.hasAttribute('target')) return; // respect explicit choices
      var lower = href.toLowerCase();
      if (lower[0] === '#' || lower[0] === '/' || lower.indexOf('javascript:') === 0) return;
      var external = false;
      if (lower.indexOf('mailto:') === 0 || lower.indexOf('tel:') === 0 || lower.indexOf('sms:') === 0) {
        external = true;
      } else if (/^https?:\/\//i.test(href)) {
        try {
          external = new URL(href).hostname !== here;
        } catch (e) {
          external = true;
        }
      }
      if (external) {
        a.target = '_blank';
        var rel = (a.getAttribute('rel') || '').split(/\s+/).filter(Boolean);
        if (rel.indexOf('noopener') === -1) rel.push('noopener');
        if (rel.indexOf('noreferrer') === -1) rel.push('noreferrer');
        a.setAttribute('rel', rel.join(' '));
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Mermaid (lazy)
  // ─────────────────────────────────────────────────────────────
  var mermaidLoaded = false;
  function loadMermaid(callback) {
    if (mermaidLoaded) { callback(); return; }
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
    script.onload = function() {
      mermaidLoaded = true;
      mermaid.initialize({ startOnLoad: false, theme: isDarkResolved() ? 'dark' : 'default' });
      callback();
    };
    document.head.appendChild(script);
  }

  function updateMermaidTheme(isDark) {
    if (!mermaidLoaded || !window.mermaid) return;
    mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default' });
    var diagrams = document.querySelectorAll('.mermaid');
    if (diagrams.length) {
      diagrams.forEach(function(el) {
        var src = el.getAttribute('data-mermaid-source');
        if (src) {
          var fresh = document.createElement('div');
          fresh.className = 'mermaid';
          fresh.setAttribute('data-mermaid-source', src);
          fresh.textContent = src;
          el.replaceWith(fresh);
        }
      });
      mermaid.run({ nodes: document.querySelectorAll('.mermaid') });
    }
  }

  function processMermaidBlocks(scope) {
    var root = scope || document;
    var mermaidBlocks = root.querySelectorAll('code.language-mermaid');
    if (!mermaidBlocks.length) return;
    mermaidBlocks.forEach(function(block) {
      var pre = block.parentElement;
      var div = document.createElement('div');
      div.className = 'mermaid';
      div.setAttribute('data-mermaid-source', block.textContent);
      div.textContent = block.textContent;
      pre.replaceWith(div);
    });
    loadMermaid(function() {
      mermaid.run({ nodes: root.querySelectorAll('.mermaid') });
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Giscus
  // ─────────────────────────────────────────────────────────────
  var giscusContainer = document.getElementById('giscus-container');
  var giscusLoaded = false;
  var lastGiscusTerm = null;

  function getGiscusTheme() {
    // Use giscus's built-in gruvbox themes — visually matches the site palette
    return isDarkResolved() ? 'gruvbox_dark' : 'gruvbox_light';
  }

  function actuallyLoadGiscus(term) {
    giscusContainer.hidden = false;
    var giscusDiv = giscusContainer.querySelector('.giscus');
    giscusDiv.innerHTML = '';

    var script = document.createElement('script');
    script.src = 'https://giscus.app/client.js';
    script.setAttribute('data-repo', 'pknull/pknull.github.io');
    script.setAttribute('data-repo-id', 'R_kgDOQewMNA');
    script.setAttribute('data-category', 'Blog Comments');
    script.setAttribute('data-category-id', 'DIC_kwDOQewMNM4CzNFI');
    script.setAttribute('data-mapping', 'specific');
    script.setAttribute('data-term', term);
    script.setAttribute('data-strict', '0');
    script.setAttribute('data-reactions-enabled', '1');
    script.setAttribute('data-emit-metadata', '0');
    script.setAttribute('data-input-position', 'top');
    script.setAttribute('data-theme', getGiscusTheme());
    script.setAttribute('data-lang', 'en');
    script.setAttribute('data-loading', 'lazy');
    script.crossOrigin = 'anonymous';
    script.async = true;

    giscusDiv.appendChild(script);
    giscusLoaded = true;
    lastGiscusTerm = term;
  }

  function loadGiscus(term) {
    if (!term) term = 'blog';
    if (giscusLoaded && lastGiscusTerm === term) {
      giscusContainer.hidden = false;
      return;
    }
    actuallyLoadGiscus(term);
  }

  function hideGiscus() {
    giscusContainer.hidden = true;
  }

  function updateGiscusTheme() {
    if (giscusLoaded && !giscusContainer.hidden && lastGiscusTerm) {
      actuallyLoadGiscus(lastGiscusTerm);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Routing
  // ─────────────────────────────────────────────────────────────
  // New scheme:
  //   #/                         → home (also where #/meta and #meta resolve)
  //   #/blog                     → blog list
  //   #/post/<isoDate>           → single post
  //   #/projects                 → projects index
  //   #/projects/<slug>          → single project
  //
  // Backward compat redirects (legacy hashes):
  //   #blog                      → #/blog
  //   #blog:<isoDate>            → #/post/<isoDate>
  //   #meta                      → #/   (meta merged into home)
  //   #asha                      → #/projects/asha
  //   #thallus                   → #/projects/thallus
  //   #test                      → #/post/test  (ad-hoc giscus test page)

  var LEGACY_PROJECTS = { asha: 1, thallus: 1 };

  function legacyRedirect() {
    var hash = window.location.hash;
    if (!hash) return false;
    if (hash.charAt(1) === '/') return false; // already new-style

    var raw = hash.slice(1); // drop '#'
    if (!raw) return false;

    var newHash = null;
    var parts = raw.split(':');
    var key = parts[0];
    var arg = parts[1];

    if (key === 'main') return false; // skip-link target

    if (key === 'blog' && arg) newHash = '#/post/' + arg;
    else if (key === 'blog')   newHash = '#/blog';
    else if (key === 'meta')   newHash = '#/';
    else if (key === 'test')   newHash = '#/post/test';
    else if (LEGACY_PROJECTS[key]) newHash = '#/projects/' + key;

    if (newHash) {
      window.location.replace(window.location.pathname + window.location.search + newHash);
      return true;
    }
    return false;
  }

  function parseHash() {
    var hash = window.location.hash.slice(1);
    if (!hash || hash === '/') return { name: 'home' };
    if (hash.charAt(0) !== '/') return { name: 'home' }; // fallback (legacy redirect runs separately)

    var segments = hash.slice(1).split('/').filter(Boolean);
    if (segments.length === 0) return { name: 'home' };

    var head = segments[0];
    if (head === 'blog')     return { name: 'blog' };
    if (head === 'projects') return { name: segments[1] ? 'project' : 'projects', slug: segments[1] || null };
    if (head === 'post')     return { name: 'post', slug: segments[1] || null };
    return { name: 'home' };
  }

  function updateActiveNav(routeName) {
    var navMap = { home: 'home', blog: 'blog', post: 'blog', projects: 'projects', project: 'projects' };
    var active = navMap[routeName] || 'home';
    document.querySelectorAll('.nb-nav a').forEach(function(link) {
      var r = link.getAttribute('data-route');
      if (r === active) {
        link.classList.add('on');
        link.setAttribute('aria-current', 'page');
      } else {
        link.classList.remove('on');
        link.removeAttribute('aria-current');
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Data fetchers
  // ─────────────────────────────────────────────────────────────
  var fetchCache = {};

  function fetchText(url) {
    var key = url + '?v=' + CACHE_VERSION;
    if (fetchCache[key]) return Promise.resolve(fetchCache[key]);
    return fetch(key, { cache: 'no-cache' })
      .then(function(response) {
        if (!response.ok) {
          var err = new Error(response.status === 404 ? 'not-found' : 'server-error');
          err.status = response.status;
          throw err;
        }
        return response.text();
      })
      .then(function(text) {
        fetchCache[key] = text;
        return text;
      });
  }

  function fetchJson(url) {
    var key = url + '?v=' + CACHE_VERSION;
    if (fetchCache[key]) return Promise.resolve(fetchCache[key]);
    return fetch(key, { cache: 'no-cache' })
      .then(function(response) {
        if (!response.ok) throw new Error('server-error');
        return response.json();
      })
      .then(function(data) {
        fetchCache[key] = data;
        return data;
      });
  }

  // ─────────────────────────────────────────────────────────────
  // Renderers
  // ─────────────────────────────────────────────────────────────
  var mainEl = document.getElementById('main');

  function setMainKind(kind) {
    mainEl.className = 'main' + (kind === 'post' ? ' main--post' : '');
  }

  function showError(message) {
    mainEl.innerHTML =
      '<div class="error-state" role="alert">' +
      '<p>' + escapeHtml(message) + '</p>' +
      '<p><a href="#/">Return home</a> or <a href="javascript:location.reload()">try again</a></p>' +
      '</div>';
    showToast(message, 'error');
  }

  function postLink(iso) {
    return '#/post/' + iso;
  }

  function projectLink(slug) {
    return '#/projects/' + slug;
  }

  function pillsFor(p) {
    // Two-axis: kind (coding/writing) + state (active/inactive/archived).
    // Falls back to legacy single `status` field if kind/state aren't set.
    var kind = p.kind;
    var state = p.state;
    if (!kind && !state && p.status) {
      // Legacy migration: a status of 'writing' maps to kind=writing/state=active;
      // 'archive'/'archived' maps to kind=coding/state=archived; otherwise kind=coding.
      if (p.status === 'writing') { kind = 'writing'; state = 'active'; }
      else if (p.status === 'archive' || p.status === 'archived') { kind = 'coding'; state = 'archived'; }
      else { kind = 'coding'; state = p.status; }
    }
    kind = kind || 'coding';
    state = state || 'active';
    var kindCls = kind === 'writing' ? 'pill-writing' : 'pill-coding';
    var stateCls = state === 'archived' ? 'pill-archived'
                 : state === 'inactive' ? 'pill-inactive'
                 : 'pill-active';
    return '<div class="proj-pills">' +
      '<span class="proj-pill ' + kindCls + '">' + escapeHtml(kind) + '</span>' +
      '<span class="proj-pill ' + stateCls + '">' + escapeHtml(state) + '</span>' +
    '</div>';
  }

  // Posts index. posts.json is generated by /tmp/split-blog.py and committed.
  // Each entry: { slug, date, displayDate, blurb }. Sorted newest-first.
  function fetchPosts() {
    return fetchJson('./posts.json');
  }

  // Ensure each post entry has a displayDate (back-compat for entries written
  // without it — e.g. if posts.json is hand-edited).
  function normalizePost(p) {
    if (!p.displayDate && p.date) p.displayDate = toDisplayDate(p.date);
    if (!p.displayDate && p.slug) p.displayDate = toDisplayDate(p.slug);
    return p;
  }

  function renderHome() {
    setMainKind('home');
    Promise.all([
      fetchPosts().catch(function(){ return []; }),
      fetchJson('./projects.json').catch(function(){ return []; }),
      fetchJson('./meta.json').catch(function(){ return {}; })
    ])
      .then(function(arr) {
        var posts = arr[0].map(normalizePost);
        var projects = arr[1].slice(0, 6);
        var meta = arr[2] || {};
        var feat = posts.slice(0, 3);
        var rest = posts.slice(3, 8);
        var standing = (meta.standing || []).slice(0, 6);

        var featHtml = feat.length
          ? '<ol class="post-feat-list">' + feat.map(function(e) {
              var imgHtml = e.img
                ? '<img src="' + escapeHtml(e.img) + '" alt="" loading="lazy">'
                : '<span class="ph-date">' + escapeHtml(e.displayDate) + '</span>';
              return '<li class="post-feat"><a class="post-feat-link" href="' + postLink(e.slug) + '">' +
                '<div class="post-feat-img">' + imgHtml + '</div>' +
                '<div class="post-feat-body">' +
                  '<div class="post-feat-meta">' +
                    '<span class="post-feat-meta-date">' + escapeHtml(e.displayDate) + '</span>' +
                  '</div>' +
                  '<p class="post-feat-blurb">' + escapeHtml(e.blurb || '(entry)') + '</p>' +
                '</div>' +
              '</a></li>';
            }).join('') + '</ol>'
          : '<p class="empty">No posts yet.</p>';

        var restHtml = rest.length
          ? '<ol class="post-list tight">' + rest.map(function(e) {
              return '<li><a href="' + postLink(e.slug) + '">' +
                '<span class="pl-date">' + escapeHtml(e.displayDate) + '</span>' +
                '<span class="pl-title">' + escapeHtml(e.blurb || '(entry)') + '</span>' +
                '<span class="pl-tag" aria-hidden="true">→</span>' +
              '</a></li>';
            }).join('') + '</ol>'
          : '';

        var projectsHtml = projects.length
          ? '<ol class="proj-list">' + projects.map(function(p) {
              var kind = p.kind || 'coding';
              var state = p.state || 'active';
              var etym = p.etymology;
              var etymHtml = etym && etym.word
                ? '<div class="proj-card-etym">' +
                    '<span class="proj-card-etym-word">' + escapeHtml(etym.word) + '</span>' +
                    (etym.gloss ? ' — ' + escapeHtml(etym.gloss) : '') +
                  '</div>'
                : '';
              return '<li class="proj-card state-' + escapeHtml(state) + ' kind-' + escapeHtml(kind) + '">' +
                '<a class="proj-link" href="' + projectLink(p.slug) + '">' +
                  '<div class="proj-card-head">' +
                    '<h3 class="proj-card-name"><span class="proj-dot" aria-hidden="true"></span>' + escapeHtml(p.title) + '</h3>' +
                    '<span class="proj-card-meta">' + escapeHtml(kind) + ' · ' + escapeHtml(state) + '</span>' +
                  '</div>' +
                  (p.lede ? '<p class="proj-card-lede">' + escapeHtml(p.lede) + '</p>' : '') +
                  etymHtml +
                '</a></li>';
            }).join('') + '</ol>'
          : '<p class="empty">No projects yet.</p>';

        var standingHtml = standing.length
          ? '<aside class="hero-aside" aria-label="Standing">' +
              '<div class="aside-hd">Standing</div>' +
              '<dl class="aside-list">' + standing.map(function(s) {
                var valHtml = window.marked
                  ? DOMPurify.sanitize(marked.parseInline(s.val || ''))
                  : escapeHtml(s.val || '');
                return '<div class="aside-row"><dt>' + escapeHtml(s.key) + '</dt><dd>' + valHtml + '</dd></div>';
              }).join('') + '</dl>' +
            '</aside>'
          : '';

        var bioHtml = (meta.bio || []).map(function(p) {
          return '<p>' + DOMPurify.sanitize(window.marked ? marked.parseInline(p) : escapeHtml(p)) + '</p>';
        }).join('');
        var aboutHtml = (meta.portrait || bioHtml)
          ? '<aside class="home-about" aria-labelledby="about-h2">' +
              '<div class="col-hd"><h2 id="about-h2"><em>About</em></h2></div>' +
              '<div class="about-body">' +
                (meta.portrait
                  ? '<div class="about-portrait"><img src="' + escapeHtml(meta.portrait) + '" alt=""></div>'
                  : '') +
                '<div class="about-bio">' + bioHtml + '</div>' +
              '</div>' +
            '</aside>'
          : '';

        var linksHtml = '';
        if (meta.links) {
          var groups = Object.keys(meta.links);
          var groupsHtml = groups.map(function(g) {
            var items = (meta.links[g] || []).map(function(l) {
              return '<li><a href="' + escapeHtml(l.href) + '">' + escapeHtml(l.label) + '</a></li>';
            }).join('');
            return '<div class="link-col">' +
              '<div class="col-hd mono caps dim">' + escapeHtml(g) + '</div>' +
              '<ul class="plain">' + items + '</ul>' +
            '</div>';
          }).join('');
          linksHtml =
            '<section class="home-links" aria-labelledby="elsewhere-h2">' +
              '<div class="col-hd"><h2 id="elsewhere-h2"><em>Elsewhere</em></h2></div>' +
              '<div class="link-grid">' + groupsHtml + '</div>' +
            '</section>';
        }

        mainEl.innerHTML =
          '<section class="hero" aria-labelledby="hero-title">' +
            '<div class="hero-body">' +
              '<div class="hero-kicker">est. 2025 · a notebook by louis g.</div>' +
              '<h1 class="hero-title" id="hero-title">' +
                'Engineer, worldbuilder, late-night ' +
                '<em>nightcap</em> blogger. Writing things down before I forget them.' +
              '</h1>' +
              '<p class="hero-lede">' +
                'Three decades in software, mostly systems and security. ' +
                'Currently in Eugene, building <a href="#/projects/asha">Asha</a> ' +
                'and a cosmic horror novel called <a href="#/projects/hush">The Hush</a>. ' +
                'Updated whenever the day quiets down.' +
              '</p>' +
              '<div class="hero-actions">' +
                '<a href="#/blog" class="btn-pri">Read the journal →</a>' +
                '<a href="#/projects" class="btn-sec">See the workshop</a>' +
              '</div>' +
            '</div>' +
            standingHtml +
          '</section>' +
          '<div class="home-split">' +
            '<section class="col-recent" aria-labelledby="recent-h2">' +
              '<div class="col-hd">' +
                '<h2 id="recent-h2"><em>Recent entries</em></h2>' +
                '<a href="#/blog">view all ' + posts.length + ' →</a>' +
              '</div>' +
              featHtml +
              restHtml +
              aboutHtml +
            '</section>' +
            '<section class="col-shop" aria-labelledby="shop-h2">' +
              '<div class="col-hd">' +
                '<h2 id="shop-h2"><em>In the workshop</em></h2>' +
                '<a href="#/projects">all projects →</a>' +
              '</div>' +
              projectsHtml +
            '</section>' +
          '</div>' +
          linksHtml;
        hideGiscus();
        updateActiveNav('home');
        setLazyImages(mainEl);
        markExternalLinks(mainEl);
      })
      .catch(function(err) {
        showError(err.message === 'not-found' ? 'Page not found.' : 'Failed to load home.');
      });
  }

  function renderBlog() {
    setMainKind('blog');
    fetchPosts()
      .then(function(rawPosts) {
        var posts = rawPosts.map(normalizePost);

        // Group by month (YYYY.MM)
        var groups = {};
        var order = [];
        posts.forEach(function(e) {
          var month = e.displayDate.slice(0, 7);
          if (!groups[month]) {
            groups[month] = [];
            order.push(month);
          }
          groups[month].push(e);
        });

        var groupHtml = order.map(function(month) {
          var items = groups[month].map(function(e) {
            return '<li><a href="' + postLink(e.slug) + '">' +
              '<div class="pl-meta">' +
                '<span>' + escapeHtml(e.displayDate) + '</span>' +
              '</div>' +
              '<div class="pl-title-big">' + escapeHtml(e.blurb ? e.blurb.split(/[.!?]/, 1)[0] : e.displayDate) + '</div>' +
              (e.blurb ? '<p class="pl-blurb">' + escapeHtml(e.blurb) + '</p>' : '') +
            '</a></li>';
          }).join('');
          return '<section class="month-group">' +
            '<div class="month-hd">' + escapeHtml(month) + '</div>' +
            '<ol class="post-list big">' + items + '</ol>' +
          '</section>';
        }).join('');

        mainEl.innerHTML =
          '<header class="page-hd">' +
            '<p class="hd-kicker dim"><a href="#/">← home</a></p>' +
            '<h1>Blog</h1>' +
            '<p class="page-lede">Notebook entries, newest first.</p>' +
          '</header>' +
          (posts.length ? groupHtml : '<p class="empty">No entries yet.</p>');

        hideGiscus();
        updateActiveNav('blog');
        setLazyImages(mainEl);
        markExternalLinks(mainEl);
      })
      .catch(function(err) {
        showError(err.message === 'not-found' ? 'Page not found.' : 'Failed to load blog.');
      });
  }

  function renderPost(slug) {
    setMainKind('post');

    // Special: test page (legacy giscus test)
    if (slug === 'test') {
      fetchText('./test.md')
        .then(function(md) {
          mainEl.innerHTML =
            '<p class="back-link"><a href="#/blog">← All entries</a></p>' +
            '<article class="post">' +
              '<header class="post-hd"><h1>Test page</h1>' +
                '<div class="post-meta"><span class="mono dim">test</span></div>' +
              '</header>' +
              '<div class="post-body">' + DOMPurify.sanitize(renderMarkdown(md)) + '</div>' +
            '</article>';
          finishPostRender('test');
        })
        .catch(function() { showError('Test page failed to load.'); });
      return;
    }

    Promise.all([
      fetchText('./posts/' + slug + '.md'),
      fetchPosts().catch(function(){ return []; })
    ])
      .then(function(arr) {
        var bodyMd = arr[0];
        var posts = arr[1].map(normalizePost);
        var displayDate = toDisplayDate(slug);

        // posts.json is sorted newest→oldest, so idx-1 = newer post, idx+1 = older
        var idx = -1;
        for (var i = 0; i < posts.length; i++) {
          if (posts[i].slug === slug) { idx = i; break; }
        }
        var newer = idx > 0 ? posts[idx - 1] : null;
        var older = idx >= 0 && idx < posts.length - 1 ? posts[idx + 1] : null;

        var navHtml = '';
        if (newer || older) {
          navHtml = '<nav class="post-nav">' +
            (older ? '<a href="' + postLink(older.slug) + '">← ' + escapeHtml(older.displayDate) + '</a>' : '<span></span>') +
            (newer ? '<a href="' + postLink(newer.slug) + '">' + escapeHtml(newer.displayDate) + ' →</a>' : '<span></span>') +
          '</nav>';
        }

        mainEl.innerHTML =
          '<p class="back-link"><a href="#/blog">← All entries</a></p>' +
          '<article class="post">' +
            '<header class="post-hd">' +
              '<h1>' + escapeHtml(displayDate) + '</h1>' +
              '<div class="post-meta">' +
                '<span class="mono">notebook entry</span>' +
              '</div>' +
            '</header>' +
            '<div class="post-body">' + DOMPurify.sanitize(renderMarkdown(bodyMd)) + '</div>' +
            navHtml +
          '</article>';

        addReadTimeForPost();
        finishPostRender(slug);
      })
      .catch(function(err) {
        showError(err.message === 'not-found' ? 'Entry not found.' : 'Failed to load entry.');
      });
  }

  function finishPostRender(term) {
    setLazyImages(mainEl);
    markExternalLinks(mainEl);
    processMermaidBlocks(mainEl);
    if (window.hljs) hljs.highlightAll();
    addCodeCopyButtons();
    updateActiveNav('post');

    loadGiscus(term);

    window.scrollTo(0, 0);
  }

  function renderProjects() {
    setMainKind('projects');
    fetchJson('./projects.json')
      .then(function(projects) {
        var cards = projects.map(function(p) {
          return '<article class="proj-card">' +
            '<header class="proj-card-hd">' +
              '<a class="proj-card-name-link" href="' + projectLink(p.slug) + '">' +
                '<h2 class="proj-card-name">' + escapeHtml(p.title) + '</h2>' +
              '</a>' +
              pillsFor(p) +
            '</header>' +
            (p.lede ? '<p class="proj-card-lede">' + escapeHtml(p.lede) + '</p>' : '') +
            (p.etymology ?
              '<p class="proj-etym"><span class="caps mono">etym.</span> ' + escapeHtml(p.etymology.word) +
              (p.etymology.gloss ? ' — ' + escapeHtml(p.etymology.gloss) : '') + '</p>'
              : '') +
            (p.links && p.links.length ?
              '<div class="proj-card-meta">' + p.links.map(function(l) {
                return '<a href="' + escapeHtml(l.href) + '">' + escapeHtml(l.label) + '</a>';
              }).join('<span aria-hidden="true">·</span>') +
              '<a href="' + projectLink(p.slug) + '">Read →</a></div>'
              : '<div class="proj-card-meta"><a href="' + projectLink(p.slug) + '">Read →</a></div>') +
          '</article>';
        }).join('');

        mainEl.innerHTML =
          '<header class="page-hd">' +
            '<p class="hd-kicker dim"><a href="#/">← home</a></p>' +
            '<h1>Projects</h1>' +
            '<p class="page-lede">Long-running threads. Each has its own page; click a name for the prose.</p>' +
          '</header>' +
          (projects.length ? cards : '<p class="empty">No projects yet.</p>');
        hideGiscus();
        updateActiveNav('projects');
      })
      .catch(function() { showError('Failed to load projects.'); });
  }

  function renderProject(slug) {
    setMainKind('post');
    fetchJson('./projects.json')
      .then(function(projects) {
        var match = projects.filter(function(p) { return p.slug === slug; })[0];
        if (!match) { showError('Project not found.'); return null; }
        return fetchText('./' + match.body).then(function(md) { return [match, md]; });
      })
      .then(function(pair) {
        if (!pair) return;
        var p = pair[0];
        var md = pair[1];

        // Strip YAML frontmatter — metadata lives in projects.json now;
        // body files are just prose.
        var bodyMd = md.replace(/^---\s*\n[\s\S]*?\n---\s*\n+/, '');

        var headerHtml =
          '<header class="proj-card-hd">' +
            '<div class="proj-card-name-link" style="border:0">' +
              '<h1 class="proj-card-name">' + escapeHtml(p.title) + '</h1>' +
            '</div>' +
            pillsFor(p) +
          '</header>' +
          (p.lede ? '<p class="proj-card-lede">' + escapeHtml(p.lede) + '</p>' : '') +
          (p.etymology ?
            '<p class="proj-etym"><span class="caps mono">etym.</span> ' + escapeHtml(p.etymology.word) +
            (p.etymology.gloss ? ' — ' + escapeHtml(p.etymology.gloss) : '') + '</p>'
            : '') +
          (p.links && p.links.length ?
            '<div class="proj-card-meta">' + p.links.map(function(l) {
              return '<a href="' + escapeHtml(l.href) + '">' + escapeHtml(l.label) + '</a>';
            }).join('<span aria-hidden="true">·</span>') + '</div>'
            : '');

        mainEl.innerHTML =
          '<p class="back-link"><a href="#/projects">← All projects</a></p>' +
          '<article class="proj-card" style="border-top:0;padding-top:0">' +
            headerHtml +
            '<div class="post-body">' + DOMPurify.sanitize(renderMarkdown(bodyMd)) + '</div>' +
          '</article>';

        setLazyImages(mainEl);
        markExternalLinks(mainEl);
        processMermaidBlocks(mainEl);
        if (window.hljs) hljs.highlightAll();
        addCodeCopyButtons();
        hideGiscus();
        updateActiveNav('project');
        window.scrollTo(0, 0);
      })
      .catch(function() { showError('Failed to load project.'); });
  }

  // ─────────────────────────────────────────────────────────────
  // Route dispatch
  // ─────────────────────────────────────────────────────────────
  function dispatch() {
    if (legacyRedirect()) return; // browser will fire hashchange after the replace
    var route = parseHash();
    switch (route.name) {
      case 'home':     return renderHome();
      case 'blog':     return renderBlog();
      case 'post':     return route.slug ? renderPost(route.slug) : renderBlog();
      case 'projects': return renderProjects();
      case 'project':  return route.slug ? renderProject(route.slug) : renderProjects();
      default:         return renderHome();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Bootstrap
  // ─────────────────────────────────────────────────────────────
  function insertPreconnects() {
    var head = document.head;
    [
      { href: 'https://cdn.jsdelivr.net', crossorigin: 'anonymous' },
      { href: 'https://fonts.googleapis.com', crossorigin: 'anonymous' },
      { href: 'https://fonts.gstatic.com', crossorigin: 'anonymous' }
    ].forEach(function(cfg) {
      if (head.querySelector('link[rel="preconnect"][href="' + cfg.href + '"]')) return;
      var link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = cfg.href;
      if (cfg.crossorigin) link.crossOrigin = cfg.crossorigin;
      head.appendChild(link);
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    insertPreconnects();

    // Configure marked to bump headings by 1 (## → ### in body, mirroring legacy behaviour
    // for the `## YYYY.MM.DD` blog entry headings)
    if (window.marked && marked.use) {
      marked.use({
        walkTokens: function(token) {
          if (token.type === 'heading') {
            token.depth = Math.min(token.depth + 1, 6);
          }
        }
      });
    }

    initNowStrip();
    markExternalLinks(document); // static chrome (footer, now-strip)
    dispatch();
    window.addEventListener('hashchange', dispatch);
  });

  // ─────────────────────────────────────────────────────────────
  // Now-strip (top status bar): NOW location + weather + last-entry age,
  // READING title, BUILDING project link. Pulls from meta.json
  // and posts.json. Silently no-ops if either is missing.
  // ─────────────────────────────────────────────────────────────
  function daysAgo(iso) {
    var then = new Date(iso + 'T00:00:00');
    if (isNaN(then.getTime())) return null;
    var ms = Date.now() - then.getTime();
    var d = Math.floor(ms / 86400000);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    return d + 'd ago';
  }

  // WMO weather code → short label. Reference:
  // https://open-meteo.com/en/docs (search "WMO Weather interpretation codes")
  var WMO_LABELS = {
    0: 'clear', 1: 'clear', 2: 'partly cloudy', 3: 'overcast',
    45: 'fog', 48: 'fog',
    51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
    56: 'freezing drizzle', 57: 'freezing drizzle',
    61: 'rain', 63: 'rain', 65: 'rain',
    66: 'freezing rain', 67: 'freezing rain',
    71: 'snow', 73: 'snow', 75: 'snow', 77: 'snow',
    80: 'showers', 81: 'showers', 82: 'showers',
    85: 'snow showers', 86: 'snow showers',
    95: 'thunder', 96: 'thunder', 99: 'thunder'
  };

  function fetchWeather(coords, tz) {
    if (!coords || coords.length !== 2) return Promise.resolve(null);
    var CACHE_KEY = 'pk-weather-cache';
    var TTL_MS = 30 * 60 * 1000; // 30 min — Open-Meteo updates hourly anyway
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        var hit = JSON.parse(raw);
        var fresh = hit && (Date.now() - hit.t) < TTL_MS;
        var sameLoc = hit && hit.lat === coords[0] && hit.lon === coords[1];
        if (fresh && sameLoc) return Promise.resolve(hit.v);
      }
    } catch (e) {}
    var url = 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + encodeURIComponent(coords[0]) +
      '&longitude=' + encodeURIComponent(coords[1]) +
      '&current=temperature_2m,weather_code' +
      '&temperature_unit=fahrenheit' +
      (tz ? '&timezone=' + encodeURIComponent(tz) : '');
    return fetch(url, { cache: 'default' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(j) {
        if (!j || !j.current) return null;
        var v = {
          temp: Math.round(j.current.temperature_2m),
          code: j.current.weather_code,
          label: WMO_LABELS[j.current.weather_code] || ''
        };
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({
            t: Date.now(), lat: coords[0], lon: coords[1], v: v
          }));
        } catch (e) {}
        return v;
      })
      .catch(function() { return null; });
  }

  function initNowStrip() {
    var nowEl = document.getElementById('now-val-now');
    var readingEl = document.getElementById('now-val-reading');
    var gamingEl = document.getElementById('now-val-gaming');
    var buildingEl = document.getElementById('now-val-building');
    if (!nowEl && !readingEl && !gamingEl && !buildingEl) return;

    Promise.all([
      fetchJson('./meta.json').catch(function(){ return {}; }),
      fetchPosts().catch(function(){ return []; }),
      fetchJson('./reading.json').catch(function(){ return null; })
    ]).then(function(arr) {
      var meta = arr[0] || {};
      var posts = arr[1] || [];
      var reading = arr[2];
      var now = meta.now || {};

      if (readingEl) {
        // Prefer dynamic reading.json (synced from Goodreads by GH Action),
        // fall back to static meta.json#now.reading.
        var title = (reading && reading.title) || now.reading || '';
        var url = reading && reading.url;
        if (title) {
          readingEl.innerHTML = '';
          var em = document.createElement('em');
          em.textContent = title;
          if (url) {
            var aLink = document.createElement('a');
            aLink.href = url;
            aLink.target = '_blank';
            aLink.rel = 'noopener noreferrer';
            aLink.appendChild(em);
            readingEl.appendChild(aLink);
          } else {
            readingEl.appendChild(em);
          }
        }
      }
      if (gamingEl && now.gaming && now.gaming.label) {
        var ag = document.createElement('a');
        var ghref = now.gaming.href || '#';
        ag.href = ghref;
        if (ghref.charAt(0) !== '#') {
          ag.target = '_blank';
          ag.rel = 'noopener noreferrer';
        }
        ag.textContent = now.gaming.label;
        gamingEl.innerHTML = '';
        gamingEl.appendChild(ag);
      }
      if (buildingEl && now.building && now.building.label) {
        var a = document.createElement('a');
        a.href = now.building.href || '#';
        a.textContent = now.building.label;
        buildingEl.innerHTML = '';
        buildingEl.appendChild(a);
      }

      if (!nowEl) return;
      var loc = now.location || '';
      var age = posts.length ? daysAgo(posts[0].date) : null;

      function paint(weather) {
        var bits = [];
        if (loc) bits.push(loc);
        if (weather && typeof weather.temp === 'number') {
          bits.push(weather.temp + '°F' + (weather.label ? ' ' + weather.label : ''));
        }
        if (age) bits.push('last entry ' + age);
        nowEl.textContent = bits.join(' · ');
      }

      // Paint immediately with whatever we have, then upgrade when weather lands.
      paint(null);
      fetchWeather(now.coords, now.timezone).then(paint);
    });
  }

})();
