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
  nudge: lucideIcon(VI_ICONS.NudgeMark),
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
    // Fullscreen floating conversation: the host column keeps the native chat
    // and is docked to the bottom edge above the fullscreen right-Sidebar
    // panel. Only the marker set by domains/composer/floating.ts matches these
    // rules, so normal split layouts and other plugins' fullscreen panels are
    // untouched. The surface is a bottom dock, not a floating window: no shadow,
    // no header chrome, only rounded top corners and a hairline top border.
    '[data-dsh-nudge-floating-chat]{position:absolute!important;grid-area:auto!important;margin:0!important;left:calc(50% - min(440px, calc(50% - 32px)))!important;top:auto!important;right:auto!important;bottom:0!important;transform:none!important;width:min(880px, calc(100% - 64px))!important;height:min(640px, 70%)!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;z-index:50!important;display:flex!important;flex-direction:column;overflow:hidden!important;background:var(--dsw-alias-bg-base,#fff)!important;border:.5px solid var(--dsw-alias-border-l3,#ddd)!important;border-bottom:0!important;border-radius:14px 14px 0 0!important;box-shadow:none!important}' +
    // The host header carries the application window drag region and traffic
    // light spacing; a docked surface shows only the conversation itself.
    '[data-dsh-nudge-floating-chat] header{display:none!important}' +
    '[data-dsh-nudge-floating-chat] [data-width-handle]{display:none!important}' +
    '[data-dsh-nudge-floating-chat] [data-conversation-scroll]{margin-right:0!important;scrollbar-gutter:auto!important}' +
    '[data-dsh-nudge-floating-chat]>:not(header){flex:1 1 auto;min-height:0}' +
    // Compact presentation: only the native composer stays visible, docked to
    // the bottom edge and centred. Height follows the measured composer seat so
    // attachments and multi-line drafts grow the bar instead of clipping it.
    '[data-dsh-nudge-floating-chat][data-dsh-nudge-float-mode=compact]{height:var(--dsh-nudge-float-compact-height,64px)!important;width:min(760px, calc(100% - 64px))!important;left:calc(50% - min(380px, calc(50% - 32px)))!important;border-radius:16px 16px 0 0!important}' +
    '[data-dsh-nudge-floating-chat][data-dsh-nudge-float-mode=compact] [data-conversation-scroll]{overflow:hidden!important}' +
    '[data-dsh-nudge-floating-chat][data-dsh-nudge-float-mode=compact] [data-conversation-scroll]>:not([data-composer-seat]){display:none!important}' +
    // Controls: two separate 26px icons inside the dock's top-right corner —
    // the chevron collapses the messages (compact composer dock), the bubble
    // shrinks the whole dock to the small floating button. While compact the
    // bubble alone floats above the input bar; the 46px circle restores the
    // dock. They never share one button.
    '[data-dsh-nudge-float-collapse],[data-dsh-nudge-float-shrink]{position:fixed!important;z-index:55!important;box-sizing:border-box;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:.5px solid var(--dsw-alias-border-l3,#ddd);border-radius:8px;background:var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-base, #fff));color:var(--dsw-alias-label-primary, #111);cursor:pointer;box-shadow:0 2px 8px #0002}' +
    '[data-dsh-nudge-float-collapse]:hover,[data-dsh-nudge-float-shrink]:hover{background:var(--dsw-alias-button-floating-hover, var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-base, #fff)))}' +
    '[data-dsh-nudge-float-collapse]:focus-visible,[data-dsh-nudge-float-shrink]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary, #4f8cff);outline-offset:2px}' +
    '[data-dsh-nudge-float-collapse] svg,[data-dsh-nudge-float-shrink] svg{width:16px;height:16px}' +
    // The restore button floats over the *inspected page*, which can be light
    // while the host theme is dark. Its hover fill must stay opaque: the generic
    // `--dsw-alias-interactive-bg-hover` token is a translucent tint (white 8%
    // in dark theme), so using it here replaced the dark base and turned the
    // button into a washed-out translucent patch with a light icon on a light
    // page. The floating-button fill/hover pair is opaque in both themes.
    '[data-dsh-nudge-float-button]{position:fixed!important;right:20px!important;bottom:20px!important;z-index:60!important;width:46px!important;height:46px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;padding:0!important;border:.5px solid var(--dsw-alias-border-l3,#ddd)!important;border-radius:999px!important;background-color:var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-base, #fff))!important;color:var(--dsw-alias-label-primary,#111)!important;box-shadow:0 8px 24px #0003!important;cursor:pointer!important;transition:background-color 120ms ease, border-color 120ms ease}' +
    '[data-dsh-nudge-float-button]:hover{background-color:var(--dsw-alias-button-floating-hover, var(--dsw-alias-button-floating-fill, var(--dsw-alias-bg-base, #fff)))!important;border-color:var(--dsw-alias-border-l4, var(--dsw-alias-border-l3, #ddd))!important}' +
    '[data-dsh-nudge-float-button]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary, #4f8cff);outline-offset:2px}' +
    '[data-dsh-nudge-float-button] svg{width:20px;height:20px}' +
    '[data-dsh-nudge-float-collapse][hidden],[data-dsh-nudge-float-shrink][hidden],[data-dsh-nudge-float-button][hidden]{display:none!important}' +
    '[data-dsh-nudge-floating-chat][data-dsh-nudge-float-mode=hidden]{display:none!important}' +
    // The dock panel is narrow: filename owns the row width, the parent folder
    // only appears on hover/focus (the row title still carries the full path).
    '[data-dsh-nudge-workspace-panel] [data-workspace-file-dir]{display:none}' +
    '[data-dsh-nudge-workspace-panel] [data-workspace-file]:hover [data-workspace-file-dir],' +
    '[data-dsh-nudge-workspace-panel] [data-workspace-file]:focus-visible [data-workspace-file-dir]{display:inline}' +
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
