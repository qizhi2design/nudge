// @ts-nocheck
/**
 * Docked DOM tree inspector.
 *
 * The page runtime owns the real DOM; this panel lazily asks it for the
 * immediate children of a path and renders a devtools-like tree. Clicking a row
 * selects + scrolls to that element in the page (and opens the style card in
 * edit mode). The node matching the current selection is highlighted, and the
 * tree auto-expands the selected element's ancestors.
 */

function domPathKey(path) {
  return Array.isArray(path) ? path.join('.') : '';
}

function DomTreeNodeLabel(props) {
  var node = props.node;
  var theme = props.theme;
  var label = node.tag || 'node';
  var pieces = [React.createElement('span', { key: 'tag', style: { color: theme.text } }, label)];
  if (node.id) pieces.push(React.createElement('span', { key: 'id', style: { color: theme.brand } }, '#' + node.id));
  if (node.classes && node.classes.length > 0) {
    pieces.push(React.createElement('span', { key: 'class', style: { color: theme.muted } }, '.' + node.classes.join('.')));
  }
  return React.createElement(
    'span',
    {
      style: {
        display: 'block',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        font: '11px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      },
    },
    pieces,
  );
}

function DomTreePanel(props) {
  var t = props.t;
  var theme = props.theme;
  var carrier = props.carrier;
  var selection = props.selection;
  var selectionKey = selection && Array.isArray(selection.path) ? domPathKey(selection.path) : null;
  var state1 = React.useState({});
  var expandedMap = state1[0];
  var setExpandedMap = state1[1];
  var state2 = React.useState({});
  var childrenMap = state2[0];
  var setChildrenMap = state2[1];
  var state3 = React.useState({});
  var loadingMap = state3[0];
  var setLoadingMap = state3[1];
  var state4 = React.useState('');
  var error = state4[0];
  var setError = state4[1];

  function loadKey(key, path) {
    if (!carrier || childrenMap[key] !== undefined || loadingMap[key]) return;
    setLoadingMap(function (prev) {
      if (prev[key]) return prev;
      var next = Object.assign({}, prev);
      next[key] = true;
      return next;
    });
    carrier
      .domChildren(path)
      .then(function (list) {
        setChildrenMap(function (prev) {
          if (prev[key] !== undefined) return prev;
          var next = Object.assign({}, prev);
          next[key] = Array.isArray(list) ? list : [];
          return next;
        });
        setLoadingMap(function (prev) {
          var next = Object.assign({}, prev);
          delete next[key];
          return next;
        });
      })
      .catch(function (failure) {
        setLoadingMap(function (prev) {
          var next = Object.assign({}, prev);
          delete next[key];
          return next;
        });
        setError(String((failure && failure.message) || failure));
      });
  }

  React.useEffect(
    function () {
      if (!carrier) return;
      setChildrenMap({});
      setExpandedMap({ '': true });
      setError('');
    },
    [carrier],
  );

  React.useEffect(
    function () {
      if (!carrier || childrenMap[''] !== undefined || loadingMap['']) return;
      loadKey('', []);
    },
    [carrier, childrenMap, loadingMap],
  );

  React.useEffect(
    function () {
      if (!carrier || !selection || !Array.isArray(selection.path)) return;
      var path = selection.path;
      var prefixes = [[]];
      for (var index = 0; index < path.length; index += 1) prefixes.push(path.slice(0, index + 1));
      prefixes.forEach(function (prefix) {
        var key = domPathKey(prefix);
        setExpandedMap(function (prev) {
          if (prev[key] === true) return prev;
          var next = Object.assign({}, prev);
          next[key] = true;
          return next;
        });
        if (childrenMap[key] === undefined) {
          carrier
            .domChildren(prefix)
            .then(function (list) {
              setChildrenMap(function (prev) {
                if (prev[key] !== undefined) return prev;
                var next = Object.assign({}, prev);
                next[key] = Array.isArray(list) ? list : [];
                return next;
              });
            })
            .catch(function () {});
        }
      });
    },
    [carrier, selectionKey],
  );

  function toggleNode(node) {
    var key = domPathKey(node.path);
    setExpandedMap(function (prev) {
      var next = Object.assign({}, prev);
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
    if (childrenMap[key] === undefined) loadKey(key, node.path);
  }

  function selectNode(node) {
    if (!carrier) return;
    carrier.focusDomPath(node.path).catch(function (failure) {
      setError(String((failure && failure.message) || failure));
    });
  }

  function renderRow(node, depth, open) {
    var key = domPathKey(node.path);
    var isSelected = selectionKey !== null && key === selectionKey;
    var hasChildren = node.childCount > 0;
    return React.createElement(
      'div',
      {
        key: 'row:' + key,
        'data-dom-node': key,
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          paddingLeft: depth * 12 + 4,
          paddingRight: 6,
          minHeight: 22,
          borderRadius: 5,
          background: isSelected ? 'color-mix(in srgb, ' + (theme.accent || theme.brand) + ' 16%, transparent)' : 'transparent',
          color: theme.text,
          cursor: 'pointer',
        },
        onMouseEnter: function (event) {
          if (!isSelected) event.currentTarget.style.background = theme.hover || theme.layer2;
        },
        onMouseLeave: function (event) {
          if (!isSelected) event.currentTarget.style.background = 'transparent';
        },
        onMouseDown: function (event) {
          event.stopPropagation();
        },
        onClick: function (event) {
          event.stopPropagation();
          selectNode(node);
        },
      },
      React.createElement(
        'button',
        {
          type: 'button',
          'aria-label': open ? t('dom.collapse') : t('dom.expand'),
          'aria-expanded': open === true,
          disabled: !hasChildren,
          onClick: function (event) {
            event.stopPropagation();
            if (hasChildren) toggleNode(node);
          },
          style: {
            width: 14,
            height: 18,
            flex: 'none',
            padding: 0,
            border: 'none',
            background: 'transparent',
            color: theme.muted,
            cursor: hasChildren ? 'pointer' : 'default',
            opacity: hasChildren ? 1 : 0.25,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          },
        },
        React.createElement(Icon.chevron, {
          size: 10,
          style: { transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms cubic-bezier(0.23, 1, 0.32, 1)' },
        }),
      ),
      React.createElement(DomTreeNodeLabel, { node: node, theme: theme }),
    );
  }

  function renderChildren(key, depth, out) {
    var list = childrenMap[key];
    if (list === undefined) {
      if (loadingMap[key]) out.push(React.createElement('div', { key: 'loading:' + key, style: { padding: '3px 8px 3px ' + (depth * 12 + 22) + 'px', color: theme.muted, font: '10.5px/1.4 sans-serif' } }, t('dom.loading')));
      return out;
    }
    list.forEach(function (node) {
      var nodeKey = domPathKey(node.path);
      var open = expandedMap[nodeKey] === true;
      out.push(renderRow(node, depth, open));
      if (open && node.childCount > 0) renderChildren(nodeKey, depth + 1, out);
    });
    return out;
  }

  var rows = [renderRow({ path: [], tag: 'html', id: '', classes: [], childCount: 1 }, 0, expandedMap[''] === true)];
  if (expandedMap[''] === true) renderChildren('', 1, rows);
  if (error !== '') {
    rows.push(
      React.createElement('div', { key: 'error', style: { padding: '6px 8px', color: theme.danger, font: '10.5px/1.4 sans-serif' } }, t('dom.failed') + ' · ' + error),
    );
  }

  return React.createElement(
    'aside',
    {
      'data-dsh-nudge-dom-panel': '',
      'aria-label': t('dom.title'),
      style: {
        width: 272,
        flex: 'none',
        minWidth: 272,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        borderLeft: '1px solid ' + (theme.borderStrong || theme.border),
        background: theme.base,
        color: theme.text,
      },
    },
    React.createElement(
      'div',
      {
        style: {
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 34,
          padding: '0 6px 0 10px',
          borderBottom: '1px solid ' + (theme.borderStrong || theme.border),
          color: theme.text,
          font: 'var(--dsw-font-xxxs-11, 11.5px/1.3 sans-serif)',
          fontWeight: 600,
        },
      },
      React.createElement(Icon.dom, { size: 13 }),
      React.createElement('span', { style: { flex: 1, minWidth: 0 } }, t('dom.title')),
      React.createElement(
        'button',
        {
          type: 'button',
          'aria-label': t('dom.close'),
          title: t('dom.close'),
          onClick: props.onClose,
          style: { width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 'none', borderRadius: 5, background: 'transparent', color: theme.muted, cursor: 'pointer' },
        },
        React.createElement(Icon.close, { size: 12 }),
      ),
    ),
    React.createElement(
      'div',
      {
        'data-dsh-nudge-dom-tree': '',
        style: { flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 2px 12px' },
      },
      rows,
    ),
  );
}
