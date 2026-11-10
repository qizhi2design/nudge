// @ts-nocheck
/**
 * Carrier: owns the embedded page surface.
 *
 * Desktop uses the same Electron `<webview>` guest lease mechanism as the
 * shipped right-Sidebar Browser (`window.dshDesktop.browser.acquire`), so the
 * plugin inherits the main process's isolation policy: no Node access in the
 * page, no downloads, no permissions, HTTP(S) navigation only. Web uses a
 * same-origin `<iframe>` and can only inspect pages the application may read.
 */

var RUNTIME_BOOT = 'window.__DSH_NUDGE__ ? window.__DSH_NUDGE__.version : 0';

function carrierBridge() {
  var desktop = typeof globalThis !== 'undefined' ? globalThis.dshDesktop : undefined;
  if (desktop && desktop.protocolVersion === 1 && desktop.browser && typeof desktop.browser.acquire === 'function') {
    return desktop.browser;
  }
  return null;
}

/** Build the storage identity the browser guest policy expects. */
function workspaceKeyFor(sessionId, workspaces) {
  try {
    var items = workspaces && Array.isArray(workspaces.items) ? workspaces.items : [];
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      if (item && Array.isArray(item.sessionIds) && item.sessionIds.indexOf(sessionId) !== -1) {
        return 'cwd:' + item.path;
      }
    }
  } catch (error) {
    /* ignore */
  }
  return 'session:' + sessionId;
}

function createCarrier(options) {
  var sessionId = options.sessionId;
  var workspaceKey = options.workspaceKey;
  var container = options.container;
  var callbacks = options.callbacks || {};
  var bridge = carrierBridge();
  var kind = bridge !== null ? 'webview' : 'iframe';
  var element = null;
  var lease = null;
  var disposed = false;
  var mounted = false;
  var guestReady = false;
  var pendingUrl = null;
  var runtimeReady = false;
  var lastUrl = '';
  var bottomInset = 0;
  var barHosted = false;
  var theme = options.theme || readTheme();
  var localeStrings = options.localeStrings || {};
  var listeners = [];

  function notify(name, payload) {
    var fn = callbacks[name];
    if (typeof fn === 'function') {
      try {
        fn(payload);
      } catch (error) {
        console.error('[dsh-nudge] carrier callback failed', name, error);
      }
    }
  }

  function on(target, type, handler) {
    target.addEventListener(type, handler);
    listeners.push(function () {
      target.removeEventListener(type, handler);
    });
  }

  function createWebview(reservation) {
    var el = document.createElement('webview');
    el.setAttribute('name', reservation.lease);
    el.setAttribute('partition', reservation.partition);
    el.setAttribute('allowpopups', '');
    el.setAttribute('src', 'about:blank#' + reservation.lease);
    el.setAttribute('aria-label', 'Visual Inspector page');
    el.style.cssText =
      'flex:auto;display:flex;width:100%;height:100%;min-width:0;min-height:0;border:0;background:var(--dsw-alias-bg-base);';
    on(el, 'dom-ready', function () {
      guestReady = true;
      notify('ready', { kind: kind });
      if (pendingUrl !== null) {
        var url = pendingUrl;
        pendingUrl = null;
        loadUrl(url);
      }
    });
    on(el, 'did-start-loading', function () {
      notify('loading', { loading: true });
    });
    on(el, 'did-stop-loading', function () {
      notify('loading', { loading: false });
      notifyNavigation();
    });
    on(el, 'did-navigate', function (event) {
      var url = (event && event.url) || safeGetUrl();
      lastUrl = url;
      notifyNavigation();
      notify('navigated', { url: url });
    });
    on(el, 'did-navigate-in-page', function (event) {
      if (event && event.isMainFrame === false) return;
      var url = (event && event.url) || safeGetUrl();
      lastUrl = url;
      notifyNavigation();
      notify('navigated', { url: url });
    });
    on(el, 'did-finish-load', function () {
      notifyNavigation();
      notify('loaded', { url: safeGetUrl() });
    });
    on(el, 'did-fail-load', function (event) {
      if (event && event.errorCode === -3) return;
      notify('error', {
        code: event && event.errorCode,
        description: (event && event.errorDescription) || 'load failed',
        url: (event && event.validatedURL) || '',
      });
    });
    on(el, 'page-title-updated', function (event) {
      notify('title', { title: (event && event.title) || '' });
    });
    on(el, 'render-process-gone', function () {
      notify('error', { code: -1, description: 'renderer process gone', url: lastUrl });
    });
    return el;
  }

  function safeGetUrl() {
    try {
      return typeof element.getURL === 'function' ? element.getURL() : lastUrl;
    } catch (error) {
      return lastUrl;
    }
  }

  function notifyNavigation() {
    var canBack = false;
    var canForward = false;
    try {
      canBack = typeof element.canGoBack === 'function' ? element.canGoBack() === true : false;
      canForward = typeof element.canGoForward === 'function' ? element.canGoForward() === true : false;
    } catch (error) {
      /* ignore */
    }
    notify('navigation', { canGoBack: canBack, canGoForward: canForward, url: safeGetUrl() });
  }

  function createIframe() {
    var el = document.createElement('iframe');
    el.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    el.setAttribute('referrerpolicy', 'no-referrer');
    el.setAttribute('aria-label', 'Visual Inspector page');
    el.style.cssText = 'flex:auto;display:flex;width:100%;height:100%;min-width:0;min-height:0;border:0;background:var(--dsw-alias-bg-base, #fff);';
    on(el, 'load', function () {
      guestReady = true;
      notify('loaded', { url: lastUrl });
    });
    return el;
  }

  function exec(code) {
    if (disposed) return Promise.reject(new Error('carrier disposed'));
    if (kind === 'webview') {
      try {
        return Promise.resolve(element.executeJavaScript(code, true));
      } catch (error) {
        return Promise.reject(error);
      }
    }
    try {
      var frameWindow = element.contentWindow;
      if (frameWindow === null) return Promise.reject(new Error('iframe is not available'));
      return Promise.resolve(frameWindow.eval(code));
    } catch (error) {
      return Promise.reject(new Error('cross-origin page: the web carrier cannot inspect this page'));
    }
  }

  function runtimeExpr(expression) {
    return (
      '(function(){try{var r=window.__DSH_NUDGE__;if(!r)return null;return (' +
      expression +
      ');}catch(e){return {ok:false,error:String(e&&e.message||e)}}})()'
    );
  }

  function runtimeJson(expression) {
    return exec('JSON.stringify(' + runtimeExpr(expression) + ')').then(function (value) {
      if (typeof value !== 'string') return null;
      try {
        return JSON.parse(value);
      } catch (error) {
        return null;
      }
    });
  }

  function runtimeCommand(expression) {
    return runtimeJson(expression);
  }

  function injected() {
    return exec(PAGE_RUNTIME_SOURCE).then(function () {
      return exec(RUNTIME_BOOT);
    }).then(function (version) {
      runtimeReady = Number(version) >= 1;
      return runtimeReady;
    });
  }

  function stringsFor(locale) {
    var dict = locale && locale.annotation ? locale : {};
    var annotation = dict.annotation || {};
    function pick(key, fallback) {
      return typeof annotation[key] === 'string' && annotation[key] !== '' ? annotation[key] : fallback;
    }
    return {
      title: pick('popoverTitle', 'Add annotation'),
      subtitle: pick('popoverSubtitle', 'For the selected element'),
      placeholder: pick('placeholder', 'Describe how the agent should change this…'),
      cancel: pick('cancel', 'Cancel'),
      add: pick('add', 'Add'),
      region: pick('region', 'Region'),
      designTitle: pick('designTitle', 'Adjust styles'),
      designColor: pick('designColor', 'Text color'),
      designBackground: pick('designBackground', 'Background'),
      designOpacity: pick('designOpacity', 'Opacity'),
      designFont: pick('designFont', 'Font'),
      designFontSize: pick('designFontSize', 'Font size'),
      designFontWeight: pick('designFontWeight', 'Weight'),
      designCancel: pick('designCancel', 'Cancel'),
      designApply: pick('designApply', 'Done'),
      designClose: pick('designClose', 'Close'),
      designPreview: pick('designPreview', 'Live preview'),
      statusAnnotating: pick('statusAnnotating', 'Annotating'),
      statusSend: pick('statusSend', 'Send'),
      statusExit: pick('statusExit', 'Exit annotate'),
      statusRemove: pick('statusRemove', 'Remove'),
      statusLocate: pick('statusLocate', 'Locate annotation'),
      statusHideMarkers: pick('statusHideMarkers', 'Hide markers'),
      statusShowMarkers: pick('statusShowMarkers', 'Show markers'),
      statusDiscard: pick('statusDiscard', 'Discard annotations'),
      statusDiscardArmed: pick('statusDiscardArmed', 'Click again to discard all annotations'),
      statusMoveToolbar: pick('statusMoveToolbar', 'Move toolbar'),
      designLayout: pick('designLayout', 'Layout'),
      designSpacing: pick('designSpacing', 'Spacing'),
      designTypography: pick('designTypography', 'Text'),
      designAppearance: pick('designAppearance', 'Appearance'),
      designAdvanced: pick('designAdvanced', 'Advanced'),
      designWidth: pick('designWidth', 'Width'),
      designHeight: pick('designHeight', 'Height'),
      designDisplay: pick('designDisplay', 'Display'),
      designPosition: pick('designPosition', 'Position'),
      designOverflow: pick('designOverflow', 'Overflow'),
      designMargin: pick('designMargin', 'Margin'),
      designPadding: pick('designPadding', 'Padding'),
      designGap: pick('designGap', 'Gap'),
      designLineHeight: pick('designLineHeight', 'Line height'),
      designLetterSpacing: pick('designLetterSpacing', 'Letter spacing'),
      designTextAlign: pick('designTextAlign', 'Align'),
      designBorder: pick('designBorder', 'Border'),
      designBorderRadius: pick('designBorderRadius', 'Radius'),
      designShadow: pick('designShadow', 'Shadow'),
      designTransform: pick('designTransform', 'Transform'),
      designZIndex: pick('designZIndex', 'Z-index'),
      designVisibility: pick('designVisibility', 'Visibility'),
      designContent: pick('designContent', 'Content'),
      designDom: pick('designDom', 'DOM'),
      designTextContent: pick('designTextContent', 'Text content'),
      designNoDirectText: pick('designNoDirectText', 'This element has no directly editable text node'),
      designAncestors: pick('designAncestors', 'Ancestors'),
      designDescendants: pick('designDescendants', 'Children'),
      designNoDescendants: pick('designNoDescendants', 'No child elements'),
      designDelete: pick('designDelete', 'Delete element'),
      designDeleteHint: pick('designDeleteHint', 'Remove this element and its subtree'),
      designMoveHint: pick('designMoveHint', 'Drag to reorder or nest'),
    };
  }

  function applyRuntimePreferences() {
    if (!runtimeReady) return Promise.resolve(false);
    var strings = stringsFor(localeStrings);
    var palette = themePaletteForRuntime(theme);
    return exec(
      '(function(){try{var r=window.__DSH_NUDGE__;if(!r)return false;' +
        'r.setLocale(' + JSON.stringify(strings) + ');' +
        'r.setTheme(' + JSON.stringify(palette) + ');' +
        'r.setBottomInset(' + bottomInset + ');' +
        'r.setBarHosted(' + (barHosted ? 'true' : 'false') + ');' +
        'return true;}catch(e){return false;}})()',
    );
  }

  function injectRuntime(mode, applyEdits) {
    runtimeReady = false;
    return injected().then(function (ok) {
      if (!ok) {
        notify('runtime-missing', {});
        return false;
      }
      return applyRuntimePreferences().then(function () {
        var jobs = [];
        if (Array.isArray(applyEdits) && applyEdits.length > 0) {
          jobs.push(runtimeCommand('r.reapply(' + JSON.stringify(applyEdits) + ')'));
        }
        jobs.push(runtimeCommand('r.setMode(' + JSON.stringify(mode || 'browse') + ')'));
        return Promise.all(jobs).then(function () {
          notify('runtime-ready', { url: safeGetUrl() });
          return true;
        });
      });
    });
  }

  var carrier = {
    kind: kind,
    get element() {
      return element;
    },
    get ready() {
      return guestReady;
    },
    get runtimeReady() {
      return runtimeReady;
    },
    mount: function () {
      if (mounted || disposed) return Promise.resolve();
      mounted = true;
      if (kind === 'webview') {
        var browser = carrierBridge();
        return Promise.resolve(browser.acquire(workspaceKey))
          .then(function (reservation) {
            if (disposed) {
              return browser.release(reservation.lease).catch(function () {});
            }
            lease = reservation.lease;
            element = createWebview(reservation);
            container.appendChild(element);
            notify('carrier', { kind: 'webview' });
          })
          .catch(function (error) {
            notify('error', { code: -1, description: 'webview lease failed: ' + (error && error.message ? error.message : error), url: '' });
          });
      }
      element = createIframe();
      container.appendChild(element);
      notify('carrier', { kind: 'iframe' });
      return Promise.resolve();
    },
    dispose: function () {
      if (disposed) return Promise.resolve();
      disposed = true;
      listeners.forEach(function (off) {
        try {
          off();
        } catch (error) {
          /* ignore */
        }
      });
      listeners = [];
      runtimeReady = false;
      var browser = carrierBridge();
      var released = null;
      if (lease !== null && browser !== null && typeof browser.release === 'function') {
        released = Promise.resolve(browser.release(lease)).catch(function () {});
        lease = null;
      }
      if (element !== null) {
        try {
          if (element.parentNode !== null) element.parentNode.removeChild(element);
        } catch (error) {
          /* ignore */
        }
        element = null;
      }
      return released || Promise.resolve();
    },
    load: function (url) {
      if (kind === 'webview') {
        if (!guestReady) {
          pendingUrl = url;
          return;
        }
        loadUrl(url);
        return;
      }
      if (url !== lastUrl) {
        lastUrl = url;
        element.setAttribute('src', url);
      }
    },
    reload: function () {
      if (kind === 'webview') {
        try {
          if (typeof element.reload === 'function') element.reload();
        } catch (error) {
          notify('error', { code: -1, description: String(error && error.message ? error.message : error), url: lastUrl });
        }
        return;
      }
      if (lastUrl !== '') {
        element.setAttribute('src', lastUrl);
        try {
          element.contentWindow.location.reload();
        } catch (error) {
          /* ignore */
        }
      }
    },
    goBack: function () {
      if (kind !== 'webview') return;
      try {
        if (element.canGoBack()) element.goBack();
      } catch (error) {
        /* ignore */
      }
    },
    goForward: function () {
      if (kind !== 'webview') return;
      try {
        if (element.canGoForward()) element.goForward();
      } catch (error) {
        /* ignore */
      }
    },
    url: safeGetUrl,
    exec: exec,
    runtime: runtimeCommand,
    injectRuntime: injectRuntime,
    applyPreferences: function (nextTheme, nextLocale) {
      if (nextTheme !== undefined) theme = nextTheme;
      if (nextLocale !== undefined) localeStrings = nextLocale;
      return applyRuntimePreferences();
    },
    setMode: function (mode) {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeCommand('r.setMode(' + JSON.stringify(mode) + ')');
    },
    /**
     * Reserved host strip (the floating composer dock) measured from the page
     * bottom. The runtime clamps its own floating UI above it. The value is
     * remembered so a page reload re-applies it through applyRuntimePreferences.
     */
    setBottomInset: function (inset) {
      var next = Number(inset);
      if (!isFinite(next) || next < 0) next = 0;
      next = Math.min(400, Math.round(next));
      if (next === bottomInset) return Promise.resolve(true);
      bottomInset = next;
      if (!runtimeReady) return Promise.resolve(true);
      return runtimeCommand('r.setBottomInset(' + bottomInset + ')');
    },
    /**
     * Host-side annotation bar: the floating composer dock is a host layer above
     * the webview, so in fullscreen the page's own bar cannot paint over the
     * input box. The host renders the bar and hides the in-page one.
     */
    setBarHosted: function (hosted) {
      barHosted = hosted === true;
      if (!runtimeReady) return Promise.resolve(true);
      return runtimeCommand('r.setBarHosted(' + (barHosted ? 'true' : 'false') + ')');
    },
    getBarState: function () {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeJson('r.getBarState()');
    },
    toggleMarkers: function () {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeJson('r.toggleMarkers()');
    },
    discardAnnotations: function () {
      if (!runtimeReady) return Promise.resolve(false);
      return runtimeCommand('r.discardAnnotations()');
    },
    sendAnnotations: function () {
      if (!runtimeReady) return Promise.resolve(false);
      return runtimeCommand('r.sendAnnotations()');
    },
    exitAnnotate: function () {
      if (!runtimeReady) return Promise.resolve(false);
      return runtimeCommand('r.exitAnnotate()');
    },
    locateLastAnnotation: function () {
      if (!runtimeReady) return Promise.resolve(false);
      return runtimeCommand('r.locateLastAnnotation()');
    },
    drainEvents: function () {
      if (!runtimeReady) return Promise.resolve([]);
      return runtimeJson('r.drainEvents()').then(function (value) {
        return Array.isArray(value) ? value : [];
      });
    },
    select: function (selector) {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeCommand('r.setSelection(' + JSON.stringify(selector) + ')');
    },
    clearSelection: function () {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeCommand('r.clearSelection()');
    },
    applyStyle: function (selector, property, value, important) {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeCommand(
        'r.applyStyle(' + JSON.stringify(selector) + ',' + JSON.stringify(property) + ',' + JSON.stringify(value) + ',' + (important === false ? 'false' : 'true') + ')',
      );
    },
    applyText: function (selector, text) {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeCommand('r.applyText(' + JSON.stringify(selector) + ',' + JSON.stringify(text) + ')');
    },
    applyAttr: function (selector, name, value) {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeCommand('r.applyAttr(' + JSON.stringify(selector) + ',' + JSON.stringify(name) + ',' + JSON.stringify(value) + ')');
    },
    reapply: function (edits) {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeCommand('r.reapply(' + JSON.stringify(edits) + ')');
    },
    describe: function (selector) {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeJson('r.getDescriptor(' + JSON.stringify(selector) + ')');
    },
    ancestry: function (selector, up, down) {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeJson(
        'r.getAncestry(' + JSON.stringify(selector) + ',' + Number(up || 3) + ',' + Number(down || 2) + ')',
      );
    },
    locate: function (selector) {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeCommand('r.locate(' + JSON.stringify(selector) + ')');
    },
    domChildren: function (path) {
      if (!runtimeReady) return Promise.resolve([]);
      return runtimeJson('r.domChildren(' + JSON.stringify(Array.isArray(path) ? path : []) + ')').then(function (value) {
        return Array.isArray(value) ? value : [];
      });
    },
    focusDomPath: function (path) {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeJson('r.focusDomPath(' + JSON.stringify(Array.isArray(path) ? path : []) + ')');
    },
    openAnnotationEditor: function (id) {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeCommand('r.openAnnotationEditor(' + JSON.stringify(id) + ')');
    },
    removeAnnotation: function (id) {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeCommand('r.removeAnnotation(' + JSON.stringify(id) + ')');
    },
    capture: function (rect) {
      if (kind !== 'webview' || typeof element.capturePage !== 'function') return Promise.resolve(null);
      try {
        return Promise.resolve(element.capturePage(rect || undefined)).then(function (image) {
          return image && typeof image.toDataURL === 'function' ? image.toDataURL() : null;
        });
      } catch (error) {
        return Promise.resolve(null);
      }
    },
    getState: function () {
      if (!runtimeReady) return Promise.resolve(null);
      return runtimeJson('r.getState()');
    },
  };

  function loadUrl(url) {
    lastUrl = url;
    notify('navigated', { url: url });
    try {
      element.loadURL(url).catch(function (error) {
        notify('error', { code: -1, description: String(error && error.message ? error.message : error), url: url });
      });
    } catch (error) {
      notify('error', { code: -1, description: String(error && error.message ? error.message : error), url: url });
    }
  }

  return carrier;
}
