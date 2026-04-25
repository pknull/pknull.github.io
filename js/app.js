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

  // Extract a single entry from blog markdown by ISO date
  function extractEntry(md, isoDate) {
    var parts = isoDate.split('-');
    var displayDate = parts[0] + '.' + parts[1] + '.' + parts[2];

    var lines = md.split('\n');
    var inEntry = false;
    var entryLines = [];
    var foundEntry = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var headingMatch = line.match(/^##\s+(\d{4}\.\d{2}\.\d{2})/);

      if (headingMatch) {
        if (inEntry) break;
        if (headingMatch[1] === displayDate) {
          inEntry = true;
          foundEntry = true;
          entryLines.push(line);
        }
      } else if (inEntry) {
        entryLines.push(line);
      }
    }

    if (!foundEntry) return null;
    return entryLines.join('\n').trim();
  }

  // Parse all entries: [{ isoDate, displayDate, body, blurb }]
  function parseBlogEntries(md) {
    var lines = md.split('\n');
    var entries = [];
    var current = null;
    var inComment = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // Track HTML comments to skip <!-- … --> content
      if (!inComment && line.indexOf('<!--') !== -1) inComment = true;
      if (inComment) {
        if (line.indexOf('-->') !== -1) inComment = false;
        continue;
      }

      var headingMatch = line.match(/^##\s+(\d{4})\.(\d{2})\.(\d{2})/);
      if (headingMatch) {
        if (current) entries.push(current);
        current = {
          isoDate: headingMatch[1] + '-' + headingMatch[2] + '-' + headingMatch[3],
          displayDate: headingMatch[1] + '.' + headingMatch[2] + '.' + headingMatch[3],
          bodyLines: []
        };
      } else if (current) {
        current.bodyLines.push(line);
      }
    }
    if (current) entries.push(current);

    entries.forEach(function(e) {
      e.body = e.bodyLines.join('\n').trim();
      // Blurb: first non-empty, non-image, non-link-only paragraph, plain text up to ~180 chars
      var blurb = '';
      var paragraphs = e.body.split(/\n\s*\n/);
      for (var p = 0; p < paragraphs.length; p++) {
        var para = paragraphs[p].trim();
        if (!para) continue;
        if (para.charAt(0) === '!' || para.charAt(0) === '#') continue;
        // Strip markdown link/emphasis syntax for the blurb only
        blurb = para
          .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
          .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
          .replace(/[*_`]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (blurb.length > 200) blurb = blurb.slice(0, 197).replace(/\s+\S*$/, '') + '…';
        break;
      }
      e.blurb = blurb;
      delete e.bodyLines;
    });

    return entries;
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
  var giscusPlaceholder = document.getElementById('giscus-placeholder');
  var loadCommentsBtn = document.getElementById('load-comments-btn');
  var giscusLoaded = false;
  var lastGiscusTerm = null;
  var pendingGiscusTerm = null;

  function getGiscusTheme() {
    return isDarkResolved() ? 'dark' : 'light';
  }

  function hasCommentsConsent() {
    return localStorage.getItem('comments_consent') === 'granted';
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
    giscusPlaceholder.hidden = true;
    giscusLoaded = true;
    lastGiscusTerm = term;
  }

  function loadGiscus(term, options) {
    options = options || {};
    var forceReload = !!options.forceReload;
    var autoLoad = !!options.autoLoad;

    if (!term) term = 'blog';
    pendingGiscusTerm = term;

    if (giscusLoaded && lastGiscusTerm === term && !forceReload) {
      giscusContainer.hidden = false;
      return;
    }

    if (!hasCommentsConsent()) {
      giscusContainer.hidden = false;
      giscusPlaceholder.hidden = false;
      return;
    }

    if (autoLoad) {
      actuallyLoadGiscus(term);
      return;
    }

    giscusContainer.hidden = false;
    if (!giscusLoaded || lastGiscusTerm !== term) {
      giscusPlaceholder.hidden = false;
    }
  }

  loadCommentsBtn.onclick = function() {
    localStorage.setItem('comments_consent', 'granted');
    if (pendingGiscusTerm) actuallyLoadGiscus(pendingGiscusTerm);
  };

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
  //   #/                         → home
  //   #/blog                     → blog list
  //   #/post/<isoDate>           → single post
  //   #/projects                 → projects index
  //   #/projects/<slug>          → single project
  //   #/meta                     → meta page
  //
  // Backward compat redirects (legacy hashes):
  //   #blog                      → #/blog
  //   #blog:<isoDate>            → #/post/<isoDate>
  //   #meta                      → #/meta
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
    else if (key === 'meta')   newHash = '#/meta';
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
    if (head === 'meta')     return { name: 'meta' };
    return { name: 'home' };
  }

  function updateActiveNav(routeName) {
    var navMap = { home: 'home', blog: 'blog', post: 'blog', projects: 'projects', project: 'projects', meta: 'meta' };
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

  function pillFor(status) {
    var cls = status === 'active' ? 'pill-active'
      : status === 'writing' ? 'pill-writing'
      : 'pill-archive';
    return '<span class="proj-pill ' + cls + '">' + escapeHtml(status || 'archive') + '</span>';
  }

  function renderHome() {
    setMainKind('home');
    Promise.all([fetchText('./blog.md'), fetchJson('./projects.json').catch(function(){ return []; })])
      .then(function(arr) {
        var entries = parseBlogEntries(arr[0]);
        var projects = arr[1];
        var recent = entries.slice(0, 5);

        var postsHtml = recent.length
          ? '<ol class="post-list tight">' + recent.map(function(e) {
              return '<li><a href="' + postLink(e.isoDate) + '">' +
                '<span class="pl-date">' + escapeHtml(e.displayDate) + '</span>' +
                '<span class="pl-title">' + escapeHtml(e.blurb || '(entry)') + '</span>' +
                '<span class="pl-tag" aria-hidden="true">→</span>' +
              '</a></li>';
            }).join('') + '</ol>'
          : '<p class="empty">No posts yet.</p>';

        var projectsHtml = projects.length
          ? '<ul class="proj-list">' + projects.map(function(p) {
              return '<li class="proj-row"><a class="proj-row-a" href="' + projectLink(p.slug) + '">' +
                '<div class="proj-name"><span>' + escapeHtml(p.title) + '</span>' + pillFor(p.status) + '</div>' +
                (p.lede ? '<p class="proj-blurb">' + escapeHtml(p.lede) + '</p>' : '') +
              '</a></li>';
            }).join('') + '</ul>'
          : '<p class="empty">No projects yet.</p>';

        mainEl.innerHTML =
          '<section class="hero">' +
            '<p class="hero-kicker dim">notebook · year 01</p>' +
            '<h1 class="hero-title">Field notes from the long edge of the network.</h1>' +
            '<p class="hero-lede">Daily fragments, occasional essays, and the projects that grow out of them. Operated by hand, archived in plaintext, comments via GitHub.</p>' +
            '<div class="hero-meta">' +
              '<span class="caps">PK · Eugene, OR</span>' +
              '<span aria-hidden="true">·</span>' +
              '<a href="' + postLink(recent[0] ? recent[0].isoDate : '') + '" class="caps">Latest entry →</a>' +
            '</div>' +
          '</section>' +
          '<div class="home-split">' +
            '<section>' +
              '<div class="col-hd"><h2>Recent</h2><a href="#/blog">All posts →</a></div>' +
              postsHtml +
            '</section>' +
            '<section>' +
              '<div class="col-hd"><h2>Projects</h2><a href="#/projects">All →</a></div>' +
              projectsHtml +
            '</section>' +
          '</div>';
        hideGiscus();
        updateActiveNav('home');
        setLazyImages(mainEl);
      })
      .catch(function(err) {
        showError(err.message === 'not-found' ? 'Page not found.' : 'Failed to load home.');
      });
  }

  function renderBlog() {
    setMainKind('blog');
    fetchText('./blog.md')
      .then(function(md) {
        var entries = parseBlogEntries(md);

        // Group by month (YYYY.MM)
        var groups = {};
        var order = [];
        entries.forEach(function(e) {
          var month = e.displayDate.slice(0, 7); // YYYY.MM
          if (!groups[month]) {
            groups[month] = [];
            order.push(month);
          }
          groups[month].push(e);
        });

        var groupHtml = order.map(function(month) {
          var items = groups[month].map(function(e) {
            return '<li><a href="' + postLink(e.isoDate) + '">' +
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
            '<p class="page-lede">Daily entries, oldest at the bottom. ' + entries.length + ' total.</p>' +
          '</header>' +
          (entries.length ? groupHtml : '<p class="empty">No entries yet.</p>');

        hideGiscus();
        updateActiveNav('blog');
        setLazyImages(mainEl);
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

    fetchText('./blog.md')
      .then(function(md) {
        var entryMd = extractEntry(md, slug);
        if (!entryMd) {
          showError('Entry not found.');
          hideGiscus();
          return;
        }

        // Strip the `## YYYY.MM.DD` heading from the body (we'll show it in the post header instead)
        var bodyMd = entryMd.replace(/^##\s+\d{4}\.\d{2}\.\d{2}\s*\n?/, '');
        var displayDate = slug.replace(/-/g, '.');

        // Find prev/next slugs for nav
        var entries = parseBlogEntries(md);
        var idx = -1;
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isoDate === slug) { idx = i; break; }
        }
        var prev = idx > 0 ? entries[idx - 1] : null;       // entries are ordered newest→oldest, so idx-1 = newer
        var next = idx >= 0 && idx < entries.length - 1 ? entries[idx + 1] : null;

        var navHtml = '';
        if (prev || next) {
          navHtml = '<nav class="post-nav">' +
            (next ? '<a href="' + postLink(next.isoDate) + '">← ' + escapeHtml(next.displayDate) + '</a>' : '<span></span>') +
            (prev ? '<a href="' + postLink(prev.isoDate) + '">' + escapeHtml(prev.displayDate) + ' →</a>' : '<span></span>') +
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
    processMermaidBlocks(mainEl);
    if (window.hljs) hljs.highlightAll();
    addCodeCopyButtons();
    updateActiveNav('post');

    var shouldAutoLoad = window._autoLoadComments || false;
    window._autoLoadComments = false;
    loadGiscus(term, { autoLoad: shouldAutoLoad });

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
              pillFor(p.status) +
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

        // Strip the project's H1 + opening matter (lede + etymology paragraph) up to the first
        // `---` horizontal rule, since lede + etymology are already rendered in the project header.
        // Both asha.md and thallus.md follow this convention.
        var bodyMd = md.replace(/^#\s+[^\n]+\n+/, '');
        var hrIdx = bodyMd.search(/^---\s*$/m);
        if (hrIdx >= 0) {
          bodyMd = bodyMd.slice(hrIdx).replace(/^---\s*\n+/, '');
        }

        var headerHtml =
          '<header class="proj-card-hd">' +
            '<div class="proj-card-name-link" style="border:0">' +
              '<h1 class="proj-card-name">' + escapeHtml(p.title) + '</h1>' +
            '</div>' +
            pillFor(p.status) +
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
        processMermaidBlocks(mainEl);
        if (window.hljs) hljs.highlightAll();
        addCodeCopyButtons();
        hideGiscus();
        updateActiveNav('project');
        window.scrollTo(0, 0);
      })
      .catch(function() { showError('Failed to load project.'); });
  }

  function renderMeta() {
    setMainKind('post');
    fetchText('./meta.md')
      .then(function(md) {
        mainEl.innerHTML =
          '<p class="back-link"><a href="#/">← home</a></p>' +
          '<article class="post">' +
            '<div class="post-body">' + DOMPurify.sanitize(renderMarkdown(md)) + '</div>' +
          '</article>';
        setLazyImages(mainEl);
        processMermaidBlocks(mainEl);
        if (window.hljs) hljs.highlightAll();
        addCodeCopyButtons();
        hideGiscus();
        updateActiveNav('meta');
        window.scrollTo(0, 0);
      })
      .catch(function() { showError('Failed to load meta.'); });
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
      case 'meta':     return renderMeta();
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

    dispatch();
    window.addEventListener('hashchange', dispatch);
  });

})();
