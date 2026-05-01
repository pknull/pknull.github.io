(function() {
  'use strict';

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
      setTimeout(function() {
        toast.remove();
      }, 300);
    }, 3000);
  }

  var MODES = ['auto', 'light', 'dark'];
  var modeToggleBtn = document.getElementById('mode-toggle');
  var hljsTheme = document.getElementById('hljs-theme');
  var prefersDarkMq = window.matchMedia('(prefers-color-scheme: dark)');
  var currentMode = getStoredMode();
  var CACHE_VERSION = (document.querySelector('meta[name="build-id"]') || {}).content || 'dev';
  var HLJS_THEMES = {
    dark: { href: '/css/hljs-dark.css' },
    light: { href: '/css/hljs-light.css' }
  };
  var giscusContainer = document.getElementById('giscus-container');
  var giscusLoaded = false;
  var mermaidLoaded = false;

  function getStoredMode() {
    var value = localStorage.getItem('pk-mode');
    return MODES.indexOf(value) >= 0 ? value : 'auto';
  }

  function resolveMode(mode) {
    if (mode === 'auto') return prefersDarkMq.matches ? 'dark' : 'light';
    return mode;
  }

  function isDarkResolved() {
    return document.documentElement.getAttribute('data-mode') === 'dark';
  }

  function getGiscusTheme() {
    return isDarkResolved() ? 'gruvbox_dark' : 'gruvbox_light';
  }

  function setHighlightTheme(isDark) {
    if (!hljsTheme) return;
    hljsTheme.disabled = false;
    hljsTheme.href = (isDark ? HLJS_THEMES.dark.href : HLJS_THEMES.light.href) + '?v=' + CACHE_VERSION;
  }

  function updateMermaidTheme(isDark) {
    if (!mermaidLoaded || !window.mermaid) return;
    mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default' });
    var diagrams = document.querySelectorAll('.mermaid');
    if (!diagrams.length) return;
    diagrams.forEach(function(el) {
      var src = el.getAttribute('data-mermaid-source');
      if (!src) return;
      var fresh = document.createElement('div');
      fresh.className = 'mermaid';
      fresh.setAttribute('data-mermaid-source', src);
      fresh.textContent = src;
      el.replaceWith(fresh);
    });
    mermaid.run({ nodes: document.querySelectorAll('.mermaid') });
  }

  function updateGiscusTheme() {
    if (!giscusLoaded || !giscusContainer || giscusContainer.hidden) return;
    var frame = giscusContainer.querySelector('iframe.giscus-frame');
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage({
      giscus: {
        setConfig: {
          theme: getGiscusTheme()
        }
      }
    }, '*');
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

  applyMode(currentMode);

  if (modeToggleBtn) {
    modeToggleBtn.addEventListener('click', function() {
      var idx = MODES.indexOf(currentMode);
      currentMode = MODES[(idx + 1) % MODES.length];
      localStorage.setItem('pk-mode', currentMode);
      applyMode(currentMode);
    });
  }

  if (prefersDarkMq.addEventListener) {
    prefersDarkMq.addEventListener('change', function() {
      if (currentMode === 'auto') applyMode('auto');
    });
  } else if (prefersDarkMq.addListener) {
    prefersDarkMq.addListener(function() {
      if (currentMode === 'auto') applyMode('auto');
    });
  }

  var consentBanner = document.getElementById('consent-banner');
  var consentAccept = document.getElementById('consent-accept');
  var consentDecline = document.getElementById('consent-decline');
  var previousActiveElement = null;

  function showConsentBanner() {
    if (!consentBanner || !consentAccept) return;
    previousActiveElement = document.activeElement;
    consentBanner.hidden = false;
    consentBanner.setAttribute('aria-hidden', 'false');
    consentAccept.focus();
  }

  function hideConsentBanner() {
    if (!consentBanner) return;
    consentBanner.hidden = true;
    consentBanner.setAttribute('aria-hidden', 'true');
    if (previousActiveElement && previousActiveElement.focus) {
      previousActiveElement.focus();
    }
  }

  if (consentBanner && consentAccept && consentDecline) {
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

    if (!localStorage.getItem('analytics_consent')) showConsentBanner();

    consentAccept.onclick = function() {
      localStorage.setItem('analytics_consent', 'granted');
      if (typeof loadGoogleAnalytics === 'function') loadGoogleAnalytics();
      hideConsentBanner();
    };

    consentDecline.onclick = function() {
      localStorage.setItem('analytics_consent', 'denied');
      hideConsentBanner();
    };
  }

  function copyToClipboard(text, onSuccess, onError) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(function() {
        fallbackCopy(text, onSuccess, onError);
      });
      return;
    }
    fallbackCopy(text, onSuccess, onError);
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

  function addCodeCopyButtons(scope) {
    var root = scope || document;
    root.querySelectorAll('pre > code').forEach(function(code) {
      var pre = code.parentElement;
      if (pre.querySelector('.code-toolbar')) return;

      var toolbar = document.createElement('div');
      toolbar.className = 'code-toolbar';

      var copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy';
      copyBtn.textContent = 'copy';
      copyBtn.setAttribute('aria-label', 'Copy code to clipboard');
      copyBtn.onclick = function() {
        copyToClipboard(
          code.textContent,
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
            setTimeout(function() {
              copyBtn.textContent = 'copy';
            }, 1500);
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
    root.querySelectorAll('img').forEach(function(img) {
      if (!img.hasAttribute('loading')) img.loading = 'lazy';
    });
  }

  function markExternalLinks(scope) {
    var root = scope || document;
    var here = window.location.hostname;
    root.querySelectorAll('a[href]').forEach(function(a) {
      var href = a.getAttribute('href');
      if (!href) return;
      if (a.hasAttribute('target')) return;
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
      if (!external) return;
      a.target = '_blank';
      var rel = (a.getAttribute('rel') || '').split(/\s+/).filter(Boolean);
      if (rel.indexOf('noopener') === -1) rel.push('noopener');
      if (rel.indexOf('noreferrer') === -1) rel.push('noreferrer');
      a.setAttribute('rel', rel.join(' '));
    });
  }

  function loadMermaid(callback) {
    if (mermaidLoaded) {
      callback();
      return;
    }
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
    script.onload = function() {
      mermaidLoaded = true;
      mermaid.initialize({ startOnLoad: false, theme: isDarkResolved() ? 'dark' : 'default' });
      callback();
    };
    document.head.appendChild(script);
  }

  function processMermaidBlocks(scope) {
    var root = scope || document;
    var blocks = root.querySelectorAll('code.language-mermaid');
    if (!blocks.length) return;
    blocks.forEach(function(block) {
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

  function loadGiscus(term) {
    if (!giscusContainer || !term) return;
    giscusContainer.hidden = false;
    var mount = giscusContainer.querySelector('.giscus');
    if (!mount || mount.querySelector('iframe.giscus-frame')) return;

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
    mount.appendChild(script);
    giscusLoaded = true;
  }

  var fetchCache = {};

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

  function daysAgo(iso) {
    var then = new Date(iso + 'T00:00:00');
    if (isNaN(then.getTime())) return null;
    var ms = Date.now() - then.getTime();
    var days = Math.floor(ms / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return days + 'd ago';
  }

  function pathFromHash(hashValue) {
    if (!hashValue || hashValue === '#' || hashValue === '#/') return '/';
    if (hashValue.indexOf('#/') === 0) {
      var raw = hashValue.slice(2).replace(/^\/+|\/+$/g, '');
      if (!raw) return '/';
      if (raw === 'blog') return '/blog/';
      if (raw === 'projects') return '/projects/';
      if (raw.indexOf('post/') === 0) return '/post/' + raw.slice(5).replace(/\/+$/g, '') + '/';
      if (raw.indexOf('projects/') === 0) return '/projects/' + raw.slice(9).replace(/\/+$/g, '') + '/';
      return null;
    }
    var rawLegacy = hashValue.replace(/^#/, '');
    if (!rawLegacy || rawLegacy === 'main') return null;
    if (rawLegacy === 'blog') return '/blog/';
    if (rawLegacy.indexOf('blog:') === 0) return '/post/' + rawLegacy.slice(5).replace(/\/+$/g, '') + '/';
    if (rawLegacy === 'meta') return '/';
    if (rawLegacy === 'asha') return '/projects/asha/';
    if (rawLegacy === 'thallus') return '/projects/thallus/';
    return null;
  }

  function normalizeInternalHref(href) {
    if (!href) return href;
    if (href.charAt(0) === '#') return pathFromHash(href) || href;
    return href;
  }

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
    var cacheKey = 'pk-weather-cache';
    var ttl = 30 * 60 * 1000;
    try {
      var raw = localStorage.getItem(cacheKey);
      if (raw) {
        var cached = JSON.parse(raw);
        var fresh = cached && (Date.now() - cached.t) < ttl;
        var sameLoc = cached && cached.lat === coords[0] && cached.lon === coords[1];
        if (fresh && sameLoc) return Promise.resolve(cached.v);
      }
    } catch (e) {}

    var url = 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + encodeURIComponent(coords[0]) +
      '&longitude=' + encodeURIComponent(coords[1]) +
      '&current=temperature_2m,weather_code' +
      '&temperature_unit=fahrenheit' +
      (tz ? '&timezone=' + encodeURIComponent(tz) : '');

    return fetch(url, { cache: 'default' })
      .then(function(response) { return response.ok ? response.json() : null; })
      .then(function(data) {
        if (!data || !data.current) return null;
        var value = {
          temp: Math.round(data.current.temperature_2m),
          code: data.current.weather_code,
          label: WMO_LABELS[data.current.weather_code] || ''
        };
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            t: Date.now(),
            lat: coords[0],
            lon: coords[1],
            v: value
          }));
        } catch (e) {}
        return value;
      })
      .catch(function() {
        return null;
      });
  }

  function initNowStrip() {
    var nowEl = document.getElementById('now-val-now');
    var readingEl = document.getElementById('now-val-reading');
    var gamingEl = document.getElementById('now-val-gaming');
    var buildingEl = document.getElementById('now-val-building');
    if (!nowEl && !readingEl && !gamingEl && !buildingEl) return;

    Promise.all([
      fetchJson('/meta.json').catch(function() { return {}; }),
      fetchJson('/posts.json').catch(function() { return []; }),
      fetchJson('/reading.json').catch(function() { return null; }),
      fetchJson('/gaming.json').catch(function() { return null; }),
      fetchJson('/coding.json').catch(function() { return null; })
    ]).then(function(arr) {
      var meta = arr[0] || {};
      var posts = arr[1] || [];
      var reading = arr[2];
      var gaming = arr[3];
      var coding = arr[4];
      var now = meta.now || {};

      if (readingEl) {
        var title = (reading && reading.title) || now.reading || '';
        var url = reading && reading.url;
        if (title) {
          readingEl.innerHTML = '';
          var em = document.createElement('em');
          em.textContent = title;
          if (url) {
            var link = document.createElement('a');
            link.href = normalizeInternalHref(url);
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.appendChild(em);
            readingEl.appendChild(link);
          } else {
            readingEl.appendChild(em);
          }
        }
      }

      if (gamingEl) {
        var gamingLabel = (gaming && gaming.label) || (now.gaming && now.gaming.label) || '';
        var gamingRawHref = (gaming && gaming.href) || (now.gaming && now.gaming.href) || '';
        if (gamingLabel) {
          var gamingLink = document.createElement('a');
          var gamingHref = normalizeInternalHref(gamingRawHref || '#');
          gamingLink.href = gamingHref;
          if (/^https?:\/\//i.test(gamingHref)) {
            gamingLink.target = '_blank';
            gamingLink.rel = 'noopener noreferrer';
          }
          gamingLink.textContent = gamingLabel;
          gamingEl.innerHTML = '';
          gamingEl.appendChild(gamingLink);
        }
      }

      if (buildingEl) {
        var buildingLabel = (coding && coding.label) || (now.building && now.building.label) || '';
        var buildingRawHref = (coding && coding.href) || (now.building && now.building.href) || '';
        if (buildingLabel) {
          var buildingLink = document.createElement('a');
          var buildingHref = normalizeInternalHref(buildingRawHref || '#');
          buildingLink.href = buildingHref;
          if (/^https?:\/\//i.test(buildingHref)) {
            buildingLink.target = '_blank';
            buildingLink.rel = 'noopener noreferrer';
          }
          buildingLink.textContent = buildingLabel;
          buildingEl.innerHTML = '';
          buildingEl.appendChild(buildingLink);
        }
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

      paint(null);
      fetchWeather(now.coords, now.timezone).then(paint);
    });
  }

  document.addEventListener('DOMContentLoaded', function() {
    var mainEl = document.getElementById('main');

    setLazyImages(document);
    markExternalLinks(document);
    processMermaidBlocks(mainEl || document);
    if (window.hljs) hljs.highlightAll();
    addCodeCopyButtons(mainEl || document);
    initNowStrip();

    if (giscusContainer) {
      loadGiscus(giscusContainer.getAttribute('data-term'));
    }
  });
})();
