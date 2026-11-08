// @ts-nocheck
/**
 * Composer "clip annotation" tray.
 *
 * Registered into `conversation.input.overlay`, which renders inside a
 * zero-height anchor at the top edge of the resident composer card:
 *
 * - the expanded annotation cards float above the composer card
 *   (`bottom: 100%`, the same anchor the slash/@ menus use), and
 * - the collapsed `N 条注释` chip sits inside the composer card
 *   (`[data-dsh-nudge-clip-chip]` + the padding rule in `ensureGlobalStyles()`).
 *
 * The store lives in `clip-store.ts`; the send hook lives in the Client
 * bootstrap.
 */

function clipChipLabel(t, entry) {
  var annotations = entry.clips.length;
  var edits = entry.ops.length;
  if (annotations > 0 && edits > 0) return t('clip.summary', { n: annotations, m: edits });
  if (annotations > 0) return t('clip.annotations', { n: annotations });
  return t('clip.edits', { n: edits });
}

function clipCardStyle(theme) {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '8px 9px',
    border: '1px solid ' + (theme.borderStrong || theme.border),
    borderRadius: 12,
    background: theme.isDark
      ? 'color-mix(in srgb, ' + theme.base + ' 88%, white)'
      : theme.layer1 || '#ffffff',
    boxShadow: theme.isDark ? '0 8px 22px rgba(0, 0, 0, 0.24)' : '0 8px 22px rgba(20, 30, 50, 0.12)',
    font: 'var(--dsw-font-xxxs-11, 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif)',
    color: theme.text,
    textAlign: 'left',
  };
}

function ClipTagPill(props) {
  var theme = props.theme;
  return React.createElement(
    'span',
    {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        padding: '0 6px',
        flex: 'none',
        maxWidth: 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        border: '1px solid ' + (theme.borderStrong || theme.border),
        borderRadius: 6,
        background: theme.layer2,
        color: theme.muted,
        font: '10.5px/16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      },
    },
    props.label,
  );
}

function ClipThumb(props) {
  var theme = props.theme;
  var thumb = props.thumbnail;
  if (thumb) {
    return React.createElement('img', {
      src: thumb,
      alt: '',
      'aria-hidden': true,
      style: {
        width: 24,
        height: 24,
        flex: 'none',
        borderRadius: 7,
        objectFit: 'cover',
        border: '1px solid ' + (theme.borderStrong || theme.border),
        background: theme.base,
        display: 'block',
      },
    });
  }
  return React.createElement(
    'span',
    {
      'aria-hidden': true,
      style: {
        width: 24,
        height: 24,
        flex: 'none',
        borderRadius: 7,
        border: '1px solid ' + (theme.borderStrong || theme.border),
        background: theme.layer2,
        color: theme.muted,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
    },
    React.createElement(Icon.cursor, { size: 12 }),
  );
}

function ClipCard(props) {
  var clip = props.clip;
  var theme = props.theme;
  var t = props.t;
  var editing = props.editing;
  var draft = props.draft;
  var actions = React.createElement(
    'div',
    { style: { display: 'inline-flex', alignItems: 'center', gap: 2, flex: 'none' } },
    React.createElement(
      IconButton,
      {
        theme: theme,
        size: 22,
        label: t('clip.edit'),
        onClick: function (event) {
          if (event) event.stopPropagation();
          props.onBeginEdit(clip);
        },
      },
      React.createElement(Icon.edit, { size: 12 }),
    ),
    React.createElement(
      IconButton,
      {
        theme: theme,
        size: 22,
        label: t('clip.remove'),
        onClick: function (event) {
          if (event) event.stopPropagation();
          props.onRemove(clip);
        },
      },
      React.createElement(Icon.trash, { size: 12 }),
    ),
  );
  var body = editing
    ? React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        React.createElement('textarea', {
          value: draft,
          'aria-label': t('clip.edit'),
          rows: 2,
          autoFocus: true,
          onChange: function (event) {
            props.onDraft(event.target.value);
          },
          onKeyDown: function (event) {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              props.onCancelEdit();
              return;
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.stopPropagation();
              props.onCommitEdit();
            }
          },
          style: {
            width: '100%',
            minHeight: 44,
            maxHeight: 120,
            boxSizing: 'border-box',
            resize: 'none',
            padding: '5px 7px',
            border: '1px solid ' + (theme.borderStrong || theme.border),
            borderRadius: 8,
            background: theme.base,
            color: theme.text,
            font: 'inherit',
            outline: 'none',
          },
        }),
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' } },
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: function (event) {
                event.stopPropagation();
                props.onCancelEdit();
              },
              style: {
                height: 22,
                padding: '0 8px',
                border: '1px solid ' + (theme.borderStrong || theme.border),
                borderRadius: 6,
                background: 'transparent',
                color: theme.muted,
                font: 'inherit',
                cursor: 'pointer',
              },
            },
            t('clip.cancel'),
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: function (event) {
                event.stopPropagation();
                props.onCommitEdit();
              },
              style: {
                height: 22,
                padding: '0 9px',
                border: '1px solid transparent',
                borderRadius: 6,
                background: theme.brand,
                color: theme.onBrand || '#ffffff',
                font: 'inherit',
                fontWeight: 600,
                cursor: 'pointer',
              },
            },
            t('clip.save'),
          ),
        ),
      )
    : React.createElement(
        'div',
        {
          style: {
            color: clip.note ? theme.text : theme.muted,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            font: 'var(--dsw-font-xxs-12, 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif)',
          },
        },
        clip.note || t('clip.emptyNote'),
      );
  return React.createElement(
    'div',
    {
      'data-dsh-nudge-clip-card': clip.id,
      style: clipCardStyle(theme),
      onMouseDown: function (event) {
        event.stopPropagation();
      },
      onClick: function (event) {
        event.stopPropagation();
      },
    },
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 } },
      React.createElement(ClipThumb, { theme: theme, thumbnail: clip.thumbnail }),
      React.createElement(ClipTagPill, { theme: theme, label: clip.tag || clip.selector || 'element' }),
      React.createElement('span', { style: { flex: 1, minWidth: 0 } }),
      actions,
    ),
    body,
  );
}

/**
 * Floating annotation cards above the composer plus the count chip inside the
 * composer card. Renders nothing while the draft has no clips.
 */
function ClipAnnotationTray(props) {
  var t = props.t;
  var theme = useDshTheme(props.ctx);
  var sessionId = props.sessionId || '';
  var entry = useClipEntry(sessionId);
  var editingState = React.useState(null);
  var editing = editingState[0];
  var setEditing = editingState[1];
  var draftState = React.useState('');
  var draft = draftState[0];
  var setDraft = draftState[1];
  var editingId = editing && editing.id ? editing.id : null;
  var hasClips = entry.clips.length > 0;
  var hasOps = entry.ops.length > 0;
  if (!hasClips && !hasOps) return null;

  function collapse() {
    setClipExpanded(sessionId, false);
  }

  function expand() {
    setClipExpanded(sessionId, true);
  }

  function beginEdit(clip) {
    setEditing({ id: clip.id });
    setDraft(clip.note || '');
    expand();
  }

  function commitEdit() {
    if (editingId) updateClipNote(sessionId, editingId, draft);
    setEditing(null);
    setDraft('');
  }

  function cancelEdit() {
    setEditing(null);
    setDraft('');
  }

  function handleMouseLeave() {
    if (editingId) return;
    collapse();
  }

  var cards = entry.expanded
    ? React.createElement(
        'div',
        {
          'data-dsh-nudge-clip-cards': '',
          onMouseLeave: handleMouseLeave,
          style: {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 'calc(100% + 6px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxHeight: 'min(42vh, 340px)',
            overflowY: 'auto',
            pointerEvents: 'auto',
            paddingRight: 2,
            zIndex: 1,
          },
        },
        hasOps
          ? React.createElement(
              'div',
              {
                'data-dsh-nudge-clip-edits': '',
                style: Object.assign(clipCardStyle(theme), {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 7,
                  padding: '6px 9px',
                }),
              },
              React.createElement(Icon.spark, { size: 12, style: { color: theme.muted } }),
              React.createElement(
                'span',
                { style: { flex: 1, minWidth: 0, color: theme.muted } },
                t('clip.edits', { n: entry.ops.length }),
              ),
              React.createElement(
                IconButton,
                {
                  theme: theme,
                  size: 22,
                  label: t('clip.clearEdits'),
                  onClick: function (event) {
                    if (event) event.stopPropagation();
                    clearClipOps(sessionId);
                  },
                },
                React.createElement(Icon.close, { size: 12 }),
              ),
            )
          : null,
        entry.clips.map(function (clip) {
          return React.createElement(ClipCard, {
            key: clip.id,
            clip: clip,
            theme: theme,
            t: t,
            editing: editingId === clip.id,
            draft: editingId === clip.id ? draft : '',
            onDraft: setDraft,
            onBeginEdit: beginEdit,
            onCommitEdit: commitEdit,
            onCancelEdit: cancelEdit,
            onRemove: function (target) {
              if (editingId === target.id) cancelEdit();
              removeClip(sessionId, target.id);
            },
          });
        }),
      )
    : null;

  var chip = React.createElement(
    'div',
    {
      'data-dsh-nudge-clip-chip': '',
      style: {
        position: 'absolute',
        top: 8,
        left: 12,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        height: 24,
        padding: '0 3px 0 9px',
        boxSizing: 'border-box',
        border: '1px solid ' + (theme.borderStrong || theme.border),
        borderRadius: 999,
        background: theme.isDark
          ? 'color-mix(in srgb, ' + theme.base + ' 86%, white)'
          : theme.layer1 || '#ffffff',
        color: theme.text,
        pointerEvents: 'auto',
        zIndex: 2,
        boxShadow: theme.isDark ? '0 2px 8px rgba(0, 0, 0, 0.18)' : '0 1px 4px rgba(20, 30, 50, 0.10)',
        font: 'var(--dsw-font-xxxs-11, 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif)',
      },
      onMouseEnter: expand,
    },
    React.createElement(
      'button',
      {
        type: 'button',
        'aria-expanded': entry.expanded === true,
        'aria-label': clipChipLabel(t, entry),
        title: t('clip.chipTitle'),
        onClick: function (event) {
          event.stopPropagation();
          if (entry.expanded) collapse();
          else expand();
        },
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          height: 20,
          padding: 0,
          border: 0,
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          cursor: 'pointer',
        },
      },
      React.createElement(Icon.comment, { size: 11 }),
      React.createElement('span', null, clipChipLabel(t, entry)),
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        'aria-label': t('clip.clear'),
        title: t('clip.clear'),
        onClick: function (event) {
          event.stopPropagation();
          cancelEdit();
          clearClips(sessionId);
        },
        style: {
          width: 20,
          height: 20,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          border: 0,
          borderRadius: 999,
          background: 'transparent',
          color: theme.muted,
          cursor: 'pointer',
          flex: 'none',
        },
        onMouseEnter: function (event) {
          event.currentTarget.style.background = theme.hover || theme.layer2;
          event.currentTarget.style.color = theme.text;
        },
        onMouseLeave: function (event) {
          event.currentTarget.style.background = 'transparent';
          event.currentTarget.style.color = theme.muted;
        },
      },
      React.createElement(Icon.close, { size: 10 }),
    ),
  );

  return React.createElement(
    'div',
    {
      'data-dsh-nudge-clip-layer': '',
      style: {
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 95,
      },
    },
    cards,
    chip,
  );
}
