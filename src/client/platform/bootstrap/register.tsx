// @ts-nocheck
/**
 * Registrations: the right-Sidebar tab type and body, the browser guide card
 * (whose submenu opens the inspector), the browser tab menu action, the URL
 * context menu entry, the global open shortcut, and the composer clip tray.
 * Everything is registered through `ctx.effect` so disposal is exact.
 */

function apply(ctx) {
  var locale = ctx.locale;
  var slots = ctx.slots;
  var tabs = ctx.sidebarRightTabs;
  var sidebarRight = ctx.sidebarRight;
  var t = createPluginTranslator(locale.bind(NS));

  // Mirror the product preferences (language, feature switches, context-menu
  // switches) into the Client store. Defaults apply until this resolves.
  loadPluginConfig(ctx);

  ensureGlobalStyles();

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

  ctx.inject(['shortcuts'], function (scope) {
    scope.effect(function () {
      return scope.shortcuts.register({
        id: 'nudge.open',
        label: function () {
          return t('shortcut.open');
        },
        aliases: ['visual inspector', 'inspect page', 'annotate page'],
        defaults: {
          'desktop:macos': { code: 'KeyI', modifiers: ['primary', 'shift'] },
          'desktop:windows': { code: 'KeyI', modifiers: ['primary', 'shift'] },
          'desktop:linux': { code: 'KeyI', modifiers: ['primary', 'shift'] },
          'web:macos': { code: 'KeyI', modifiers: ['primary', 'shift'] },
          'web:windows': { code: 'KeyI', modifiers: ['primary', 'shift'] },
        },
        regions: ['page', 'editable', 'terminal'],
        modals: [],
        resolve: function (input) {
          var target = sidebarRight.commandTarget(input && input.target ? input.target : null);
          if (!target) {
            return { status: 'blocked', reason: t('shortcut.noSession') };
          }
          return {
            status: 'handled',
            run: function () {
              try {
                sidebarRight.openTabFromTarget(TAB_KIND, target);
              } catch (error) {
                console.error('[dsh-nudge] open tab failed', error);
              }
            },
          };
        },
      });
    }, 'nudge: shortcut');
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
  slots.inject('contextMenu.icon', function* () {
    yield slots.register(
      { name: 'contextMenu.icon', key: 'nudge.open' },
      function () {
        return React.createElement(Icon.cursor, { size: 13 });
      },
    );
  });

  ctx.inject(['contextMenus'], function (scope) {
    scope.effect(function () {
      return scope.contextMenus.register({
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
        return React.createElement(Icon.cursor, { size: size });
      },
    );
  });

  // Optional: older hosts may not expose the scoped conversation service, in
  // which case the cards still render and the plain composer send is used.
  ctx.inject(['conversation'], function (scope) {
    scope.effect(function () {
      return installClipSend(scope);
    }, 'nudge: clip send');
  });
}

// ------------------------------------------------------- clip send hook

/**
 * Wrap the session's `conversation.sendSession` so a message typed next to the
 * clip cards carries the same structured context the old one-shot prompt had.
 * The cards are reserved before the Host call and only dropped on acceptance.
 */
function installClipSend(scope) {
  var service = null;
  try {
    service = scope.get('conversation');
  } catch (error) {
    service = null;
  }
  if (!service || typeof service.sendSession !== 'function') return function () {};
  var original = service.sendSession;
  if (original && original.__dshnudgeClipSend === true) return function () {};

  function sendWithClips(session, text, attachmentIds, mode, signal, accept) {
    var sessionId = session && (session.sessionId || session.id) ? String(session.sessionId || session.id) : '';
    var trimmed = typeof text === 'string' ? text : '';
    if (sessionId === '' || /^\s*\//.test(trimmed)) return original.apply(this, arguments);
    var taken = takeClipBatch(sessionId);
    if (!taken) return original.apply(this, arguments);
    var context = buildClipContext(taken.clips, taken.ops);
    var payload = trimmed.trim() === '' ? context : trimmed + '\n\n' + context;
    var target = this;
    return Promise.resolve(original.call(target, session, payload, attachmentIds, mode, signal, accept)).then(
      function (result) {
        if (!result || result.kind !== 'success') restoreClipBatch(sessionId, taken);
        else markOpsConsumed(taken.ops);
        return result;
      },
      function (error) {
        restoreClipBatch(sessionId, taken);
        throw error;
      },
    );
  }
  sendWithClips.__dshnudgeClipSend = true;
  service.sendSession = sendWithClips;
  return function () {
    if (service.sendSession === sendWithClips) service.sendSession = original;
  };
}

/** Locale dictionaries are embedded at build time by scripts/build-client.mjs. */
function readLocaleDict(id) {
  if (id === 'zh') return NUDGE_LOCALE_ZH;
  return NUDGE_LOCALE_EN;
}
