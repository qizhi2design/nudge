// @ts-nocheck
/**
 * Browser integration entry points:
 *
 *  1. Replace the shipped Browser guide card with a version that keeps the
 *     original "open browser" action and adds one explicit "Inspector" action,
 *     so clicking Browser offers both choices.
 *  2. Append "Open in Visual Inspector" to a Browser tab's ⋮ menu, carrying the
 *     tab's current URL into the new inspector tab.
 *
 * Both paths reuse the existing right-Sidebar services; no shipped package is
 * modified and no slot outside these documented extension seats is touched.
 */

var BROWSER_KIND = 'browser';
var BROWSER_PROVIDER_ID = '@deepseek-ai/dsh-client-ui-sidebar-browser';

/** Read the current navigation URL of one committed browser tab, if known. */
function browserTabUrl(ctx, sessionId, tab) {
  try {
    var domain = ctx.sidebarRight && ctx.sidebarRight.tabDomain;
    if (!domain || typeof domain.occurrence !== 'function') return null;
    var occurrence = domain.occurrence(sessionId, tab);
    var navigation = occurrence && occurrence.navigation ? occurrence.navigation.getSnapshot() : null;
    var params = navigation && navigation.params ? navigation.params : null;
    var url = params && params.url;
    return isHttpUrl(url) ? url : null;
  } catch (error) {
    return null;
  }
}

/** Prefer the most recently committed browser tab's URL for guide-level opens. */
function lastBrowserUrl(ctx, sessionId) {
  try {
    var tabs = ctx.sidebarRight && typeof ctx.sidebarRight.tabsIn === 'function' ? ctx.sidebarRight.tabsIn(sessionId) : [];
    for (var index = tabs.length - 1; index >= 0; index -= 1) {
      var tab = tabs[index];
      if (!tab || tab.kind !== BROWSER_KIND) continue;
      var url = browserTabUrl(ctx, sessionId, tab);
      if (url !== null) return url;
    }
  } catch (error) {
    /* ignore */
  }
  return null;
}

/** Open the inspector, optionally continuing the given page. */
function openNudge(ctx, sessionId, tab) {
  var url = tab ? browserTabUrl(ctx, sessionId, tab) : lastBrowserUrl(ctx, sessionId);
  try {
    ctx.sidebarRight.openTab(TAB_KIND, { params: url === null ? {} : { url: url } });
  } catch (error) {
    console.error('[dsh-nudge] cannot open the inspector tab', error);
  }
}

/**
 * The Browser guide card: clicking it opens a small chooser with two explicit
 * actions — open the shipped Browser, or activate the Visual Inspector. The
 * card keeps the shipped layout, title and description.
 */
function BrowserGuideCard(props) {
  var theme = useDshTheme(props.ctx);
  var t = props.t;
  var [hover, setHover] = React.useState(false);
  var [menuOpen, setMenuOpen] = React.useState(false);
  var rootRef = React.useRef(null);
  var tabInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo() : null;
  var guideTab = tabInfo && tabInfo.tab ? tabInfo.tab : null;
  var kind = props.kind || BROWSER_KIND;

  React.useEffect(function () {
    if (!menuOpen) return undefined;
    function onPointerDown(event) {
      if (rootRef.current !== null && !rootRef.current.contains(event.target)) setMenuOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return function () {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  function openBrowser() {
    setMenuOpen(false);
    if (guideTab && guideTab.actions) {
      guideTab.actions.openTab(kind, { replaceTab: true });
      guideTab.actions.close();
      return;
    }
    try {
      props.ctx.sidebarRight.openTab(kind);
    } catch (error) {
      console.error('[dsh-nudge] cannot open the browser tab', error);
    }
  }

  function openInspector() {
    setMenuOpen(false);
    openNudge(props.ctx, guideTab && guideTab.sessionId ? guideTab.sessionId : props.sessionId, null);
  }

  var rowStyle = function (danger) {
    return {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      width: '100%',
      height: 34,
      boxSizing: 'border-box',
      padding: '0 10px',
      border: 'none',
      borderRadius: 'var(--dsw-radius-sm, 6px)',
      background: 'transparent',
      color: danger ? theme.danger : theme.text,
      font: 'var(--dsw-font-xxs-12, 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
      textAlign: 'left',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    };
  };

  function MenuRow(props2) {
    var [rowHover, setRowHover] = React.useState(false);
    return React.createElement(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        onClick: props2.onPick,
        onMouseEnter: function () { setRowHover(true); },
        onMouseLeave: function () { setRowHover(false); },
        style: Object.assign(rowStyle(), { background: rowHover ? 'var(--dsw-alias-interactive-bg-hover, ' + (theme.hover || theme.layer2) + ')' : 'transparent' }),
      },
      React.createElement('span', { style: { color: theme.muted, display: 'inline-flex', flex: 'none' } }, props2.icon),
      React.createElement(
        'span',
        { style: { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 } },
        React.createElement('span', null, props2.label),
        props2.hint ? React.createElement('span', { style: { color: theme.muted, fontSize: 10.5, lineHeight: 1.3 } }, props2.hint) : null,
      ),
    );
  }

  return React.createElement(
    'div',
    { ref: rootRef, style: { position: 'relative', width: '100%' } },
    React.createElement(
      'div',
      {
        onMouseEnter: function () { setHover(true); },
        onMouseLeave: function () { setHover(false); },
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          minHeight: 56,
          boxSizing: 'border-box',
          padding: '10px 12px 10px 20px',
          background: hover || menuOpen ? 'var(--dsw-alias-interactive-bg-hover, ' + (theme.hover || theme.layer2) + ')' : theme.layer1,
          border: '0.5px solid ' + (menuOpen ? theme.brand : 'var(--dsw-alias-border-l3, ' + (theme.borderStrong || theme.border) + ')'),
          borderRadius: 'var(--dsw-radius-xl, 12px)',
          color: theme.text,
        },
      },
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: function () { setMenuOpen(function (open) { return !open; }); },
          title: t('browser.chooseAction'),
          'aria-haspopup': 'menu',
          'aria-expanded': menuOpen,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flex: 1,
            minWidth: 0,
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
            font: 'inherit',
          },
        },
        React.createElement(
          'span',
          { style: { width: 26, height: 26, color: theme.muted, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' } },
          React.createElement(Icon.globe, { size: 24 }),
        ),
        React.createElement(
          'span',
          { style: { display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 } },
          React.createElement(
            'span',
            { style: { fontSize: 14, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            props.title,
          ),
          props.description
            ? React.createElement(
                'span',
                { style: { color: 'var(--dsw-alias-label-tertiary, ' + theme.muted + ')', fontSize: 11, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                props.description,
              )
            : null,
        ),
      ),
      React.createElement(
        'span',
        { style: { color: theme.muted, display: 'inline-flex', flex: 'none', transform: menuOpen ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform 120ms ease' } },
        React.createElement(Icon.chevron, { size: 13 }),
      ),
    ),
    menuOpen
      ? React.createElement(
          'div',
          {
            role: 'menu',
            style: {
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              zIndex: 30,
              padding: 4,
              background: 'var(--dsw-alias-bg-overlay, ' + theme.overlay + ')',
              border: '1px solid var(--dsw-alias-border-l2, ' + (theme.borderStrong || theme.border) + ')',
              borderRadius: 'var(--dsw-radius-md, 8px)',
              boxShadow: 'var(--dsw-elevation-prominent, 0 8px 24px rgba(0, 0, 0, 0.35))',
            },
          },
          React.createElement(MenuRow, {
            label: t('browser.openBrowser'),
            hint: t('browser.openBrowserHint'),
            icon: React.createElement(Icon.globe, { size: 14 }),
            onPick: openBrowser,
          }),
          React.createElement(MenuRow, {
            label: t('browser.activateInspector'),
            hint: t('browser.activateInspectorHint'),
            icon: React.createElement(Icon.cursor, { size: 14 }),
            onPick: openInspector,
          }),
        )
      : null,
  );
}

/** One row in a Browser tab's ⋮ menu. Renders nothing for other kinds. */
function BrowserTabMenuAction(props) {
  var theme = useDshTheme(props.ctx);
  var t = props.t;
  var tab = props.tab;
  if (!tab || tab.kind !== BROWSER_KIND) return null;
  var [hover, setHover] = React.useState(false);

  function run() {
    if (typeof props.dismiss === 'function') props.dismiss();
    openNudge(props.ctx, props.sessionId, tab);
  }

  return React.createElement(
    'button',
    {
      type: 'button',
      role: 'menuitem',
      onClick: run,
      onMouseEnter: function () { setHover(true); },
      onMouseLeave: function () { setHover(false); },
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        height: 28,
        boxSizing: 'border-box',
        padding: '0 10px',
        marginTop: 2,
        border: 'none',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        background: hover ? 'var(--dsw-alias-interactive-bg-hover, ' + (theme.hover || theme.layer2) + ')' : 'transparent',
        color: theme.text,
        font: 'var(--dsw-font-xxs-12, 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
        textAlign: 'left',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
    },
    React.createElement(Icon.cursor, { size: 12 }),
    React.createElement('span', null, t('browser.openInspector')),
  );
}
