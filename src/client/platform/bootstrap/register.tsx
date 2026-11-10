// @ts-nocheck
/**
 * Registrations: the right-Sidebar tab type and body, the browser guide card
 * (whose submenu opens the inspector), the browser tab menu action, the URL
 * context menu entry, the global open shortcut, and the composer clip tray.
 * Everything is registered through `ctx.effect` so disposal is exact.
 */


// ------------------------------------------------------- shortcut commands

/** Locate one tab record from the Session inventory. */
function nudgeTabRecord(sidebar, sessionId, tabId) {
  if (!sidebar || typeof sidebar.tabsIn !== 'function' || !tabId) return null;
  var tabs = [];
  try {
    tabs = sidebar.tabsIn(sessionId) || [];
  } catch (error) {
    tabs = [];
  }
  for (var index = 0; index < tabs.length; index += 1) {
    if (tabs[index] && tabs[index].id === tabId) return tabs[index];
  }
  return null;
}

/** First Inspector tab in a Session, used to focus instead of stacking tabs. */
function firstNudgeTab(sidebar, sessionId) {
  if (!sidebar || typeof sidebar.tabsIn !== 'function') return null;
  var tabs = [];
  try {
    tabs = sidebar.tabsIn(sessionId) || [];
  } catch (error) {
    tabs = [];
  }
  for (var index = 0; index < tabs.length; index += 1) {
    if (tabs[index] && tabs[index].kind === TAB_KIND) return tabs[index];
  }
  return null;
}

function revealNudgeTab(sidebar, tabId) {
  try {
    if (typeof sidebar.focus === 'function') sidebar.focus(tabId);
    if (typeof sidebar.isExpanded === 'function' && sidebar.isExpanded() === false && typeof sidebar.toggleExpanded === 'function') {
      sidebar.toggleExpanded();
    }
  } catch (error) {
    /* the column may already be transitioning; the open path still works */
  }
}

/**
 * Focus an existing Inspector tab, or open one when the Session has none. Panel
 * commands (DOM tree / workspace versions) are queued until the body registers
 * its command surface.
 */
function openNudgeForCommand(ctx, definition, target, tabRecord) {
  var sidebar = ctx.sidebarRight;
  var sessionId = target && target.sessionId ? target.sessionId : '';
  if (!sidebar || sessionId === '') return false;
  var existing = firstNudgeTab(sidebar, sessionId);
  if (existing) {
    revealNudgeTab(sidebar, existing.id);
    if (definition.action !== 'open') {
      var entry = nudgeTabCommandEntry(existing.id);
      if (entry !== null) runNudgeTabAction(entry.api, definition.action);
      else queueNudgeCommand(sessionId, definition.action);
    }
    return true;
  }
  if (definition.action === 'open') {
    try {
      sidebar.openTabFromTarget(TAB_KIND, target);
      return true;
    } catch (error) {
      console.error('[dsh-nudge] open tab failed', error);
      return false;
    }
  }
  var params = {};
  if (tabRecord && tabRecord.kind === BROWSER_KIND) {
    var url = browserTabUrl(ctx, sessionId, tabRecord);
    if (url !== null) params.url = url;
  }
  var options = { params: params };
  if (target && target.paneId) options.paneId = target.paneId;
  if (tabRecord && tabRecord.kind === 'guide') options.replaceTab = tabRecord.id;
  try {
    sidebar.openTabIn(sessionId, TAB_KIND, options);
  } catch (error) {
    console.error('[dsh-nudge] open inspector failed', error);
    return false;
  }
  queueNudgeCommand(sessionId, definition.action);
  return true;
}

/** Resolve one registered command against the current focus and tab. */
function resolveNudgeShortcut(ctx, t, definition, input) {
  if (definition.feature && pluginConfigValues()[definition.feature] === false) {
    return { status: 'blocked', reason: t('shortcut.featureOff') };
  }
  var sidebar = ctx.sidebarRight;
  if (!sidebar || typeof sidebar.commandTarget !== 'function') {
    return { status: 'blocked', reason: t('shortcut.noSession') };
  }
  var target = sidebar.commandTarget(input && input.target ? input.target : null);
  if (!target) return { status: 'blocked', reason: t('shortcut.noSession') };
  var tabRecord = nudgeTabRecord(sidebar, target.sessionId, target.tabId);
  var live = tabRecord !== null && tabRecord.kind === TAB_KIND ? nudgeTabCommandEntry(tabRecord.id) : null;
  if (live !== null) {
    return {
      status: 'handled',
      run: function () {
        if (typeof sidebar.isTargetCurrent === 'function' && !sidebar.isTargetCurrent(target)) return;
        runNudgeTabAction(live.api, definition.action);
      },
    };
  }
  return {
    status: 'handled',
    run: function () {
      if (typeof sidebar.isTargetCurrent === 'function' && !sidebar.isTargetCurrent(target)) return;
      openNudgeForCommand(ctx, definition, target, tabRecord);
    },
  };
}

/** Register every app-level Nudge command plus the read-only fixed page-key rows. */
function installNudgeShortcuts(ctx, shortcuts, t) {
  var disposers = [installNudgeShortcutService(shortcuts)];
  NUDGE_SHORTCUT_COMMANDS.forEach(function (definition) {
    try {
      disposers.push(
        shortcuts.register({
          id: definition.id,
          label: function () {
            return t(definition.label);
          },
          aliases: definition.aliases,
          defaults: definition.defaults,
          regions: definition.regions,
          modals: [],
          resolve: function (input) {
            return resolveNudgeShortcut(ctx, t, definition, input);
          },
        }),
      );
    } catch (error) {
      // One unavailable combination must never take the whole plugin down;
      // the remaining commands still publish and the user can rebind this one.
      console.error('[dsh-nudge] shortcut registration failed: ' + definition.id, error);
    }
  });
  if (typeof shortcuts.registerFixed === 'function') {
    [NUDGE_SHORTCUT_SPACE].concat(NUDGE_SHORTCUT_PAGE_KEYS).forEach(function (fixed) {
      try {
        disposers.push(
          shortcuts.registerFixed({
            id: fixed.id,
            label: function () {
              return t(fixed.label);
            },
            keys: fixed.keys.slice(),
            bindings: fixed.bindings.map(function (binding) {
              return { code: binding.code, modifiers: binding.modifiers.slice() };
            }),
            group: fixed.group,
          }),
        );
      } catch (error) {
        console.error('[dsh-nudge] fixed shortcut registration failed: ' + fixed.id, error);
      }
    });
  }
  return function () {
    for (var index = disposers.length - 1; index >= 0; index -= 1) {
      try {
        disposers[index]();
      } catch (error) {
        console.error('[dsh-nudge] shortcut dispose failed', error);
      }
    }
  };
}

// ---------------------------------------------- client diagnostics bridge state
// Declared before `apply` (the module is fully evaluated before DSH calls it)
// so the apply-time instance id below is easy to audit.
var clientDebugContext = null;
var clientDebugRemote = null;
var clientDebugRemoteOwner = null;
var clientDebugInstance = 'nudge-module-' + Date.now().toString(36);

function apply(ctx) {
  var locale = ctx.locale;
  var slots = ctx.slots;
  var tabs = ctx.sidebarRightTabs;
  var sidebarRight = ctx.sidebarRight;
  var t = createPluginTranslator(locale.bind(NS));

  // Diagnostics: one id per apply call makes it possible to tell which module
  // instance (pre- or post-HMR) produced a log line.
  setClientDebugContext(ctx);
  clipSendModuleAlive = true;
  clientDebugInstance = 'nudge-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  clientDebugLog('apply', { injectCount: INJECT.length });

  // Mirror the product preferences (language, feature switches, context-menu
  // switches) into the Client store. Defaults apply until this resolves.
  loadPluginConfig(ctx);

  ensureGlobalStyles();

  // Fullscreen presentation: keep the conversation's native composer reachable
  // above the right-Sidebar panel while a Nudge tab is presented fullscreen.
  ctx.effect(function () {
    return installFloatingComposer(typeof document === 'undefined' ? null : document);
  }, 'nudge: floating composer');

  // Conversation HTML links: a passive 「轻推」badge plus a small open-with
  // chooser. Anchors keep their own click handler, so the chat's link-opening
  // preference stays the default.
  ctx.effect(function () {
    return installConversationLinkBadges(ctx);
  }, 'nudge: conversation link badges');

  ctx.effect(function () {
    return locale.register(NS, {
      zh: readLocaleDict('zh'),
      en: readLocaleDict('en'),
    });
  }, 'nudge: locale');

  ctx.effect(function () {
    return tabs.register({
      id: TAB_ID,
      kind: TAB_KIND,
      multiple: true,
      keepMounted: true,
      priority: 'extension',
      title: function () {
        return t('tab.title');
      },
    });
  }, 'nudge: tab type');

  slots.inject('sidebar.right.pane.tab', function () {
    return slots.register(
      {
        name: 'sidebar.right.pane.tab',
        key: TAB_ID,
        locale: NS,
      },
      function (props) {
        return React.createElement(NudgeBody, Object.assign({ ctx: ctx }, props));
      },
    );
  });

  // Tab chip: pair the product mark with the title, matching the shipped
  // Browser chip instead of leaving the Nudge tab without an icon.
  slots.inject('sidebar.right.pane.tab.title', function () {
    return slots.register(
      {
        name: 'sidebar.right.pane.tab.title',
        key: TAB_ID,
        locale: NS,
        inject: function () {
          return { t: t };
        },
      },
      function (props) {
        return React.createElement(NudgeTabTitle, Object.assign({ ctx: ctx }, props));
      },
    );
  });

  ctx.inject(['shortcuts'], function (scope) {
    scope.effect(function () {
      return installNudgeShortcuts(ctx, scope.shortcuts, t);
    }, 'nudge: shortcuts');
  });

  // Browser guide card: keep the shipped "open browser" action and add an
  // explicit Inspector choice on the same card.
  slots.inject('sidebar.right.tab.guide.entry', function () {
    return slots.register(
      {
        name: 'sidebar.right.tab.guide.entry',
        key: BROWSER_PROVIDER_ID,
        locale: NS,
      },
      function (props) {
        return React.createElement(BrowserGuideCard, Object.assign({ ctx: ctx }, props));
      },
    );
  });

  // Browser tab ⋮ menu: one row that opens the same page in the inspector.
  slots.inject('sidebar.right.tab.menu.item', function () {
    return slots.register(
      {
        name: 'sidebar.right.tab.menu.item',
        id: 'nudge-open-browser',
        order: 40,
        locale: NS,
      },
      function (props) {
        return React.createElement(BrowserTabMenuAction, Object.assign({ ctx: ctx }, props));
      },
    );
  });

  // Link (URL) context menu: open the linked page in the inspector, keeping
  // the URL the chat link already carries. The host menu is owned by
  // open-in-app; registering another target:'url' provider appends one action.
  // Every surface that names the product uses the same mark: the tab chip, the
  // browser chooser row, this link menu and the settings navigation.
  slots.inject('contextMenu.icon', function* () {
    yield slots.register(
      { name: 'contextMenu.icon', key: 'nudge.open' },
      function () {
        return React.createElement(Icon.nudge, { size: 13 });
      },
    );
  });

  ctx.inject(['contextMenus'], function (scope) {
    scope.effect(function () {
      // Message links (URL target): open the exact URL in an inspector tab.
      var disposeUrl = scope.contextMenus.register({
        id: 'nudge.url',
        target: 'url',
        order: 90,
        resolve: function (target) {
          if (pluginConfigValues().contextMenuLink !== true) return [];
          var sessionId = target && target.sessionId ? target.sessionId : '';
          var url = target && typeof target.url === 'string' ? target.url : '';
          return [
            {
              id: 'nudge',
              icon: { key: 'nudge.open' },
              label: t('link.openInspector'),
              disabled: url === '' || ctx.sidebarRightTabs.get(TAB_KIND) === undefined,
              run: function () {
                ctx.sidebarRight.openTabIn(sessionId, TAB_KIND, { params: { url: url } });
              },
            },
          ];
        },
      });
      // File mentions (file target): only HTML files, opened through the
      // session preview server so a workspace path becomes a real page URL.
      var disposeFile = scope.contextMenus.register({
        id: 'nudge.file',
        target: 'file',
        order: 90,
        resolve: function (target) {
          if (pluginConfigValues().contextMenuLink !== true) return [];
          var sessionId = target && target.sessionId ? target.sessionId : '';
          var path = target && typeof target.path === 'string' ? target.path : '';
          if (sessionId === '' || !isHtmlWorkspacePath(path)) return [];
          return [
            {
              id: 'nudge',
              icon: { key: 'nudge.open' },
              label: t('link.openInspector'),
              disabled: ctx.sidebarRightTabs.get(TAB_KIND) === undefined,
              run: function () {
                openWorkspaceFileInNudge(ctx, sessionId, path);
              },
            },
          ];
        },
      });
      return function () {
        disposeUrl();
        disposeFile();
      };
    }, 'nudge: link context menu');
  });

  slots.inject('conversation.input.overlay', function () {
    return slots.register(
      {
        name: 'conversation.input.overlay',
        id: 'nudge-clips',
        order: 35,
        label: function () {
          return t('clip.chipTitle');
        },
        locale: NS,
      },
      function (props) {
        return React.createElement(ClipAnnotationTray, Object.assign({ ctx: ctx, t: t }, props));
      },
    );
  });

  // Settings → 轻推: the plugin's own page in the settings navigation, plus its
  // nav glyph in the same id so the shell pairs them.
  slots.inject('settings.section', function () {
    return slots.register(
      {
        name: 'settings.section',
        id: SETTINGS_SECTION_ID,
        order: SETTINGS_SECTION_ORDER,
        label: function () {
          return t('settings.nav');
        },
        locale: NS,
        inject: function () {
          return { t: t };
        },
      },
      function (props) {
        return React.createElement(NudgeSettingsSection, Object.assign({}, props, { ctx: ctx, t: t }));
      },
    );
  });

  slots.inject('settings.section.icon', function () {
    return slots.register(
      {
        name: 'settings.section.icon',
        id: SETTINGS_SECTION_ID,
        order: SETTINGS_SECTION_ORDER,
        label: function () {
          return t('settings.nav');
        },
      },
      function (props) {
        var size = props && typeof props.size === 'number' ? props.size : 16;
        return React.createElement(Icon.nudge, { size: size });
      },
    );
  });

  // `conversation` is a root singleton (one raw service instance for the whole
  // app), so this root injection normally fires and installs the wrapper once
  // at startup. The Session-scoped path (installClipSendForSession) is kept as
  // idempotent insurance: it resolves the same raw instance through the Session
  // scope and only republishes the dispatcher.
  ctx.effect(function () {
    return function () {
      clientDebugLog('apply.dispose', {});
      restoreClipSendHooks();
    };
  }, 'nudge: clip send hooks');

  // HMR recovery. A reload tears down the old fiber (its send wrapper is
  // restored) before the new module instance applies, so re-install for every
  // Session that already holds pending cards — independently of when the
  // composer tray remounts. Failures are retried by design and never throw here.
  try {
    clipPendingSessionIds().forEach(function (sessionId) {
      clientDebugLog('apply.reinstall', { sessionId: sessionId });
      installClipSendForSession(ctx, sessionId);
    });
  } catch (error) {
    clientDebugLog('apply.reinstall.failed', { message: String(error && error.message ? error.message : error) });
  }

  clientDebugLog('root.inject.request', {});
  ctx.inject(['conversation'], function (scope) {
    clientDebugLog('root.inject.hit', {});
    scope.effect(function () {
      return installClipSend(scope);
    }, 'nudge: clip send');
  });
}

// --------------------------------------------------- client diagnostics

/**
 * Diagnostics bridge: JSONL records land in `~/.dsh/nudge/client-debug.log`
 * through the Host `nudge/debugLog` RPC. Every failure is swallowed — a broken
 * diagnostics channel must never influence the send path or the UI.
 */
function clientDebugLog(event, detail) {
  try {
    var ctx = clientDebugContext;
    if (!ctx || typeof createRemote !== 'function') return;
    var connection = ctx.connection;
    if (!connection || !connection.rpc || typeof connection.rpc.call !== 'function') return;
    if (clientDebugRemoteOwner !== ctx || clientDebugRemote === null) {
      clientDebugRemote = createRemote(ctx);
      clientDebugRemoteOwner = ctx;
    }
    var entry = {
      ts: Date.now(),
      iso: new Date().toISOString(),
      instance: clientDebugInstance,
      event: String(event),
    };
    if (detail !== undefined && detail !== null && typeof detail === 'object') {
      try {
        entry.detail = JSON.parse(JSON.stringify(detail));
      } catch (error) {
        entry.detail = String(detail);
      }
    } else if (detail !== undefined && detail !== null) {
      entry.detail = String(detail);
    }
    var pending = clientDebugRemote('debugLog', entry);
    if (pending && typeof pending.catch === 'function') pending.catch(function () {});
  } catch (error) {
    /* diagnostics never throw into the send path */
  }
}

function setClientDebugContext(ctx) {
  clientDebugContext = ctx || null;
  if (clientDebugRemoteOwner !== clientDebugContext) {
    clientDebugRemote = null;
    clientDebugRemoteOwner = null;
  }
}

// ------------------------------------------------------- clip send hook

/**
 * Own properties that identify one stable send wrapper.
 *
 * They are read *through* the cordis traceable Proxy: property reads fall
 * through to the wrapped function itself, so a property-value comparison works
 * where a function-identity comparison never can (every `service.sendSession`
 * read returns a fresh shadow-method Proxy). The stable token is deliberately
 * page-wide: a new module instance must recognise an older instance's stable
 * wrapper and only republish the dispatcher, never chain a second wrapper.
 * The owner record marks the exact install for the unload restore.
 */
var CLIP_SEND_WRAPPER_MARK = '__dshnudgeClipSend';
var CLIP_SEND_STABLE_MARK = '__dshnudgeClipStable';
var CLIP_SEND_OWNER_MARK = '__dshnudgeClipOwner';
var CLIP_SEND_STABLE_TOKEN = 'dshnudge:clip-send:stable:v1';

/** Header that starts `buildClipContext`; never append the context twice. */
var CLIP_CONTEXT_HEADER = '【Visual Inspector · 网页标注与视觉修改】';

/** Cordis symbol that exposes the raw service instance behind a Proxy. */
var CORDIS_ORIGINAL_SYMBOL = (function () {
  try {
    return typeof Symbol === 'function' && typeof Symbol.for === 'function' ? Symbol.for('cordis.original') : null;
  } catch (error) {
    return null;
  }
})();

/** Live send wrappers installed by *this* module instance (restored on unload). */
var clipSendRestorers = [];

/** Pending install retries keyed by Session id (tokens invalidate old timers). */
var clipSendRetries = {};

/** Cleared on unload so a queued retry cannot resurrect the wrapper. */
var clipSendModuleAlive = true;

/** Identity of this module instance; guards the shared dispatcher on unload. */
var clipSendModuleToken = { instance: clientDebugInstance };

/**
 * The send-hook slice of the shared Client state (same page-wide record as the
 * clip store). Fields are mutated in place: a wrapper installed by an older
 * module instance holds this exact object, so replacing it would hide every
 * later dispatcher update from that wrapper.
 */
function clipSendState() {
  var state = clientStateStore();
  var send = state.send;
  if (!send || typeof send !== 'object') {
    send = { dispatch: null, originalSendSession: null, installs: 0, adopted: 0, chains: 0 };
    state.send = send;
  }
  if (typeof send.installs !== 'number') send.installs = 0;
  if (typeof send.adopted !== 'number') send.adopted = 0;
  if (typeof send.chains !== 'number') send.chains = 0;
  // One original method per conversation service: a page can host more than one
  // (and test doubles differ), so the direct-call target must never be shared.
  if (send.originals === undefined && typeof WeakMap === 'function') send.originals = new WeakMap();
  return send;
}

/** The recorded untouched method for one raw conversation service (or null). */
function clipRecordedOriginalSend(state, raw) {
  try {
    if (state && state.originals && raw && typeof raw === 'object') {
      var recorded = state.originals.get(raw);
      if (typeof recorded === 'function') return recorded;
    }
  } catch (error) {
    /* a non-object key cannot be tracked */
  }
  return null;
}

/** The raw cordis service behind a traceable Proxy (or the value itself). */
function clipRawService(service) {
  try {
    if (CORDIS_ORIGINAL_SYMBOL && service && service[CORDIS_ORIGINAL_SYMBOL]) return service[CORDIS_ORIGINAL_SYMBOL];
  } catch (error) {
    /* plain object or exotic Proxy: use it as-is */
  }
  return service;
}

/** One own-property value, read without going through a Proxy trap. */
function clipOwnValue(object, key) {
  if (!object) return undefined;
  try {
    var descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor ? descriptor.value : undefined;
  } catch (error) {
    return undefined;
  }
}

/** Read one wrapper marker (works through the cordis shadow-method Proxy). */
function clipSendMark(wrapper, mark) {
  if (!wrapper || typeof wrapper !== 'function') return undefined;
  try {
    return wrapper[mark];
  } catch (error) {
    return undefined;
  }
}

/** Session id from the shapes DSH passes to `sendSession`. */
function clipSendSessionId(session) {
  if (!session) return '';
  var value = session.sessionId !== undefined && session.sessionId !== null ? session.sessionId : session.id;
  return String(value === undefined || value === null ? '' : value);
}

/** The raw `sendSession` this install replaced, used by the unload restore. */
function clipPreviousSendSession(raw) {
  return clipOwnValue(raw, 'sendSession');
}

/** First `sendSession` on the service prototype chain (the original method). */
function clipPrototypeSendSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  try {
    var proto = Object.getPrototypeOf(raw);
    for (var guard = 0; proto && proto !== Object.prototype && guard < 16; guard += 1) {
      var descriptor = Object.getOwnPropertyDescriptor(proto, 'sendSession');
      if (descriptor && typeof descriptor.value === 'function') return descriptor.value;
      proto = Object.getPrototypeOf(proto);
    }
  } catch (error) {
    /* fall through */
  }
  return null;
}

/**
 * `sendSession` handler the stable wrapper runs on every send. It always calls
 * the newest implementation published by the newest module instance, reserves
 * the pending batch before the Host call and restores it on any failure.
 */
function clipSendDispatch(call) {
  var session = call.session;
  var text = call.text;
  var sessionId = clipSendSessionId(session);
  var trimmed = typeof text === 'string' ? text : '';
  try {
    if (sessionId === '' || /^\s*\//.test(trimmed)) {
      clientDebugLog('send.passthrough', {
        sessionId: sessionId,
        reason: sessionId === '' ? 'no-session' : 'slash-command',
        textLen: trimmed.length,
      });
      return Promise.resolve(clipCallOriginalSend(call, trimmed));
    }
    var taken = takeClipBatch(sessionId);
    if (!taken) {
      clientDebugLog('send.passthrough', {
        sessionId: sessionId,
        reason: 'no-pending-batch',
        textLen: trimmed.length,
      });
      return Promise.resolve(clipCallOriginalSend(call, trimmed));
    }
    clientDebugLog('send.take', {
      sessionId: sessionId,
      clips: taken.clips.length,
      ops: taken.ops.length,
      textLen: trimmed.length,
    });
    var context = buildClipContext(taken.clips, taken.ops);
    // A caller may already have inserted the context into the draft (the
    // session input quote fallback); never append it twice.
    var payload =
      trimmed.indexOf(CLIP_CONTEXT_HEADER) >= 0
        ? trimmed
        : trimmed.trim() === ''
          ? context
          : trimmed + '\n\n' + context;
    var pending;
    try {
      pending = clipCallOriginalSend(call, payload);
    } catch (error) {
      restoreClipBatch(sessionId, taken);
      clientDebugLog('send.result.threw', { sessionId: sessionId, message: String(error && error.message ? error.message : error) });
      throw error;
    }
    return Promise.resolve(pending).then(
      function (result) {
        if (!result || result.kind !== 'success') {
          restoreClipBatch(sessionId, taken);
          clientDebugLog('send.result.rejected', {
            sessionId: sessionId,
            kind: result && result.kind ? String(result.kind) : 'unknown',
          });
        } else {
          markOpsConsumed(taken.ops);
          clientDebugLog('send.result.ok', { sessionId: sessionId, clips: taken.clips.length, ops: taken.ops.length });
        }
        return result;
      },
      function (error) {
        restoreClipBatch(sessionId, taken);
        clientDebugLog('send.result.error', { sessionId: sessionId, message: String(error && error.message ? error.message : error) });
        throw error;
      },
    );
  } catch (error) {
    clientDebugLog('send.dispatch.failed', { sessionId: sessionId, message: String(error && error.message ? error.message : error) });
    throw error;
  }
}

/** Call the untouched original method (never an older wrapper on the chain). */
function clipCallOriginalSend(call, payload) {
  var args = [call.session, payload, call.attachmentIds, call.mode, call.signal, call.accept];
  if (typeof call.original === 'function') return call.original.apply(call.self, args);
  var recorded = clipRecordedOriginalSend(call.state, clipRawService(call.service));
  if (typeof recorded === 'function') return recorded.apply(call.self, args);
  // Last resort (an unidentifiable stale wrapper with no recoverable original):
  // the chain inner still sends the message, just without the clip context.
  return call.inner.apply(call.self, args);
}

/**
 * Build one page-stable `sendSession` wrapper around `inner`.
 *
 * The wrapper never calls `inner` on the normal path: it reads the dispatcher
 * from the shared state on every call, so the implementation of the newest
 * module instance serves sends even when the wrapper itself was installed by an
 * older one (HMR). `inner` is kept only as a fallback for an unidentifiable
 * chain and for when the plugin has been unloaded.
 */
function createClipSendWrapper(state, inner, original, service) {
  var owner = { instance: clientDebugInstance, createdAt: Date.now() };

  function sendWithClips(session, text, attachmentIds, mode, signal, accept) {
    var dispatch = state.dispatch;
    // No live implementation (the plugin row is unloading): pass through.
    if (typeof dispatch !== 'function') return inner.apply(this, arguments);
    var call = {
      state: state,
      inner: inner,
      original: original,
      service: service,
      owner: owner,
      self: this,
      session: session,
      text: text,
      attachmentIds: attachmentIds,
      mode: mode,
      signal: signal,
      accept: accept,
    };
    return dispatch(call);
  }

  try {
    sendWithClips[CLIP_SEND_WRAPPER_MARK] = true;
    sendWithClips[CLIP_SEND_STABLE_MARK] = CLIP_SEND_STABLE_TOKEN;
    sendWithClips[CLIP_SEND_OWNER_MARK] = owner;
  } catch (error) {
    /* a frozen function is still callable; markers are diagnostics/restore-only */
  }
  return { wrapper: sendWithClips, owner: owner };
}

/** Unwrap exactly the wrapper this install created (never a newer one). */
function restoreClipSendOn(raw, record, previous) {
  try {
    var current = clipOwnValue(raw, 'sendSession');
    var stable = clipSendMark(current, CLIP_SEND_STABLE_MARK) === CLIP_SEND_STABLE_TOKEN;
    var mine = clipSendMark(current, CLIP_SEND_OWNER_MARK) === record.owner;
    if (!stable || !mine) {
      clientDebugLog('restore.skip', { reason: stable ? 'not-owner' : 'not-a-stable-wrapper' });
      return false;
    }
    if (previous === undefined || previous === null) {
      try {
        delete raw.sendSession;
      } catch (error) {
        /* frozen service: restoring the prototype method is impossible */
      }
    } else {
      raw.sendSession = previous;
    }
    return true;
  } catch (error) {
    clientDebugLog('restore.failed', { message: String(error && error.message ? error.message : error) });
    return false;
  }
}

/**
 * Install (or adopt) the stable `sendSession` wrapper for one conversation
 * service. Three branches, all reported to the diagnostics log:
 *
 *   a) a stable wrapper is already installed (any module instance) → only
 *      republish `state.dispatch`, never chain a second wrapper;
 *   b) a pre-fix / foreign wrapper is installed → chain exactly one stable
 *      wrapper around it, remembering the real original method separately;
 *   c) no wrapper → install the stable wrapper and remember the original.
 *
 * Returns the restore callback for a fresh install, `null` when the service is
 * unusable (the caller may retry), or a no-op for the adopted branch.
 */
function installClipSendOn(service) {
  var state = clipSendState();
  // Publish first: an older stable wrapper reads `state.dispatch` on its next
  // send, which is what makes HMR take effect even before this instance wraps.
  // The owner token lets unload clear only its own dispatcher.
  state.dispatch = clipSendDispatch;
  state.dispatchOwner = clipSendModuleToken;
  if (!service) {
    clientDebugLog('install.branch', { ok: false, reason: 'no-conversation-service' });
    return null;
  }
  var raw = clipRawService(service);
  var current = null;
  try {
    current = service.sendSession;
  } catch (error) {
    current = null;
  }
  if (typeof current !== 'function') {
    clientDebugLog('install.branch', { ok: false, reason: 'sendSession-unavailable' });
    return null;
  }

  var branch = 'c';
  if (clipSendMark(current, CLIP_SEND_STABLE_MARK) === CLIP_SEND_STABLE_TOKEN) branch = 'a';
  else if (clipSendMark(current, CLIP_SEND_WRAPPER_MARK) === true) branch = 'b';

  if (branch === 'a') {
    state.adopted += 1;
    clientDebugLog('install.branch', { branch: 'a', action: 'dispatch-only', adopted: state.adopted });
    return function () {};
  }

  var previous = clipPreviousSendSession(raw);
  var original;
  if (branch === 'b') {
    // The stale wrapper hides the real method; recover it from the prototype
    // (cordis services) or from an earlier install of this same service.
    original = clipPrototypeSendSession(raw) || clipRecordedOriginalSend(state, raw);
    state.chains += 1;
  } else {
    original = current;
    if (state.originals) {
      try {
        state.originals.set(raw, original);
      } catch (error) {
        /* not a WeakMap key: the wrapper still carries the original */
      }
    }
    if (typeof state.originalSendSession !== 'function') state.originalSendSession = original;
  }

  var record = createClipSendWrapper(state, current, original, service);
  var installed = false;
  try {
    raw.sendSession = record.wrapper;
    installed = clipOwnValue(raw, 'sendSession') === record.wrapper;
  } catch (error) {
    installed = false;
  }
  if (!installed) {
    clientDebugLog('install.branch', { branch: branch, ok: false, reason: 'assignment-rejected', chained: branch === 'b' });
    return null;
  }

  state.installs += 1;
  clientDebugLog('install.branch', {
    branch: branch,
    ok: true,
    installs: state.installs,
    chained: branch === 'b',
    hasOriginal: typeof original === 'function',
  });
  var restorer = function () {
    return restoreClipSendOn(raw, record, previous);
  };
  clipSendRestorers.push(restorer);
  return restorer;
}

/**
 * Wrap the conversation service reached through a root `conversation` scope.
 * `conversation` is a root singleton, so this normally runs once at plugin
 * startup and covers every Session; the Session-scoped installer is a second,
 * idempotent path to the same raw service.
 */
function installClipSend(scope) {
  var service = null;
  try {
    service = scope && typeof scope.get === 'function' ? scope.get('conversation') : null;
  } catch (error) {
    service = null;
  }
  clientDebugLog('root.inject.service', {
    resolved: !!service,
    hasSendSession: !!(service && typeof service.sendSession === 'function'),
  });
  var restore = installClipSendOn(service);
  return typeof restore === 'function' ? restore : function () {};
}

/**
 * Retry a failed install a few times while the Session still holds pending
 * cards (the Session scope / conversation service can appear slightly after
 * the cards are inserted). Attempts are 200ms/400ms/800ms apart.
 */
function scheduleClipSendRetry(ctx, sessionId, attempt) {
  if (!clipSendModuleAlive || attempt > 3 || typeof setTimeout !== 'function') return;
  var token = (clipSendRetries[sessionId] || 0) + 1;
  clipSendRetries[sessionId] = token;
  var delay = 200 * Math.pow(2, attempt - 1);
  clientDebugLog('session.install.retry', { sessionId: sessionId, attempt: attempt, delay: delay });
  setTimeout(function () {
    if (!clipSendModuleAlive || clipSendRetries[sessionId] !== token) return;
    delete clipSendRetries[sessionId];
    installClipSendForSession(ctx, sessionId, attempt);
  }, delay);
}

/** Restore every wrapper this module instance installed. */
function restoreClipSendHooks() {
  clipSendModuleAlive = false;
  clipSendRetries = {};
  var restorers = clipSendRestorers.splice(0);
  var restored = 0;
  for (var index = restorers.length - 1; index >= 0; index -= 1) {
    try {
      if (restorers[index]()) restored += 1;
    } catch (error) {
      /* the Session scope may already be disposed */
    }
  }
  // Never leave a dispatcher behind that closes over this unloaded module
  // instance. Only the instance that published it may clear it: a newer module
  // instance (HMR) may already own the shared state.
  var state = clipSendState();
  var cleared = false;
  if (state.dispatchOwner === clipSendModuleToken) {
    state.dispatch = null;
    state.dispatchOwner = null;
    cleared = true;
  }
  clientDebugLog('hooks.restore', { installed: restorers.length, restored: restored, dispatchCleared: cleared });
}

/**
 * Resolve `conversation` through a Session scope and make sure its wrapper is
 * installed. The service is a root singleton, so this usually adopts the root
 * injection's wrapper; it still runs when a Session gains clip cards (and after
 * a hot reload) as idempotent insurance, resolving the same raw instance
 * through `sessions.scope(sessionId)`. Failures are logged and retried; this
 * never throws.
 */
function installClipSendForSession(ctx, sessionId, attempt) {
  setClientDebugContext(ctx);
  var id = String(sessionId === null || sessionId === undefined ? '' : sessionId);
  var tries = typeof attempt === 'number' && attempt > 0 ? attempt : 0;
  if (id === '') {
    clientDebugLog('session.install.fail', { reason: 'empty-session' });
    return false;
  }
  var reason = 'unknown';
  try {
    var sessions = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : null;
    if (!sessions || typeof sessions.scope !== 'function') {
      reason = 'no-sessions-service';
    } else {
      var scope = sessions.scope(id);
      if (!scope) {
        reason = 'no-session-scope';
      } else {
        var service = typeof scope.get === 'function' ? scope.get('conversation') : null;
        clientDebugLog('session.install.service', {
          sessionId: id,
          resolved: !!service,
          hasSendSession: !!(service && typeof service.sendSession === 'function'),
        });
        if (!service || typeof service.sendSession !== 'function') {
          reason = 'no-conversation-service';
        } else {
          var restore = installClipSendOn(service);
          if (restore !== null) {
            clientDebugLog('session.install.ok', { sessionId: id, attempt: tries });
            return true;
          }
          reason = 'install-failed';
        }
      }
    }
  } catch (error) {
    reason = 'threw:' + String(error && error.message ? error.message : error);
  }
  clientDebugLog('session.install.fail', { sessionId: id, reason: reason, attempt: tries });
  if (clipPendingCount(id) > 0) scheduleClipSendRetry(ctx, id, tries + 1);
  return false;
}

/** Locale dictionaries are embedded at build time by scripts/build-client.mjs. */
function readLocaleDict(id) {
  if (id === 'zh') return NUDGE_LOCALE_ZH;
  return NUDGE_LOCALE_EN;
}
