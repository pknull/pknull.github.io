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
  var giscusLoadBtn = document.getElementById('giscus-load');
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
        return;
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
    if (giscusLoadBtn) {
      giscusLoadBtn.disabled = true;
      giscusLoadBtn.textContent = 'Loading comments…';
    }

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
    script.onload = function() {
      if (giscusLoadBtn) giscusLoadBtn.remove();
    };
    script.onerror = function() {
      if (giscusLoadBtn) {
        giscusLoadBtn.disabled = false;
        giscusLoadBtn.textContent = 'Load comments';
      }
      showToast('Failed to load comments', 'error');
    };
    mount.appendChild(script);
    giscusLoaded = true;
  }

  var fetchCache = {};

  function jsonSessionKey(url) { return 'pk-json:' + url + '?v=' + CACHE_VERSION; }

  function readJsonSession(url) {
    try {
      var raw = sessionStorage.getItem(jsonSessionKey(url));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
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
        try { sessionStorage.setItem(jsonSessionKey(url), JSON.stringify(data)); } catch (e) {}
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

  var WEATHER_CACHE_KEY = 'pk-weather-cache-v2';
  var WEATHER_LOCATION_KEY = 'pk-weather-location-v1';
  var WEATHER_CACHE_TTL = 30 * 60 * 1000;

  function weatherLocationKey(coords) {
    if (!coords || coords.length !== 2) return '';
    return String(coords[0]) + ',' + String(coords[1]);
  }

  function validWeatherCoords(coords) {
    return coords && coords.length === 2 &&
      typeof coords[0] === 'number' && isFinite(coords[0]) &&
      typeof coords[1] === 'number' && isFinite(coords[1]) &&
      coords[0] >= -90 && coords[0] <= 90 &&
      coords[1] >= -180 && coords[1] <= 180;
  }

  function roundWeatherCoords(latitude, longitude) {
    var coords = [
      Math.round(Number(latitude) * 100) / 100,
      Math.round(Number(longitude) * 100) / 100
    ];
    return validWeatherCoords(coords) ? coords : null;
  }

  function readStoredWeatherLocation() {
    try {
      var raw = localStorage.getItem(WEATHER_LOCATION_KEY);
      if (!raw) return null;
      var stored = JSON.parse(raw);
      var coords = stored && [stored.lat, stored.lon];
      return validWeatherCoords(coords) ? coords : null;
    } catch (e) {
      return null;
    }
  }

  function storeWeatherLocation(coords) {
    try {
      localStorage.setItem(WEATHER_LOCATION_KEY, JSON.stringify({
        lat: coords[0],
        lon: coords[1]
      }));
    } catch (e) {}
  }

  function fetchWeather(coords, tz) {
    if (!validWeatherCoords(coords)) return Promise.resolve(null);
    try {
      var raw = localStorage.getItem(WEATHER_CACHE_KEY);
      if (raw) {
        var cached = JSON.parse(raw);
        var fresh = cached && (Date.now() - cached.t) < WEATHER_CACHE_TTL;
        var sameLoc = cached && cached.lat === coords[0] && cached.lon === coords[1];
        if (fresh && sameLoc) return Promise.resolve(cached.v);
      }
    } catch (e) {}

    var url = 'https://api.open-meteo.com/v1/forecast' +
      '?latitude=' + encodeURIComponent(coords[0]) +
      '&longitude=' + encodeURIComponent(coords[1]) +
      '&current=temperature_2m,weather_code' +
      '&temperature_unit=celsius' +
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
          localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({
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

  function readCachedWeather(coords) {
    if (!validWeatherCoords(coords)) return null;
    try {
      var raw = localStorage.getItem(WEATHER_CACHE_KEY);
      if (!raw) return null;
      var cached = JSON.parse(raw);
      var fresh = cached && (Date.now() - cached.t) < WEATHER_CACHE_TTL;
      var sameLoc = cached && cached.lat === coords[0] && cached.lon === coords[1];
      return fresh && sameLoc ? cached.v : null;
    } catch (e) {
      return null;
    }
  }

  function afterFirstInteraction(callback) {
    var done = false;
    var events = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    function cleanup() {
      events.forEach(function(name) {
        window.removeEventListener(name, onFirstInteraction, listenerOpts);
      });
    }
    function onFirstInteraction() {
      if (done) return;
      done = true;
      cleanup();
      callback();
    }
    var listenerOpts = { once: true, passive: true };
    events.forEach(function(name) {
      window.addEventListener(name, onFirstInteraction, listenerOpts);
    });
  }

  var nowWeatherContext = null;
  var nowWeatherRequestedFor = {};

  function paintNowWeather(context, weather) {
    if (!context || !context.nowEl) return;
    var bits = [];
    if (context.loc) bits.push(context.loc);
    if (weather && typeof weather.temp === 'number') {
      bits.push(weather.temp + '°C' + (weather.label ? ' ' + weather.label : ''));
    }
    var str = bits.join(' · ');
    if (context.nowEl.textContent !== str) context.nowEl.textContent = str;
    context.nowEl.setAttribute(
      'aria-label',
      (str ? 'Current conditions: ' + str + '. ' : '') +
      'Use your current location for weather.'
    );
    context.nowEl.title = 'Use your current location for weather';
  }

  function requestNowWeather(context, reportFailure, force) {
    if (!context || !validWeatherCoords(context.coords)) return;
    var key = context.key;
    if (!force && nowWeatherRequestedFor[key]) return;
    nowWeatherRequestedFor[key] = true;
    fetchWeather(context.coords, context.tz).then(function(weather) {
      var current = nowWeatherContext;
      if (!current || current.key !== key) return;
      paintNowWeather(current, weather);
      if (!weather && reportFailure) {
        showToast('Weather unavailable; keeping the local readout.', 'error');
      }
    });
  }

  function setNowLocationBusy(nowEl, busy) {
    nowEl.disabled = busy;
    nowEl.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (busy) {
      nowEl.textContent = 'LOCATING…';
      nowEl.setAttribute('aria-label', 'Finding your current location.');
    }
  }

  function bindNowLocationControl(nowEl) {
    if (!nowEl || nowEl.dataset.locationBound === 'true') return;
    nowEl.dataset.locationBound = 'true';
    nowEl.addEventListener('click', function() {
      if (!navigator.geolocation) {
        showToast('Location is unavailable in this browser; showing Eugene.', 'error');
        return;
      }

      setNowLocationBusy(nowEl, true);
      navigator.geolocation.getCurrentPosition(function(position) {
        var coords = roundWeatherCoords(
          position.coords.latitude,
          position.coords.longitude
        );
        setNowLocationBusy(nowEl, false);
        if (!coords) {
          if (nowWeatherContext) {
            paintNowWeather(nowWeatherContext, readCachedWeather(nowWeatherContext.coords));
          }
          showToast('Location returned invalid coordinates; keeping the existing readout.', 'error');
          return;
        }

        storeWeatherLocation(coords);
        nowWeatherContext = {
          nowEl: nowEl,
          coords: coords,
          tz: 'auto',
          loc: 'LOCAL',
          key: weatherLocationKey(coords)
        };
        paintNowWeather(nowWeatherContext, readCachedWeather(coords));
        requestNowWeather(nowWeatherContext, true, true);
      }, function() {
        setNowLocationBusy(nowEl, false);
        var current = nowWeatherContext;
        if (current) paintNowWeather(current, readCachedWeather(current.coords));
        var retained = current && current.loc === 'LOCAL' ? 'the saved location' : 'Eugene';
        showToast('Location unavailable; keeping ' + retained + '.', 'error');
      }, {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 6 * 60 * 60 * 1000
      });
    });
  }

  function renderNowStrip(meta, posts, reading, gaming, coding) {
    var nowEl = document.getElementById('now-val-now');
    var readingEl = document.getElementById('now-val-reading');
    var gamingEl = document.getElementById('now-val-gaming');
    var buildingEl = document.getElementById('now-val-building');
    if (!nowEl && !readingEl && !gamingEl && !buildingEl) return;

    {
      meta = meta || {};
      posts = posts || [];
      var now = meta.now || {};

      if (readingEl) {
        var title = (reading && reading.title) || now.reading || '';
        var url = reading && reading.url;
        if (title) {
          var readingSig = 'r|' + title + '|' + (url || '');
          if (readingEl.dataset.sig !== readingSig) {
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
            readingEl.dataset.sig = readingSig;
          }
        }
      }

      if (gamingEl) {
        var gamingLabel = (gaming && gaming.label) || (now.gaming && now.gaming.label) || '';
        var gamingRawHref = (gaming && gaming.href) || (now.gaming && now.gaming.href) || '';
        if (gamingLabel) {
          var gamingHref = normalizeInternalHref(gamingRawHref || '#');
          var gamingSig = 'g|' + gamingLabel + '|' + gamingHref;
          if (gamingEl.dataset.sig !== gamingSig) {
            var gamingLink = document.createElement('a');
            gamingLink.href = gamingHref;
            if (/^https?:\/\//i.test(gamingHref)) {
              gamingLink.target = '_blank';
              gamingLink.rel = 'noopener noreferrer';
            }
            gamingLink.textContent = gamingLabel;
            gamingEl.innerHTML = '';
            gamingEl.appendChild(gamingLink);
            gamingEl.dataset.sig = gamingSig;
          }
        }
      }

      if (buildingEl) {
        var buildingLabel = (coding && coding.label) || (now.building && now.building.label) || '';
        var buildingRawHref = (coding && coding.href) || (now.building && now.building.href) || '';
        if (buildingLabel) {
          var buildingHref = normalizeInternalHref(buildingRawHref || '#');
          var buildingSig = 'b|' + buildingLabel + '|' + buildingHref;
          if (buildingEl.dataset.sig !== buildingSig) {
            var buildingLink = document.createElement('a');
            buildingLink.href = buildingHref;
            if (/^https?:\/\//i.test(buildingHref)) {
              buildingLink.target = '_blank';
              buildingLink.rel = 'noopener noreferrer';
            }
            buildingLink.textContent = buildingLabel;
            buildingEl.innerHTML = '';
            buildingEl.appendChild(buildingLink);
            buildingEl.dataset.sig = buildingSig;
          }
        }
      }

      if (!nowEl) return;
      var age = posts.length ? daysAgo(posts[0].date) : null;
      var lastEntryEl = document.getElementById('hero-last-entry');
      if (lastEntryEl) {
        lastEntryEl.textContent = age ? ' · LAST ENTRY ' + age.toUpperCase() : '';
      }
      var storedCoords = readStoredWeatherLocation();
      var coords = storedCoords || now.coords;
      nowWeatherContext = {
        nowEl: nowEl,
        coords: coords,
        tz: storedCoords ? 'auto' : now.timezone,
        loc: storedCoords ? 'LOCAL' : (now.location || ''),
        key: weatherLocationKey(coords)
      };
      bindNowLocationControl(nowEl);

      var cachedWeather = readCachedWeather(coords);
      paintNowWeather(nowWeatherContext, cachedWeather);
      if (!cachedWeather && validWeatherCoords(coords) && !nowWeatherRequestedFor[nowWeatherContext.key]) {
        var initialKey = nowWeatherContext.key;
        afterFirstInteraction(function() {
          var current = nowWeatherContext;
          if (current && current.key === initialKey) requestNowWeather(current, false, false);
        });
      }
    }
  }

  // Paint instantly from the session cache (no `…` flash, no refetch on nav).
  function seedNowStrip() {
    var meta = readJsonSession('/meta.json');
    var posts = readJsonSession('/posts.json');
    if (!meta && !posts) return;
    renderNowStrip(
      meta, posts,
      readJsonSession('/reading.json'),
      readJsonSession('/gaming.json'),
      readJsonSession('/coding.json')
    );
  }

  // Refresh from network, persist to session, repaint silently (idempotent).
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
      renderNowStrip(arr[0], arr[1], arr[2], arr[3], arr[4]);
    });
  }

  function readRotationItems(element, attribute) {
    if (!element) return [];
    try {
      var items = JSON.parse(element.getAttribute(attribute) || '[]');
      return Array.isArray(items) ? items.filter(function(item) {
        return typeof item === 'string' && item;
      }) : [];
    } catch (e) {
      return [];
    }
  }

  var SCRAMBLE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var SCRAMBLE_TRIES = 8;

  function randomScrambleCharacter(model) {
    if (!/[A-Za-z]/.test(model || '')) return model || '';
    var character = SCRAMBLE_ALPHABET[Math.floor(Math.random() * SCRAMBLE_ALPHABET.length)];
    return model === model.toLowerCase() ? character.toLowerCase() : character;
  }

  function scrambleValue(previousText, nextText, render, onComplete) {
    var length = Math.max(previousText.length, nextText.length);
    var sharedLength = 0;
    var frame = 0;
    while (sharedLength < previousText.length && sharedLength < nextText.length &&
           previousText[sharedLength] === nextText[sharedLength]) {
      sharedLength += 1;
    }

    function renderFrame() {
      var output = '';
      var settled = true;

      for (var index = 0; index < length; index += 1) {
        var nextCharacter = nextText[index] || '';
        var previousCharacter = previousText[index] || '';
        var attempts = frame - (index - sharedLength);

        if (index < sharedLength) {
          output += nextCharacter;
          continue;
        }

        if (!nextCharacter) {
          if (attempts < 0) {
            output += previousCharacter;
            settled = false;
          } else if (attempts < SCRAMBLE_TRIES) {
            output += randomScrambleCharacter(previousCharacter);
            settled = false;
          }
          continue;
        }

        if (attempts >= SCRAMBLE_TRIES) {
          output += nextCharacter;
        } else if (attempts < 0) {
          output += previousCharacter;
          settled = false;
        } else {
          output += randomScrambleCharacter(nextCharacter);
          settled = false;
        }
      }

      render(output);
      if (settled) {
        if (onComplete) onComplete();
        return;
      }
      frame += 1;
      window.setTimeout(renderFrame, 45);
    }

    renderFrame();
  }

  function initHeroRotations() {
    var descriptorEl = document.getElementById('hero-descriptor');
    var mainEl = document.getElementById('main');
    var descriptors = readRotationItems(descriptorEl, 'data-descriptors');
    var edgeLabels = readRotationItems(mainEl, 'data-edge-labels');
    if (descriptors.length < 2 && edgeLabels.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var descriptorIndex = 0;
    var edgeIndex = 0;
    var changing = false;
    window.setInterval(function() {
      if (document.hidden || changing) return;
      changing = true;
      var descriptorWillChange = descriptors.length > 1 && descriptorEl;
      var edgeWillChange = edgeLabels.length > 1 && mainEl;
      var pendingChanges = (descriptorWillChange ? 1 : 0) + (edgeWillChange ? 1 : 0);
      function finishChange() {
        pendingChanges -= 1;
        if (pendingChanges === 0) changing = false;
      }

      if (descriptorWillChange) {
        descriptorIndex = (descriptorIndex + 1) % descriptors.length;
        scrambleValue(
          descriptorEl.textContent,
          descriptors[descriptorIndex],
          function(value) { descriptorEl.textContent = value; },
          finishChange
        );
      }
      if (edgeWillChange) {
        edgeIndex = (edgeIndex + 1) % edgeLabels.length;
        scrambleValue(
          mainEl.getAttribute('data-edge-label') || '',
          edgeLabels[edgeIndex],
          function(value) { mainEl.setAttribute('data-edge-label', value); },
          finishChange
        );
      }
      if (pendingChanges === 0) changing = false;
    }, 5000);
  }

  seedNowStrip();

  document.addEventListener('DOMContentLoaded', function() {
    var mainEl = document.getElementById('main');

    setLazyImages(document);
    markExternalLinks(document);
    processMermaidBlocks(mainEl || document);
    if (window.hljs) hljs.highlightAll();
    addCodeCopyButtons(mainEl || document);
    initNowStrip();
    initHeroRotations();

    if (giscusContainer && giscusLoadBtn) {
      giscusLoadBtn.addEventListener('click', function() {
        loadGiscus(giscusContainer.getAttribute('data-term'));
      });
    }
  });
})();
