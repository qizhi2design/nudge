// @ts-nocheck
/**
 * DSH theme-token bridge and palette conversion for the page runtime.
 *
 * DSH publishes its `--dsw-alias-*` palette on `<body>` (not on `<html>`) and
 * flips `body[data-ds-dark-theme]` when the desktop theme changes, so every read
 * must happen on the body element and the host UI must re-render on change.
 * `useDshTheme()` subscribes to the `theme/change` client event, to mutations of
 * the body theme attributes, and to the OS color-scheme query; the snapshot is
 * the same object until one of those signals produces a different palette.
 */

var THEME_TOKENS = {
  base: '--dsw-alias-bg-base',
  layer1: '--dsw-alias-bg-layer-1',
  layer2: '--dsw-alias-bg-layer-2',
  layer3: '--dsw-alias-bg-layer-3',
  overlay: '--dsw-alias-bg-overlay',
  border: '--dsw-alias-border-l1',
  borderStrong: '--dsw-alias-border-l2',
  brand: '--dsw-alias-brand-primary',
  accent: '--dsw-alias-state-business-primary',
  onBrand: '--dsw-alias-label-primary-foreground',
  text: '--dsw-alias-label-primary',
  muted: '--dsw-alias-label-secondary',
  faint: '--dsw-alias-label-tertiary',
  danger: '--dsw-alias-state-error-primary',
  success: '--dsw-alias-state-success-primary',
  warn: '--dsw-alias-state-warn-primary',
  hover: '--dsw-alias-interactive-bg-hover',
};

// Values mirror the DSH token stylesheet for the two built-in palettes; they are
// only used when the document has no token declarations yet (first paint, tests,
// non-DSH hosts).
var THEME_FALLBACK_DARK = {
  base: '#151517',
  layer1: '#232324',
  layer2: '#2c2c2e',
  layer3: '#353638',
  overlay: '#61666b',
  border: '#ffffff0f',
  borderStrong: '#ffffff1f',
  brand: '#f9fafb',
  accent: '#7aaaff',
  onBrand: '#0f1115',
  text: '#f9fafb',
  muted: '#cfd3d6',
  faint: '#adb2b8',
  danger: '#f25a5a',
  success: '#22c55e',
  warn: '#f59e0b',
  hover: '#ffffff14',
  isDark: true,
};

var THEME_FALLBACK_LIGHT = {
  base: '#ffffff',
  layer1: '#ffffff',
  layer2: '#ffffff',
  layer3: '#ffffff',
  overlay: '#e9ecf2',
  border: '#0000000a',
  borderStrong: '#0000001f',
  brand: '#0f1115',
  accent: '#4176e6',
  onBrand: '#ffffff',
  text: '#0f1115',
  muted: '#61666b',
  faint: '#81858c',
  danger: '#ec1313',
  success: '#22c55e',
  warn: '#f59e0b',
  hover: '#2631480f',
  isDark: false,
};

function themeFallbacks(isDark) {
  return isDark === true ? THEME_FALLBACK_DARK : THEME_FALLBACK_LIGHT;
}

/** Best-effort color-scheme hint when no token has been read yet. */
function themeSchemeHint() {
  try {
    var body = typeof document !== 'undefined' ? document.body : null;
    if (body && typeof body.hasAttribute === 'function' && body.hasAttribute('data-ds-dark-theme')) return 'dark';
  } catch (error) {
    /* ignore */
  }
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch (error) {
    /* ignore */
  }
  return 'light';
}

/** Parse #rgb/#rgba/#rrggbb/#rrggbbaa and rgb()/rgba() into channels. */
function parseColorChannels(color) {
  var text = String(color == null ? '' : color).trim().toLowerCase();
  var hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex !== null) {
    var raw = hex[1];
    if (raw.length === 3 || raw.length === 4) {
      return [parseInt(raw.charAt(0) + raw.charAt(0), 16), parseInt(raw.charAt(1) + raw.charAt(1), 16), parseInt(raw.charAt(2) + raw.charAt(2), 16)];
    }
    if (raw.length === 6 || raw.length === 8) {
      return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
    }
    return null;
  }
  var match = /^rgba?\(([^)]+)\)$/.exec(text);
  if (match === null) return null;
  var pieces = match[1]
    .split(/[\s,\/]+/)
    .map(function (piece) { return parseFloat(piece); })
    .filter(function (piece) { return isFinite(piece); });
  return pieces.length >= 3 ? [pieces[0], pieces[1], pieces[2]] : null;
}

/** True when the color reads as a dark surface; null when it cannot be parsed. */
function isDarkTheme(color) {
  var channels = parseColorChannels(color);
  if (channels === null) return null;
  return (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000 < 140;
}

/** Read the current DSH palette from the live document. */
function readTheme() {
  var isDark = themeSchemeHint() === 'dark';
  var out = Object.assign({}, themeFallbacks(isDark));
  var body = null;
  var root = null;
  try {
    body = typeof document !== 'undefined' ? document.body : null;
    root = body || (typeof document !== 'undefined' ? document.documentElement : null);
  } catch (error) {
    root = null;
  }
  if (root !== null) {
    try {
      var style = getComputedStyle(root);
      var readToken = function (name, fallback) {
        try {
          var value = style.getPropertyValue(name).trim();
          return value === '' ? fallback : value;
        } catch (error) {
          return fallback;
        }
      };
      var baseValue = readToken(THEME_TOKENS.base, '');
      Object.keys(THEME_TOKENS).forEach(function (field) {
        out[field] = readToken(THEME_TOKENS[field], out[field]);
      });
      var baseDark = baseValue === '' ? null : isDarkTheme(baseValue);
      if (baseDark !== null) out.isDark = baseDark;
      else if (body && typeof body.hasAttribute === 'function' && body.hasAttribute('data-ds-dark-theme')) out.isDark = true;
    } catch (error) {
      out.isDark = themeSchemeHint() === 'dark';
    }
  }
  return out;
}

function themeSignature(theme) {
  var keys = Object.keys(theme).sort();
  var out = [];
  for (var index = 0; index < keys.length; index += 1) out.push(keys[index] + '=' + String(theme[keys[index]]));
  return out.join('|');
}

function sameTheme(left, right) {
  return themeSignature(left) === themeSignature(right);
}

/**
 * Theme store shared by every plugin surface. It starts its listeners on the
 * first subscriber and releases them with the last one.
 */
function createThemeStore(ctx) {
  var snapshot = readTheme();
  var signature = themeSignature(snapshot);
  var listeners = [];
  var dispose = null;
  var pendingFrame = 0;

  function notify() {
    var current = listeners.slice();
    for (var index = 0; index < current.length; index += 1) {
      try {
        current[index]();
      } catch (error) {
        console.error('[dsh-nudge] theme listener failed', error);
      }
    }
  }

  function refresh(force) {
    var next = readTheme();
    var nextSignature = themeSignature(next);
    if (!force && nextSignature === signature) return false;
    snapshot = next;
    signature = nextSignature;
    notify();
    return true;
  }

  /**
   * The ui-layout presenter applies the body token declarations inside the same
   * `theme/change` dispatch, but its listener may run after ours; re-read on the
   * next frame so the first snapshot already carries the new palette.
   */
  function scheduleRefresh() {
    if (pendingFrame !== 0) return;
    var schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : function (callback) { return setTimeout(callback, 0); };
    pendingFrame = schedule(function () {
      pendingFrame = 0;
      refresh(false);
    });
  }

  function start() {
    var disposers = [];
    try {
      var host = ctx && ctx.theme;
      if (host && typeof ctx.on === 'function') {
        disposers.push(ctx.on('theme/change', function () { scheduleRefresh(); }));
      }
    } catch (error) {
      /* host theme service is optional */
    }
    try {
      if (typeof MutationObserver === 'function') {
        var body = typeof document !== 'undefined' ? document.body : null;
        if (body) {
          var observer = new MutationObserver(function () { refresh(false); });
          observer.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style', 'data-theme'] });
          disposers.push(function () { observer.disconnect(); });
        }
      }
    } catch (error) {
      /* ignore */
    }
    try {
      if (typeof matchMedia === 'function') {
        var media = matchMedia('(prefers-color-scheme: dark)');
        var onScheme = function () { refresh(false); };
        if (media && typeof media.addEventListener === 'function') {
          media.addEventListener('change', onScheme);
          disposers.push(function () { media.removeEventListener('change', onScheme); });
        }
      }
    } catch (error) {
      /* ignore */
    }
    dispose = function () {
      for (var index = 0; index < disposers.length; index += 1) {
        try {
          disposers[index]();
        } catch (error) {
          /* ignore */
        }
      }
      dispose = null;
    };
    refresh(false);
  }

  function stop() {
    if (pendingFrame !== 0) {
      try {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(pendingFrame);
        else clearTimeout(pendingFrame);
      } catch (error) {
        /* ignore */
      }
      pendingFrame = 0;
    }
    if (dispose !== null) dispose();
  }

  return {
    getSnapshot: function () {
      return snapshot;
    },
    subscribe: function (listener) {
      listeners.push(listener);
      if (listeners.length === 1) start();
      return function () {
        var index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
        if (listeners.length === 0) stop();
      };
    },
    refresh: refresh,
  };
}

/** React hook: the live DSH palette, re-rendering the caller on every change. */
function useDshTheme(ctx) {
  var store = React.useMemo(function () {
    return createThemeStore(ctx);
  }, [ctx]);
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Minimal palette contract for the injected page runtime. */
function themePaletteForRuntime(theme) {
  return {
    accent: theme.brand,
    panelBg: theme.layer2 || theme.base,
    text: theme.text,
    border: theme.borderStrong || theme.border,
    muted: theme.muted,
    danger: theme.danger,
    isDark: theme.isDark === true,
  };
}

// Engineering-test seam: the host only consumes `name`/`inject`/`apply` from the
// client factory. When a test harness opts in via `__DSH_VI_TEST_HOOKS__`, expose
// the palette bridge so test/client-theme.test.mjs can exercise it without a
// browser; production exports stay untouched.
if (typeof globalThis !== 'undefined' && globalThis.__DSH_VI_TEST_HOOKS__ === true) {
  exports.__dshnudgeThemeInternals = {
    readTheme: readTheme,
    createThemeStore: createThemeStore,
    themeSignature: themeSignature,
    themePaletteForRuntime: themePaletteForRuntime,
  };
}
