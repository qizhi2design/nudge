// @ts-nocheck
/**
 * Small presentational primitives for the host UI. Icon glyphs come from the
 * Lucide set (bundled once by the UI entry and exposed as `VI_ICONS`); colors
 * resolve from DSH theme tokens captured by `readTheme()`.
 */

function lucideIcon(Component) {
  return function (props) {
    var options = props || {};
    var elementProps = {
      size: options.size || 14,
      style: Object.assign({ display: 'block', flex: 'none' }, options.style || {}),
      'aria-hidden': true,
      focusable: 'false',
    };
    if (options.stroke) elementProps.strokeWidth = options.stroke;
    return React.createElement(Component, elementProps);
  };
}

var Icon = {
  back: lucideIcon(VI_ICONS.ArrowLeft),
  forward: lucideIcon(VI_ICONS.ArrowRight),
  reload: lucideIcon(VI_ICONS.RotateCw),
  refresh: lucideIcon(VI_ICONS.RefreshCw),
  globe: lucideIcon(VI_ICONS.Globe),
  external: lucideIcon(VI_ICONS.ArrowUpRight),
  cursor: lucideIcon(VI_ICONS.MousePointer2),
  annotate: lucideIcon(VI_ICONS.MessageSquarePlus),
  edit: lucideIcon(VI_ICONS.Pencil),
  undo: lucideIcon(VI_ICONS.Undo2),
  redo: lucideIcon(VI_ICONS.Redo2),
  panel: lucideIcon(VI_ICONS.PanelRight),
  dom: lucideIcon(VI_ICONS.ListTree),
  branch: lucideIcon(VI_ICONS.GitBranch),
  commit: lucideIcon(VI_ICONS.GitCommitHorizontal),
  file: lucideIcon(VI_ICONS.FileCode2),
  close: lucideIcon(VI_ICONS.X),
  plus: lucideIcon(VI_ICONS.Plus),
  trash: lucideIcon(VI_ICONS.Trash2),
  locate: lucideIcon(VI_ICONS.LocateFixed),
  send: lucideIcon(VI_ICONS.Send),
  check: lucideIcon(VI_ICONS.Check),
  copy: lucideIcon(VI_ICONS.Copy),
  chevron: lucideIcon(VI_ICONS.ChevronRight),
  history: lucideIcon(VI_ICONS.History),
  spark: lucideIcon(VI_ICONS.Sparkles),
  mic: lucideIcon(VI_ICONS.Mic),
  comment: lucideIcon(VI_ICONS.MessageSquare),
};

function IconButton(props) {
  var theme = props.theme;
  var active = props.active === true;
  return React.createElement(
    'button',
    {
      type: 'button',
      title: props.label,
      'aria-label': props.label,
      'aria-pressed': props.pressed,
      disabled: props.disabled === true,
      onClick: props.onClick,
      style: {
        width: props.size || 28,
        height: props.size || 28,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        cursor: props.disabled === true ? 'default' : 'pointer',
        background: active ? (theme.hover || theme.layer2) : 'transparent',
        color: props.disabled === true ? theme.muted : active ? theme.text : theme.muted,
        opacity: props.disabled === true ? 0.45 : 1,
        padding: 0,
        flex: 'none',
      },
      onMouseEnter: function (event) {
        if (props.disabled !== true) event.currentTarget.style.background = theme.hover || theme.layer2;
      },
      onMouseLeave: function (event) {
        event.currentTarget.style.background = active ? (theme.hover || theme.layer2) : 'transparent';
      },
    },
    props.children,
  );
}

function inputStyle(theme, extra) {
  return Object.assign(
    {
      width: '100%',
      minWidth: 0,
      height: 28,
      boxSizing: 'border-box',
      padding: '0 7px',
      color: theme.text,
      background: theme.base,
      border: '1px solid ' + (theme.borderStrong || theme.border),
      borderRadius: 'var(--dsw-radius-sm, 6px)',
      font: 'var(--dsw-font-xxs-12, 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
      outline: 'none',
    },
    extra || {},
  );
}

function Spinner(props) {
  var theme = props.theme;
  return React.createElement('span', {
    'aria-hidden': true,
    style: {
      width: props.size || 12,
      height: props.size || 12,
      borderRadius: 999,
      border: '1.6px solid ' + theme.border,
      borderTopColor: theme.brand,
      display: 'inline-block',
      animation: 'dsh-nudge-spin 700ms linear infinite',
      flex: 'none',
    },
  });
}

var GLOBAL_CSS_TAG = 'dsh-nudge-global-style';
function ensureGlobalStyles() {
  if (typeof document === 'undefined') return;
  var css = '@keyframes dsh-nudge-spin{to{transform:rotate(360deg)}}' +
    'html:has([data-dockkit-pointer]) [data-dsh-nudge-webview]{pointer-events:none}' +
    // The clip chip lives inside the resident composer card; reserve one row at
    // its top edge only while the tray has pending clips (never at rest).
    '[data-composer-card]:has([data-dsh-nudge-clip-chip]){padding-top:30px}' +
    '[data-dsh-nudge-root] *{box-sizing:border-box}' +
    '[data-dsh-nudge-root] input[type=range]{height:20px}' +
    '[data-dsh-nudge-root] ::-webkit-scrollbar{width:8px;height:8px}' +
    '[data-dsh-nudge-root] ::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2, #3a4150);border-radius:999px}' +
    (typeof NUDGE_UI_CSS === 'string' ? NUDGE_UI_CSS : '');
  var existing = document.getElementById(GLOBAL_CSS_TAG);
  if (existing) {
    // Plugin reload keeps the document alive; refresh the stylesheet instead of
    // returning early, otherwise the new Tailwind/TS UI classes never arrive.
    if (existing.textContent !== css) existing.textContent = css;
    return;
  }
  var style = document.createElement('style');
  style.id = GLOBAL_CSS_TAG;
  style.textContent = css;
  document.head.appendChild(style);
}
