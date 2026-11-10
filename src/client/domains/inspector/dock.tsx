// @ts-nocheck
/**
 * Right-hand inspector dock: exactly one panel at a time.
 *
 * DOM tree and Workspace used to be two independent side-by-side asides
 * (272px + 300px), which squeezed the page to nothing in a ~600px sidebar.
 * This dock gives both a shared frame with a top-level tab row, a single
 * close button, a draggable width (240–420px, remembered) and an overlay mode
 * for narrow panes where docking would leave the page unusably narrow.
 *
 * The dock is layout-only: the panels keep all their behaviour and are
 * rendered with `embedded: true`, which removes their own aside width/header.
 */

var NUDGE_DOCK_MIN_WIDTH = 240;
var NUDGE_DOCK_MAX_WIDTH = 420;
var NUDGE_DOCK_DEFAULT_WIDTH = 300;
var NUDGE_DOCK_NARROW = 760;
var NUDGE_DOCK_STORAGE_KEY = 'dsh.nudge.dockWidth';

function clampDockWidth(value) {
  var width = Number(value);
  if (!isFinite(width)) return NUDGE_DOCK_DEFAULT_WIDTH;
  return Math.max(NUDGE_DOCK_MIN_WIDTH, Math.min(NUDGE_DOCK_MAX_WIDTH, Math.round(width)));
}

function readDockWidth() {
  try {
    var raw = window.localStorage.getItem(NUDGE_DOCK_STORAGE_KEY);
    if (raw === null || raw === '') return NUDGE_DOCK_DEFAULT_WIDTH;
    return clampDockWidth(raw);
  } catch (error) {
    return NUDGE_DOCK_DEFAULT_WIDTH;
  }
}

function writeDockWidth(width) {
  try {
    window.localStorage.setItem(NUDGE_DOCK_STORAGE_KEY, String(clampDockWidth(width)));
  } catch (error) {
    /* storage may be unavailable; the width still applies for this tab */
  }
}

function NudgeDockTab(props) {
  var active = props.active === true;
  var theme = props.theme;
  return React.createElement(
    'button',
    {
      type: 'button',
      role: 'tab',
      'aria-selected': active,
      'aria-pressed': active,
      'data-dock-tab': props.id,
      onClick: props.onClick,
      title: props.label,
      style: {
        flex: '1 1 0',
        minWidth: 0,
        height: 24,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        padding: '0 6px',
        border: 'none',
        borderRadius: 5,
        background: active ? theme.hover || theme.layer2 : 'transparent',
        color: active ? theme.text : theme.muted,
        font: 'var(--dsw-font-xxxs-11, 11.5px/1.3 sans-serif)',
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      },
    },
    props.icon,
    React.createElement('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, props.label),
  );
}

function NudgeDockIconButton(props) {
  var theme = props.theme;
  return React.createElement(
    'button',
    {
      type: 'button',
      'aria-label': props.label,
      title: props.label,
      onClick: props.onClick,
      disabled: props.disabled === true,
      style: {
        width: 22,
        height: 22,
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        border: 'none',
        borderRadius: 5,
        background: 'transparent',
        color: theme.muted,
        cursor: props.disabled === true ? 'default' : 'pointer',
        opacity: props.disabled === true ? 0.4 : 1,
      },
    },
    props.icon,
  );
}

function NudgeDock(props) {
  var t = props.t;
  var theme = props.theme;
  var docked = props.docked === true;
  var active = props.active;
  var width = clampDockWidth(docked ? props.width : props.overlayWidth);
  var resizeState = React.useState(false);
  var resizing = resizeState[0];
  var setResizing = resizeState[1];
  var hoverState = React.useState(false);
  var handleHover = hoverState[0];
  var setHandleHover = hoverState[1];

  React.useEffect(
    function () {
      if (docked) return undefined;
      function onKeyDown(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof props.onClose === 'function') props.onClose();
      }
      document.addEventListener('keydown', onKeyDown, true);
      return function () {
        document.removeEventListener('keydown', onKeyDown, true);
      };
    },
    [docked, props.onClose],
  );

  function applyWidth(next) {
    var clamped = clampDockWidth(next);
    if (typeof props.onResize === 'function') props.onResize(clamped);
    return clamped;
  }

  function commitWidth(next) {
    var clamped = applyWidth(next);
    if (typeof props.onResizeEnd === 'function') props.onResizeEnd(clamped);
  }

  function beginResize(event) {
    if (!docked || event.button !== 0) return;
    event.preventDefault();
    var startX = event.clientX;
    var startWidth = width;
    var lastWidth = startWidth;
    setResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    function onMove(moveEvent) {
      lastWidth = clampDockWidth(startWidth + startX - moveEvent.clientX);
      applyWidth(lastWidth);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setResizing(false);
      commitWidth(lastWidth);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function onSeparatorKeyDown(event) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      commitWidth(width + 16);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      commitWidth(width - 16);
    } else if (event.key === 'Home') {
      event.preventDefault();
      commitWidth(NUDGE_DOCK_DEFAULT_WIDTH);
    }
  }

  var headerActions = [];
  if (active === 'workspace' && typeof props.onRefresh === 'function') {
    headerActions.push(
      React.createElement(NudgeDockIconButton, {
        key: 'refresh',
        theme: theme,
        label: t('workspace.refresh'),
        icon: React.createElement(Icon.reload, { size: 12 }),
        onClick: props.onRefresh,
      }),
    );
  }
  headerActions.push(
    React.createElement(NudgeDockIconButton, {
      key: 'close',
      theme: theme,
      label: t('dock.close'),
      icon: React.createElement(Icon.close, { size: 12 }),
      onClick: props.onClose,
    }),
  );

  var header = React.createElement(
    'div',
    {
      'data-dock-header': '',
      style: {
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        height: 34,
        padding: '0 6px 0 6px',
        borderBottom: '1px solid ' + (theme.borderStrong || theme.border),
        background: theme.base,
      },
    },
    React.createElement(
      'div',
      { role: 'tablist', 'aria-label': t('dock.tabs'), style: { flex: '1 1 auto', minWidth: 0, display: 'flex', gap: 2 } },
      active === 'dom' || props.showDom !== false
        ? React.createElement(NudgeDockTab, {
            id: 'dom',
            label: t('dom.title'),
            icon: React.createElement(Icon.dom, { size: 12 }),
            active: active === 'dom',
            theme: theme,
            onClick: function () {
              if (typeof props.onTab === 'function') props.onTab('dom');
            },
          })
        : null,
      active === 'workspace' || props.showWorkspace !== false
        ? React.createElement(NudgeDockTab, {
            id: 'workspace',
            label: t('workspace.title'),
            icon: React.createElement(Icon.branch, { size: 12 }),
            active: active === 'workspace',
            theme: theme,
            onClick: function () {
              if (typeof props.onTab === 'function') props.onTab('workspace');
            },
          })
        : null,
    ),
    headerActions,
  );

  var resizer = docked
    ? React.createElement('div', {
        'data-dock-resizer': '',
        role: 'separator',
        'aria-orientation': 'vertical',
        'aria-label': t('dock.resize'),
        'aria-valuemin': NUDGE_DOCK_MIN_WIDTH,
        'aria-valuemax': NUDGE_DOCK_MAX_WIDTH,
        'aria-valuenow': width,
        tabIndex: 0,
        onMouseDown: beginResize,
        onDoubleClick: function () {
          commitWidth(NUDGE_DOCK_DEFAULT_WIDTH);
        },
        onKeyDown: onSeparatorKeyDown,
        onMouseEnter: function () {
          setHandleHover(true);
        },
        onMouseLeave: function () {
          setHandleHover(false);
        },
        style: {
          position: 'absolute',
          left: -3,
          top: 0,
          bottom: 0,
          width: 6,
          zIndex: 3,
          cursor: 'col-resize',
          background: resizing || handleHover ? 'color-mix(in srgb, ' + (theme.accent || theme.brand) + ' 55%, transparent)' : 'transparent',
          borderRadius: 3,
          outline: 'none',
        },
      })
    : null;

  // While dragging, a full-viewport catcher keeps mousemove flowing even when
  // the pointer is over the embedded <webview>, which would otherwise swallow
  // host-document pointer events.
  var dragCatcher = resizing
    ? React.createElement('div', {
        key: 'drag-catcher',
        'data-dockkit-pointer': '',
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: 2147483000,
          cursor: 'col-resize',
          background: 'transparent',
        },
      })
    : null;

  return React.createElement(
    'aside',
    {
      'data-dsh-nudge-dock': '',
      'data-dock-mode': docked ? 'docked' : 'overlay',
      'aria-label': t('dock.tabs'),
      style: {
        position: docked ? 'relative' : 'absolute',
        top: docked ? undefined : 0,
        right: docked ? undefined : 0,
        bottom: docked ? undefined : 0,
        width: width,
        flex: docked ? 'none' : undefined,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        borderLeft: '1px solid ' + (theme.borderStrong || theme.border),
        background: theme.base,
        color: theme.text,
        zIndex: docked ? undefined : 40,
        boxShadow: docked ? 'none' : '-16px 0 40px rgba(15, 17, 21, 0.18)',
      },
    },
    resizer,
    dragCatcher,
    header,
    React.createElement('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } }, props.children),
  );
}
