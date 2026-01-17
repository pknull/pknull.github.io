(function() {
  'use strict';

  var _0x1976 = 'CuVr.j00r.7337h.1.Lu8.jøø.!!!1one';

  // Toast notification system
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

  // Theme toggle with localStorage persistence (light -> dark -> minimal)
  var linkstyle = document.getElementById('linkstyle');
  var hljsTheme = document.getElementById('hljs-theme');
  var themeToggle = document.getElementById('theme-toggle');
  // Daily cache-buster to avoid manual bumps; override via meta[name="build-id"] if present
  var CACHE_VERSION = (document.querySelector('meta[name="build-id"]') || {}).content || new Date().toISOString().slice(0, 10);
  var HLJS_THEMES = {
    dark: {
      href: 'css/hljs-dark.css',
      integrity: ''
    },
    light: {
      href: 'css/hljs-light.css',
      integrity: ''
    }
  };
  var THEME_CONFIG = {
    comp: { css: null, isDark: 'auto', label: 'COMP' },
    dark: { css: 'css/dark.css', isDark: true, label: 'GRUV' },
    minimal: { css: 'css/minimal.css', isDark: false, label: 'MODE' },
    mcmo: { css: 'css/mcmo.css', isDark: false, label: 'MCMO' },
    sakr: { css: 'css/sakr.css', isDark: false, label: 'SAKR' },
    jmmy: { css: 'css/jmmy.css', isDark: false, label: 'JMMY' },
    blad: { css: 'css/blad.css', isDark: true, label: 'BLAD' },
    void: { css: 'css/void.css', isDark: true, label: 'VOID' },
    term: { css: 'css/term.css', isDark: true, label: 'TERM' },
    garm: { css: 'css/garm.css', isDark: false, label: 'GARM' },
    mate: { css: 'css/mate.css', isDark: false, label: 'MATE' },
    neon: { css: 'css/gemini.css', isDark: true, label: 'NEON' },
    byte: { css: 'css/codex.css', isDark: true, label: 'BYTE' },
    vllm: { css: 'css/claude.css', isDark: false, label: 'VLLM' },
    asha: { css: 'css/asha.css', isDark: false, label: 'ASHA' },
    diry: { css: 'css/diry.css', isDark: false, label: 'DIRY' },
    base: { css: null, isDark: false, label: 'BASE' }
  };
  var themes = Object.keys(THEME_CONFIG);
  var preconnectInserted = false;
  var loadedThemes = {}; // Track loaded theme stylesheets

  function insertPreconnects() {
    if (preconnectInserted) return;
    preconnectInserted = true;
    var head = document.head;
    [
      { href: 'https://cdn.jsdelivr.net', crossorigin: 'anonymous' },
      { href: 'https://fonts.googleapis.com', crossorigin: 'anonymous' },
      { href: 'https://fonts.gstatic.com', crossorigin: 'anonymous' }
    ].forEach(function(cfg) {
      var link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = cfg.href;
      if (cfg.crossorigin) link.crossOrigin = cfg.crossorigin;
      head.appendChild(link);
    });
  }

  // Check localStorage, else default to COMP (auto light/dark)
  var currentTheme = localStorage.getItem('theme');
  if (!currentTheme) {
    currentTheme = 'comp';
  }
  if (themes.indexOf(currentTheme) === -1) currentTheme = 'comp';

  function setHighlightTheme(isDark) {
    var theme = isDark ? HLJS_THEMES.dark : HLJS_THEMES.light;
    if (!theme) {
      hljsTheme.disabled = true;
      return;
    }
    hljsTheme.disabled = false;
    hljsTheme.href = theme.href;
    if (theme.integrity) {
      hljsTheme.integrity = theme.integrity;
      hljsTheme.crossOrigin = 'anonymous';
    } else {
      hljsTheme.removeAttribute('integrity');
      hljsTheme.removeAttribute('crossorigin');
    }
  }

  // Lazy-load theme CSS on demand
  function loadThemeCSS(themeName, cssPath, callback) {
    if (loadedThemes[themeName]) {
      if (callback) callback();
      return;
    }

    var link = document.createElement('link');
    link.id = 'theme-css-' + themeName;
    link.rel = 'stylesheet';
    link.href = cssPath + '?v=' + CACHE_VERSION;
    link.onload = function() {
      loadedThemes[themeName] = true;
      if (callback) callback();
    };
    link.onerror = function() {
      showToast('Failed to load theme', 'error');
    };
    document.head.appendChild(link);
  }

  function applyTheme(theme) {
    var config = THEME_CONFIG[theme] || THEME_CONFIG.comp;
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolvedIsDark = config.isDark === 'auto' ? prefersDark : !!config.isDark;

    if (config.isDark === 'auto') {
      // COMP: auto-select based on OS preference
      linkstyle.href = prefersDark ? 'css/dark.css' : 'css/mate.css';
      linkstyle.disabled = false;
    } else if (config.css === null) {
      // BASE: no theme overlay, just base.css
      linkstyle.disabled = true;
    } else {
      linkstyle.href = config.css;
      linkstyle.disabled = false;
    }
    setHighlightTheme(resolvedIsDark);

    themeToggle.textContent = config.label;
  }
  applyTheme(currentTheme);

  themeToggle.onclick = function(e) {
    e.preventDefault();
    var idx = themes.indexOf(currentTheme);
    currentTheme = themes[(idx + 1) % themes.length];
    applyTheme(currentTheme);
    localStorage.setItem('theme', currentTheme);
    updateGiscusTheme();
  };

  // Consent banner
  var consentBanner = document.getElementById('consent-banner');
  var consentAccept = document.getElementById('consent-accept');
  var consentDecline = document.getElementById('consent-decline');
  var storedConsent = localStorage.getItem('analytics_consent');
  var previousActiveElement = null;

  function showConsentBanner() {
    previousActiveElement = document.activeElement;
    consentBanner.hidden = false;
    consentBanner.setAttribute('aria-hidden', 'false');
    // Focus first button
    consentAccept.focus();
  }

  function hideConsentBanner() {
    consentBanner.hidden = true;
    consentBanner.setAttribute('aria-hidden', 'true');
    // Restore focus
    if (previousActiveElement && previousActiveElement.focus) {
      previousActiveElement.focus();
    }
  }

  // Focus trap for consent banner
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
    // Escape closes with decline behavior
    if (e.key === 'Escape') {
      localStorage.setItem('analytics_consent', 'denied');
      hideConsentBanner();
    }
  });

  if (!storedConsent) {
    showConsentBanner();
  }

  consentAccept.onclick = function() {
    localStorage.setItem('analytics_consent', 'granted');
    loadGoogleAnalytics();
    hideConsentBanner();
  };

  consentDecline.onclick = function() {
    localStorage.setItem('analytics_consent', 'denied');
    hideConsentBanner();
  };

  // Page routing
  var pages = {
    blog: './blog.md',
    meta: './meta.md',
    link: './link.md',
    asha: './asha.md',
    test: './test.md'
  };

  var currentPage = 'blog';
  var pagesCache = {};

  function parseHash() {
    var hash = window.location.hash.slice(1);
    if (hash === 'main') return { page: currentPage, entry: null, skipOnly: true };
    var parts = hash.split(':');
    var page = parts[0];
    var entry = parts[1] || null;
    return { page: pages[page] ? page : 'blog', entry: entry };
  }

    var contentLoaded = false;
    var lastRoute = null;

    function setLazyImages(scope) {
      var root = scope || document;
      var imgs = root.querySelectorAll('img');
      imgs.forEach(function(img) {
        if (!img.hasAttribute('loading')) {
          img.loading = 'lazy';
        }
      });
    }

    function escapeRegExp(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Abbreviation processing (Kramdown-style *[ABBR]: Definition)
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

  // Extract a single entry from blog markdown by date
  function extractEntry(md, isoDate) {
    // Convert 2025-11-29 to 2025.11.29 for matching
    var parts = isoDate.split('-');
    var displayDate = parts[0] + '.' + parts[1] + '.' + parts[2];

    // Split by H2 headings (## becomes ### after marked walkTokens)
    // In source markdown, entries start with ## DATE
    var lines = md.split('\n');
    var inEntry = false;
    var entryLines = [];
    var foundEntry = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // Check if this is an entry heading (## followed by date pattern)
      var headingMatch = line.match(/^##\s+(\d{4}\.\d{2}\.\d{2})/);

      if (headingMatch) {
        if (inEntry) {
          // We hit the next entry, stop collecting
          break;
        }
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

  function loadPage(route) {
    if (route.skipOnly && contentLoaded) return;

    // Check if we're just switching entries on same page
    var sameBasePage = lastRoute && lastRoute.page === route.page;

    currentPage = route.page;
    lastRoute = route;
    var url = pages[route.page] || pages.blog;
    var cacheKey = url + '?v=' + CACHE_VERSION;

    function renderFromMarkdown(md) {
      var mainEl = document.getElementById('main');

      if (route.page === 'blog' && route.entry) {
        // Single entry view
        var entryMd = extractEntry(md, route.entry);
        if (entryMd) {
          // Add back link before content
          var backLink = '<p class="back-link"><a href="#blog">← All entries</a></p>\n\n';
          mainEl.innerHTML = DOMPurify.sanitize(renderMarkdown(backLink + entryMd));
          addReadTime();
          // Check if user clicked Comments link (auto-load) vs Link or direct nav
          var shouldAutoLoad = window._autoLoadComments || false;
          window._autoLoadComments = false; // Reset flag
          loadGiscus(route.entry, { autoLoad: shouldAutoLoad });
        } else {
          // Entry not found, show all
          mainEl.innerHTML = DOMPurify.sanitize(renderMarkdown(md));
          addEntryLinks();
          hideGiscus();
        }
      } else if (route.page === 'blog') {
        // Full blog view - no comments
        mainEl.innerHTML = DOMPurify.sanitize(renderMarkdown(md));
        addEntryLinks();
        addReadTime();
        hideGiscus();
      } else if (route.page === 'test') {
        // Test page - show comments for testing
        mainEl.innerHTML = DOMPurify.sanitize(renderMarkdown(md));
        loadGiscus('test');
      } else {
        // Other pages
        mainEl.innerHTML = DOMPurify.sanitize(renderMarkdown(md));
        hideGiscus();
      }

      setLazyImages(mainEl);
      contentLoaded = true;
      updateActiveNav(route.page);
      if (window.hljs) hljs.highlightAll();
      addCodeCopyButtons();

      // Scroll to top for entry views
      if (route.entry) {
        window.scrollTo(0, 0);
      }
    }

    if (pagesCache[cacheKey]) {
      renderFromMarkdown(pagesCache[cacheKey]);
      return;
    }

    fetch(cacheKey, { cache: 'no-cache' })
      .then(function(response) {
        if (!response.ok) {
          var err = new Error(response.status === 404 ? 'not-found' : 'server-error');
          err.status = response.status;
          throw err;
        }
        return response.text();
      })
      .then(function(md) {
        pagesCache[cacheKey] = md;
        renderFromMarkdown(md);
      })
      .catch(function(err) {
        var mainEl = document.getElementById('main');
        var message = 'Failed to load content.';

        if (err.message === 'not-found') {
          message = 'Page not found.';
        } else if (!navigator.onLine) {
          message = 'You appear to be offline.';
        }

        mainEl.innerHTML = '<div class="error-state" role="alert">' +
          '<p>' + message + '</p>' +
          '<p><a href="#/">Return home</a> or <a href="javascript:location.reload()">try again</a></p>' +
          '</div>';

        showToast(message, 'error');
      });
  }

  function addReadTime() {
    var mainEl = document.getElementById('main');
    var headings = Array.from(mainEl.querySelectorAll('h3'));

    headings.forEach(function(h, index) {
      var dateText = h.textContent.trim();
      // Only process date headings (YYYY.MM.DD format)
      if (!/^\d{4}\.\d{2}\.\d{2}$/.test(dateText)) return;

      // Find content between this heading and the next
      var nextHeading = headings[index + 1];
      var content = '';
      var sibling = h.nextElementSibling;

      while (sibling && sibling !== nextHeading) {
        // Skip code blocks when counting
        if (sibling.tagName !== 'PRE') {
          content += ' ' + sibling.textContent;
        }
        sibling = sibling.nextElementSibling;
      }

      // Count words (split on whitespace, filter empty)
      var words = content.trim().split(/\s+/).filter(function(w) { return w.length > 0; }).length;
      var minutes = Math.max(1, Math.ceil(words / 200));

      // Insert centered below date heading
      var readTime = document.createElement('p');
      readTime.className = 'read-time';
      readTime.textContent = minutes + ' min read';
      h.insertAdjacentElement('afterend', readTime);
    });
  }

  function addEntryLinks() {
    var mainEl = document.getElementById('main');
    var headings = Array.from(document.querySelectorAll('#main h3'));

    headings.forEach(function(h, index) {
      var dateText = h.textContent.trim();
      var parts = dateText.split('.');
      if (parts.length === 3) {
        var isoDate = parts[0] + '-' + parts[1] + '-' + parts[2];

        // Find where this entry ends (next h3 or end of main)
        var nextHeading = headings[index + 1];
        var insertBefore = nextHeading || null;

        // Create footer element
        var footer = document.createElement('p');
        footer.className = 'entry-footer';

        var linkToThis = document.createElement('a');
        linkToThis.href = '#blog:' + isoDate;
        linkToThis.textContent = 'Link';

        var separator = document.createTextNode(' · ');

        var commentsLink = document.createElement('a');
        commentsLink.href = '#blog:' + isoDate;
        commentsLink.textContent = 'Comments';
        commentsLink.addEventListener('click', function(e) {
          // Signal that we want to auto-load comments
          window._autoLoadComments = true;
          var scrollToComments = function() {
            var commentsSection = document.getElementById('giscus-container');
            if (commentsSection && !commentsSection.hidden) {
              var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
              commentsSection.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' });
            }
          };
          // If already on this entry, scroll immediately
          if (window.location.hash === '#blog:' + isoDate) {
            e.preventDefault();
            // Already on entry - load comments directly if consented
            if (typeof loadGiscus === 'function') {
              loadGiscus(isoDate, { autoLoad: true });
            }
            scrollToComments();
          } else {
            // Navigating to entry - scroll to comments after content loads
            setTimeout(scrollToComments, 100);
          }
        });

        footer.appendChild(linkToThis);
        footer.appendChild(separator);
        footer.appendChild(commentsLink);

        // Insert before next heading or at end of main
        if (insertBefore) {
          mainEl.insertBefore(footer, insertBefore);
        } else {
          mainEl.appendChild(footer);
        }
      }
    });
  }

  function scrollToEntry(isoDate) {
    // Convert 2026-01-27 to 2026.01.27
    var parts = isoDate.split('-');
    var displayDate = parts[0] + '.' + parts[1] + '.' + parts[2];
    var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var headings = document.querySelectorAll('#main h3');
    headings.forEach(function(h) {
      if (h.textContent.trim().startsWith(displayDate)) {
        h.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      }
    });
  }

  // Clipboard copy with fallback for older browsers/non-HTTPS
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
      if (success) {
        onSuccess();
      } else {
        onError();
      }
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

      // Create toolbar container
      var toolbar = document.createElement('div');
      toolbar.className = 'code-toolbar';

      // Copy button
      var copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy';
      copyBtn.textContent = 'copy';
      copyBtn.setAttribute('aria-label', 'Copy code to clipboard');
      copyBtn.onclick = function() {
        var text = code.textContent;

        copyToClipboard(text,
          function() {
            // Success
            copyBtn.textContent = 'copied';
            copyBtn.classList.add('copied');
            setTimeout(function() {
              copyBtn.textContent = 'copy';
              copyBtn.classList.remove('copied');
            }, 1500);
          },
          function() {
            // Error
            copyBtn.textContent = 'failed';
            showToast('Failed to copy to clipboard', 'error');
            setTimeout(function() {
              copyBtn.textContent = 'copy';
            }, 1500);
          }
        );
      };

      // Expand button
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

  function updateActiveNav(page) {
    document.querySelectorAll('.nav-link').forEach(function(link) {
      link.classList.remove('active');
      link.removeAttribute('aria-current');
      if (link.getAttribute('href') === '#' + page) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
    });
  }

  // Giscus comments
  var giscusContainer = document.getElementById('giscus-container');
  var giscusPlaceholder = document.getElementById('giscus-placeholder');
  var loadCommentsBtn = document.getElementById('load-comments-btn');
  var giscusLoaded = false;
  var lastGiscusTerm = null;
  var pendingGiscusTerm = null;

  function getGiscusTheme() {
    // Match Giscus theme to current site theme (dark/light)
    var config = THEME_CONFIG[currentTheme] || THEME_CONFIG.comp;
    var isDark = config.isDark;
    // Handle 'auto' (COMP theme) - check system preference
    if (isDark === 'auto') {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return isDark ? 'dark' : 'light';
  }

    function hasAnalyticsConsent() {
      return localStorage.getItem('analytics_consent') === 'granted';
    }

    function hasCommentsConsent() {
      return localStorage.getItem('comments_consent') === 'granted';
    }

    function actuallyLoadGiscus(term, forceReload) {
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
      var forceReload = options.forceReload || false;
      var autoLoad = options.autoLoad || false;

      if (!term) term = 'blog';
    pendingGiscusTerm = term;

    // Don't reload if same term unless forced
    if (giscusLoaded && lastGiscusTerm === term && !forceReload) {
      giscusContainer.hidden = false;
      return;
    }

      // Check comments consent - if no consent, show placeholder with button
      if (!hasCommentsConsent()) {
        giscusContainer.hidden = false;
        giscusPlaceholder.hidden = false;
        return;
      }

    // Has consent and autoLoad requested (e.g., clicked Comments link) - load immediately
    if (autoLoad) {
      actuallyLoadGiscus(term);
      return;
    }

    // Has consent but no autoLoad - show placeholder with load button
    giscusContainer.hidden = false;
    if (!giscusLoaded || lastGiscusTerm !== term) {
      giscusPlaceholder.hidden = false;
    }
  }

    // Load comments button handler
    loadCommentsBtn.onclick = function() {
      localStorage.setItem('comments_consent', 'granted');
      if (pendingGiscusTerm) {
        actuallyLoadGiscus(pendingGiscusTerm);
      }
    };

  function hideGiscus() {
    giscusContainer.hidden = true;
  }

  function updateGiscusTheme() {
    // Force reload with new theme if Giscus is visible and loaded
    if (giscusLoaded && !giscusContainer.hidden && lastGiscusTerm) {
      actuallyLoadGiscus(lastGiscusTerm, true);
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    insertPreconnects();
    // Configure marked to increment heading levels by 1
    marked.use({
      walkTokens: function(token) {
        if (token.type === 'heading') {
          token.depth = Math.min(token.depth + 1, 6);
        }
      }
    });

    loadPage(parseHash());

    window.addEventListener('hashchange', function() {
      loadPage(parseHash());
    });
  });

})();
