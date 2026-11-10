// @ts-nocheck
/**
 * The Visual Inspector tab body: toolbar + embedded page + property dock,
 * annotation dock, live Auto Apply editing, edit history and the async source
 * sync queue.
 */

/** A shortcut may open the tab straight into annotate/edit. */
function initialInspectorMode(record) {
  try {
    var params = record && record.navigation ? record.navigation.params : null;
    if (params && (params.mode === 'annotate' || params.mode === 'edit')) return params.mode;
  } catch (error) {
    /* navigation is not readable yet; a fresh tab starts in browse */
  }
  return 'browse';
}

/** ` · detail` suffix for the source-sync notice; empty when there is no detail. */
function syncNoticeSuffix(detail) {
  var text = detail === null || detail === undefined ? '' : String(detail).trim();
  return text === '' ? '' : ' · ' + text;
}

/**
 * Default page for a freshly opened workspace folder: scan the session
 * workspace, pick its first HTML file and start the Host static preview server
 * for it. Returns the preview URL, or null when the workspace has no HTML or
 * the Host cannot serve one. This is a convenience default, so every failure
 * stays silent instead of surfacing an error into the UI.
 */
function defaultWorkspaceUrl(remote, sessionId) {
  if (sessionId === '' || typeof remote !== 'function') return Promise.resolve(null);
  return Promise.resolve(remote('workspace', workspaceArgs(sessionId)))
    .then(function (snapshot) {
      var file = firstWorkspaceHtmlFile(snapshot);
      if (file === null) return null;
      return Promise.resolve(remote('previewOpen', previewOpenArgs(sessionId, file.path))).then(function (result) {
        return result && typeof result.url === 'string' && result.url !== '' ? result.url : null;
      });
    })
    .catch(function () {
      return null;
    });
}

/** Host locate/patch reason → locale key. Unknown codes stay verbatim. */
var SYNC_REASON_KEYS = {
  'unresolved-element': 'source.reasonUnresolved',
  'ambiguous-element': 'source.reasonAmbiguous',
  'path-mismatch': 'source.reasonPathMismatch',
  'protected-element': 'source.reasonProtected',
  'unresolved-target-parent': 'source.reasonTargetParent',
  'unresolved-target-anchor': 'source.reasonTargetAnchor',
  'invalid-move-target': 'source.reasonInvalidMove',
  'unsupported-target-parent': 'source.reasonUnsupportedParent',
  'unsupported-js-source': 'source.reasonJsSource',
  'unsafe-js-context': 'source.reasonJsSource',
  'stale-handle': 'source.reasonStaleHandle',
  'file-too-large': 'source.reasonTooLarge',
  'no-source-mapping': 'source.reasonNoMapping',
  'unsupported-edit-kind': 'source.reasonUnsupportedKind',
  'unsupported-source-type': 'source.reasonUnsupportedSource',
  'invalid-edit': 'source.reasonInvalidEdit',
  'file-missing': 'source.reasonMissingFile',
  'read-failed': 'source.reasonIoFailed',
  'write-failed': 'source.reasonIoFailed',
  'stale-version': 'source.reasonStaleVersion',
  'internal-error': 'source.reasonInternal',
  'fs-unavailable': 'source.reasonInternal',
  'workspace-unavailable': 'source.reasonInternal',
  'read-only-policy': 'source.reasonReadOnly',
};

/**
 * Localised copy for the Host's source-locate failure reasons. Unknown reasons
 * fall through verbatim so a new Host code stays debuggable instead of hidden.
 */
function syncReasonText(t, reason) {
  var text = reason === null || reason === undefined ? '' : String(reason).trim();
  var key = SYNC_REASON_KEYS[text];
  return key === undefined ? text : t(key);
}

/**
 * Locale strings forwarded into the injected page runtime (selection card,
 * annotate bar). Kept top-level so the forwarding contract is testable.
 */
function buildRuntimeLocale(t) {
  return {
    annotation: {
      popoverTitle: t('annotation.popoverTitle'),
      popoverSubtitle: t('annotation.popoverSubtitle'),
      placeholder: t('annotation.placeholder'),
      cancel: t('annotation.cancel'),
      add: t('annotation.add'),
      region: t('annotation.region'),
      designTitle: t('annotation.designTitle'),
      designColor: t('annotation.designColor'),
      designBackground: t('annotation.designBackground'),
      designOpacity: t('annotation.designOpacity'),
      designFont: t('annotation.designFont'),
      designFontSize: t('annotation.designFontSize'),
      designFontWeight: t('annotation.designFontWeight'),
      designCancel: t('annotation.designCancel'),
      designApply: t('annotation.designApply'),
      designClose: t('annotation.designClose'),
      designPreview: t('annotation.designPreview'),
      statusAnnotating: t('annotation.statusAnnotating'),
      statusSend: t('annotation.statusSend'),
      statusExit: t('annotation.statusExit'),
      statusRemove: t('annotation.statusRemove'),
      statusLocate: t('annotation.statusLocate'),
      statusHideMarkers: t('annotation.statusHideMarkers'),
      statusShowMarkers: t('annotation.statusShowMarkers'),
      statusDiscard: t('annotation.statusDiscard'),
      statusDiscardArmed: t('annotation.statusDiscardArmed'),
      statusMoveToolbar: t('annotation.statusMoveToolbar'),
      designLayout: t('dock.layout'),
      designSpacing: t('dock.spacing'),
      designTypography: t('dock.typography'),
      designAppearance: t('dock.appearance'),
      designAdvanced: t('dock.advanced'),
      designWidth: t('dock.width'),
      designHeight: t('dock.height'),
      designDisplay: t('dock.display'),
      designPosition: t('dock.position'),
      designOverflow: t('dock.overflow'),
      designMargin: t('dock.margin'),
      designPadding: t('dock.padding'),
      designGap: t('dock.gap'),
      designLineHeight: t('dock.lineHeight'),
      designLetterSpacing: t('dock.letterSpacing'),
      designTextAlign: t('dock.textAlign'),
      designBorder: t('dock.border'),
      designBorderRadius: t('dock.borderRadius'),
      designShadow: t('dock.shadow'),
      designTransform: t('dock.transform'),
      designZIndex: t('dock.zIndex'),
      designVisibility: t('dock.visibility'),
      designContent: t('dock.content'),
      designDom: t('dock.dom'),
      designTextContent: t('dock.textContent'),
      designNoDirectText: t('dock.noDirectText'),
      designAncestors: t('dock.ancestors'),
      designDescendants: t('dock.descendants'),
      designNoDescendants: t('dock.noDescendants'),
      designDelete: t('annotation.designDelete'),
      designDeleteHint: t('annotation.designDeleteHint'),
      designMoveHint: t('annotation.designMoveHint'),
    },
  };
}

/**
 * Ops that a page load may re-apply to the live DOM: only the applied part of
 * the history, never undone / already-persisted ops, and only ops recorded on
 * this same page (a persisted structure op would otherwise hit a shifted sibling).
 */
function replayableOperations(history, pageUrl) {
  var ops = history && Array.isArray(history.ops) ? history.ops : [];
  var index = history && typeof history.index === 'number' ? history.index : -1;
  return ops.slice(0, index + 1).filter(function (op) {
    if (!op) return false;
    if (op.syncStatus === 'undone') return false;
    if (op.persisted === true) return false;
    if (op.pageUrl && op.pageUrl !== pageUrl) return false;
    return true;
  });
}

/** One history op → the runtime `reapply` edit that reproduces it. */
function runtimeEditFor(op) {
  if (!op) return null;
  if (op.kind === 'style') return { kind: 'style', selector: op.selector, property: op.property, value: op.after };
  if (op.kind === 'text') return { kind: 'text', selector: op.selector, value: op.after };
  if (op.kind === 'remove') return { kind: 'remove', selector: op.selector, path: op.path, outerHTML: op.outerHTML };
  if (op.kind === 'move') {
    return {
      kind: 'move',
      selector: op.selector,
      path: op.path,
      outerHTML: op.outerHTML,
      targetParentSelector: op.targetParentSelector,
      targetParentPath: op.targetParentPath,
      targetParentOuterHTML: op.targetParentOuterHTML,
      beforeSelector: op.beforeSelector == null ? null : op.beforeSelector,
      beforePath: op.beforePath,
      beforeOuterHTML: op.beforeOuterHTML,
    };
  }
  if (op.kind === 'insert') {
    return {
      kind: 'insert',
      html: op.html || op.outerHTML,
      targetParentSelector: op.targetParentSelector,
      beforeSelector: op.beforeSelector,
    };
  }
  return { kind: 'attr', selector: op.selector, attrName: op.attrName, value: op.after };
}

/**
 * Apply the runtime half of one undo/redo step. Structure ops use the dedicated
 * carrier inverse commands; redo replays the op's original runtime edit.
 */
function applyInverse(carrier, op, direction) {
  if (op.kind === 'style') return carrier.applyStyle(op.selector, op.property, direction === 'undo' ? op.before : op.after);
  if (op.kind === 'text') return carrier.applyText(op.selector, direction === 'undo' ? op.before : op.after);
  if (op.kind === 'attr') return carrier.applyAttr(op.selector, op.attrName, direction === 'undo' ? op.before : op.after);
  if (op.kind === 'remove') {
    if (direction === 'undo') {
      return carrier.applyInsert({
        parentSelector: op.parentSelector,
        beforeSelector: op.beforeSelector,
        html: op.outerHTML,
      });
    }
    return carrier.reapply([runtimeEditFor(op)]);
  }
  if (op.kind === 'move') {
    if (direction === 'undo') {
      return carrier.applyMoveElement({
        elementKey: op.elementKey,
        parentSelector: op.fromParentSelector,
        beforeSelector: op.fromBeforeSelector,
      });
    }
    return carrier.reapply([runtimeEditFor(op)]);
  }
  if (op.kind === 'insert') {
    if (direction === 'undo') {
      return carrier.reapply([{ kind: 'remove', selector: op.selector, path: op.path, outerHTML: op.outerHTML }]);
    }
    return carrier.reapply([runtimeEditFor(op)]);
  }
  return Promise.resolve(null);
}

/** The source-write edit a history step should queue, or null when none applies. */
function followUpOperation(op, direction, result) {
  if (op.kind === 'remove') {
    if (direction === 'undo') {
      return {
        id: 'undo|' + op.id + '|' + Date.now(),
        kind: 'insert',
        html: op.outerHTML,
        outerHTML: op.outerHTML,
        textBefore: op.textBefore,
        textSnippet: op.textSnippet,
        elementKey: op.elementKey,
        targetParentSelector: op.parentSelector,
        beforeSelector: op.beforeSelector,
        sourceHints: op.sourceHints,
        coalesceKey: '',
      };
    }
    return {
      id: 'redo|' + op.id + '|' + Date.now(),
      kind: 'remove',
      selector: op.selector,
      path: op.path,
      outerHTML: op.outerHTML,
      textBefore: op.textBefore,
      textSnippet: op.textSnippet,
      elementKey: op.elementKey,
      parentSelector: op.parentSelector,
      beforeSelector: op.beforeSelector,
      sourceHints: op.sourceHints,
      coalesceKey: '',
    };
  }
  if (op.kind === 'move') {
    if (direction === 'undo') {
      var restoredSelector = result && result.selector ? String(result.selector) : '';
      if (restoredSelector === '') return null;
      return {
        id: 'undo|' + op.id + '|' + Date.now(),
        kind: 'move',
        selector: restoredSelector,
        outerHTML: op.outerHTML,
        textBefore: op.textBefore,
        textSnippet: op.textSnippet,
        elementKey: op.elementKey,
        targetParentSelector: op.fromParentSelector,
        beforeSelector: op.fromBeforeSelector,
        fromParentSelector: op.targetParentSelector,
        fromBeforeSelector: op.beforeSelector,
        sourceHints: op.sourceHints,
        coalesceKey: '',
      };
    }
    return {
      id: 'redo|' + op.id + '|' + Date.now(),
      kind: 'move',
      selector: op.selector,
      path: op.path,
      outerHTML: op.outerHTML,
      textBefore: op.textBefore,
      textSnippet: op.textSnippet,
      elementKey: op.elementKey,
      targetParentSelector: op.targetParentSelector,
      targetParentPath: op.targetParentPath,
      targetParentOuterHTML: op.targetParentOuterHTML,
      beforeSelector: op.beforeSelector,
      beforePath: op.beforePath,
      beforeOuterHTML: op.beforeOuterHTML,
      fromParentSelector: op.fromParentSelector,
      fromBeforeSelector: op.fromBeforeSelector,
      sourceHints: op.sourceHints,
      coalesceKey: '',
    };
  }
  if (op.kind === 'insert') {
    if (direction === 'undo') return null;
    return {
      id: 'redo|' + op.id + '|' + Date.now(),
      kind: 'insert',
      html: op.html || op.outerHTML,
      outerHTML: op.html || op.outerHTML,
      targetParentSelector: op.targetParentSelector,
      beforeSelector: op.beforeSelector,
      sourceHints: op.sourceHints,
      coalesceKey: '',
    };
  }
  // style / text / attr keep the pre-existing inverse-record shape.
  var value = direction === 'undo' ? op.before : op.after;
  return {
    id: 'undo|' + op.id + '|' + Date.now(),
    opId: op.id,
    kind: op.kind,
    selector: op.selector,
    path: op.path,
    property: op.property,
    value: op.kind === 'style' ? value : undefined,
    before: direction === 'undo' ? op.after : op.before,
    after: value,
    attrName: op.attrName,
    sourceHints: op.sourceHints,
    outerHTML: op.outerHTML,
    textSnippet: op.textSnippet,
  };
}

/**
 * A structure edit whose element capture was cut at 64 KiB cannot be written
 * back safely (the Host would patch an incomplete snippet), so the source stays
 * untouched and the step reports why.
 */
function truncatedStructureCapture(op, direction) {
  if (op.outerHTMLTruncated !== true) return false;
  if (direction === 'redo') return true;
  return direction === 'undo' && op.kind === 'remove';
}

/**
 * Run one undo/redo step with every side effect injected, so the inverse rules
 * stay testable without a live carrier or store.
 */
function applyHistoryStep(deps, direction) {
  var carrier = deps.carrier;
  if (!carrier) return Promise.resolve(false);
  var t = typeof deps.translate === 'function' ? deps.translate : function (key) { return key; };
  var history = historyOf(deps.tab);
  var op = direction === 'undo' ? history.ops[history.index] : history.ops[history.index + 1];
  if (!op) return Promise.resolve(false);
  var structure = op.kind === 'remove' || op.kind === 'move' || op.kind === 'insert';
  return Promise.resolve(applyInverse(carrier, op, direction))
    .then(function (result) {
      if (direction === 'undo' && op.kind === 'move') {
        if (!(result && result.ok !== false && result.selector)) {
          var reason = result && result.reason ? String(result.reason) : 'move-undo-failed';
          if (deps.notice) deps.notice('error', t('dock.structureUndoFailed', { reason: syncReasonText(t, reason) }));
          return false;
        }
      }
      if (deps.advance) deps.advance(direction);
      var truncated = structure && truncatedStructureCapture(op, direction);
      if (truncated) {
        if (deps.notice) deps.notice('error', t('dock.structureUndoTruncated'));
      } else {
        var record = followUpOperation(op, direction, result);
        if (record && deps.enqueue) deps.enqueue(record);
      }
      if (deps.mark) deps.mark(op, direction === 'undo' ? 'undone' : op.persisted === true ? 'synced' : 'preview');
      if (deps.refresh) deps.refresh();
      if (structure && direction === 'undo' && !truncated && deps.notice) deps.notice('info', t('dock.structureUndoDone'));
      return true;
    })
    .catch(function (error) {
      var message = error instanceof Error ? error.message : String(error);
      if (deps.notice) deps.notice('error', t('dock.structureUndoFailed', { reason: message }));
      return false;
    });
}

/**
 * True when a host keydown target owns text input, so the mode Esc shortcut must
 * not steal the key from an editable field (address bar, dock inputs, settings).
 * The embedded page lives in its own document; its runtime applies the same
 * guard on its side.
 */
function isEditableShortcutTarget(target) {
  if (!target || typeof target !== 'object') return false;
  try {
    if (target.isContentEditable === true) return true;
    if (typeof target.closest !== 'function') return false;
    return (
      target.closest(
        'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]',
      ) !== null
    );
  } catch (error) {
    return false;
  }
}

function NudgeBody(props) {
  var t = props.t;
  var theme = useDshTheme(props.ctx);
  var tabInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo() : null;
  var tabRecord = tabInfo && tabInfo.tab ? tabInfo.tab : null;
  var tabId = tabRecord && tabRecord.id ? tabRecord.id : 'nudge-standalone';
  var sessionId = props.sessionId || (tabRecord && tabRecord.sessionId) || '';
  // The Host remote calls run from callbacks created once; keep the live
  // session id behind a ref so the sync queue never captures a stale value.
  var sessionIdRef = React.useRef(sessionId);
  sessionIdRef.current = sessionId;
  var initialized = React.useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    ensureTab(tabId, { mode: initialInspectorMode(tabRecord) });
  }
  var tab = useTab(tabId);
  if (tab === undefined) {
    tab = ensureTab(tabId, { mode: initialInspectorMode(tabRecord) });
  }
  var pluginConfig = usePluginConfig();
  var features = pluginConfig.values;
  var shortcutSnapshotState = React.useState(function () {
    return nudgeShortcutState();
  });
  var shortcutSnapshot = shortcutSnapshotState[0];
  var setShortcutSnapshot = shortcutSnapshotState[1];
  React.useEffect(function () {
    return subscribeNudgeShortcuts(function () {
      setShortcutSnapshot(nudgeShortcutState());
    });
  }, []);
  // Fullscreen presentation: the right-Sidebar panel covers the conversation,
  // so publish this tab's presentation to the floating-composer manager. Only a
  // docked, visible Nudge tab in fullscreen keeps the composer floating; a
  // floating pane or another tab restores the normal layout.
  var floatingFullscreen = !!(tabInfo && tabInfo.sidebar && tabInfo.sidebar.fullscreen === true);
  var floatingVisible = !(tabInfo && tabInfo.tab && tabInfo.tab.visible === false);
  var floatingDocked = !(tabInfo && tabInfo.panel && tabInfo.panel.isFloating === true);
  var floatingActive = floatingFullscreen && floatingVisible && floatingDocked;
  React.useEffect(function () {
    setFloatingComposerRequest(tabId, sessionId, floatingActive);
    return function () {
      setFloatingComposerRequest(tabId, sessionId, false);
    };
  }, [floatingActive, sessionId, tabId]);
  // Annotate mode keeps the dock collapsed to the composer: the page owns the
  // annotate drag area above it. The page itself is never resized — its runtime
  // receives the dock height as a bottom safe area and clamps its own composer,
  // style card and annotation bar above the host input box (see the safe-area
  // effect below). Edit / browse modes behave like plain overlay browsing.
  var floatingAnnotating = tab.mode === 'annotate';
  React.useEffect(function () {
    setFloatingComposerAnnotating(tabId, floatingAnnotating);
    return function () {
      setFloatingComposerAnnotating(tabId, false);
    };
  }, [floatingAnnotating, tabId]);
  React.useEffect(function () {
    setFloatingComposerLabels({
      collapse: t('floating.collapse'),
      shrink: t('floating.shrink'),
      expand: t('floating.expand'),
    });
  }, [t]);
  var carrierRef = React.useRef(null);
  var previousRevisionRef = React.useRef(null);
  var viewportRef = React.useRef(null);
  var queueRef = React.useRef(null);
  var tabRef = React.useRef(tab);
  tabRef.current = tab;
  var workspaces = typeof props.useWorkspaces === 'function' ? props.useWorkspaces(function (snap) { return snap; }) : null;
  var workspaceKey = React.useMemo(function () {
    return sessionId ? workspaceKeyFor(sessionId, workspaces) : 'session:none';
  }, [sessionId, workspaces && workspaces.phase, workspaces && workspaces.items]);
  var [sending, setSending] = React.useState(false);
  // One dock, one panel: DOM tree and Workspace used to open side by side and
  // squeezed the page to zero. `dock` is the single source of truth; the toolbar
  // still consumes domOpen / workspaceOpen, which now describe the active tab.
  var dockState = React.useState('none');
  var dock = dockState[0];
  var setDock = dockState[1];
  var domOpen = dock === 'dom';
  var workspaceOpen = dock === 'workspace';
  function toggleDock(next) {
    setDock(function (previous) {
      return previous === next ? 'none' : next;
    });
  }
  var dockWidthState = React.useState(readDockWidth);
  var dockWidth = dockWidthState[0];
  var setDockWidth = dockWidthState[1];
  var dockHostRef = React.useRef(null);
  var dockHostState = React.useState(0);
  var dockHostWidth = dockHostState[0];
  var setDockHostWidth = dockHostState[1];
  // The workspace panel owns its refresh action; the dock header borrows it.
  var workspaceRefreshRef = React.useRef(null);
  var [notice, setNotice] = React.useState(null);
  // Host annotate bar mirror: the floating dock covers the in-page bar, so the
  // dock renders its own bar and needs the marker-toggle state.
  var markersHiddenState = React.useState(false);
  var markersHidden = markersHiddenState[0];
  var setMarkersHidden = markersHiddenState[1];
  var markersHiddenRef = React.useRef(false);
  markersHiddenRef.current = markersHidden;
  var runtimeLocale = React.useMemo(function () {
    return buildRuntimeLocale(t);
  }, [t]);

  // ----------------------------------------------------------- source sync queue
  if (queueRef.current === null) {
    queueRef.current = createSyncQueue(
      props.ctx,
      tabId,
      function () { return tabRef.current; },
      function () { return sessionIdRef.current; },
      function (meta) {
        // Host-issued element handles are the cheapest locator for the next edit
        // on the same selector; preview candidates stay on the tab for diagnostics.
        if (!meta) return;
        mutateTab(tabId, function (draft) {
          if (meta.handles && Object.keys(meta.handles).length > 0) {
            draft.handles = Object.assign({}, draft.handles || {}, meta.handles);
          }
          if (meta.candidates && meta.candidates.length > 0) {
            draft.sync = Object.assign({}, draft.sync || {}, { candidates: meta.candidates });
          }
        });
      },
    );
  }

  // ------------------------------------------------ Host capability handshake
  React.useEffect(function () {
    probeHostCapabilities(props.ctx).catch(function () {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------------------------------------------------------- sync feedback
  // The queue only writes `tab.sync`; without this bridge a dropped batch looks
  // exactly like a successful one (no file change, no visible error).
  var syncState = tab && tab.sync ? tab.sync : null;
  var syncStatus = syncState && typeof syncState.status === 'string' ? syncState.status : 'idle';
  var syncAt = syncState && typeof syncState.at === 'number' ? syncState.at : 0;
  React.useEffect(function () {
    // Only a fully synced batch auto-dismisses: error / partial / preview copy
    // must stay until the next sync (or the user closes it) or the write-back
    // problem would disappear with the toast.
    if (syncStatus === 'error') {
      setNotice({ tone: 'error', text: t('dock.syncFailed') + syncNoticeSuffix(syncState && syncState.message) });
      return undefined;
    }
    if (syncStatus === 'partial') {
      var partialMeta = syncState && syncState.meta ? syncState.meta : null;
      var partialText;
      if (partialMeta && typeof partialMeta.synced === 'number') {
        partialText = t('dock.syncPartialText', {
          synced: String(partialMeta.synced),
          preview: String(partialMeta.preview),
          reason: syncReasonText(t, partialMeta.reason),
        });
      } else {
        partialText = (syncState && syncState.message ? String(syncState.message) : '') || t('dock.syncPartial');
      }
      setNotice({ tone: 'warning', text: partialText });
      return undefined;
    }
    if (syncStatus === 'preview') {
      var reason = syncState && syncState.message ? String(syncState.message) : '';
      // A reason code the Host does not even recognize while the Host lacks the
      // `insert` capability is a build mismatch, not a locate failure: say so.
      if (reason === 'unsupported-edit-kind' && !hostHasCapability('insert')) {
        setNotice({ tone: 'warning', text: t('dock.syncHostStale') });
        return undefined;
      }
      var reasonText = reason === 'no-source-mapping' ? '' : syncReasonText(t, reason);
      setNotice({
        tone: 'info',
        text: reason === 'no-source-mapping' ? t('dock.syncDisabled') : t('dock.syncPreview') + syncNoticeSuffix(reasonText),
      });
      return undefined;
    }
    if (syncStatus === 'done') {
      var doneText = t('dock.syncSynced') + syncNoticeSuffix(syncState && syncState.message);
      setNotice({ tone: 'info', text: doneText });
      var timer = setTimeout(function () {
        setNotice(function (current) { return current && current.text === doneText ? null : current; });
      }, SYNC_NOTICE_DISMISS_MS);
      return function () { clearTimeout(timer); };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncStatus, syncAt]);

  // ----------------------------------------------------------- carrier mount
  React.useEffect(function () {
    var container = viewportRef.current;
    if (!container) return undefined;
    var carrier = createCarrier({
      sessionId: sessionId,
      workspaceKey: workspaceKey,
      container: container,
      theme: theme,
      localeStrings: runtimeLocale,
      callbacks: {
        carrier: function (payload) {
          patchTab(tabId, { carrier: payload.kind });
        },
        ready: function () {
          patchTab(tabId, { ready: true });
        },
        loading: function (payload) {
          patchTab(tabId, { loading: payload.loading });
        },
        navigation: function (payload) {
          patchTab(tabId, {
            canGoBack: payload.canGoBack,
            canGoForward: payload.canGoForward,
            url: payload.url || tabRef.current.url,
          });
        },
        navigated: function (payload) {
          if (payload.url) patchTab(tabId, { url: payload.url });
        },
        title: function (payload) {
          if (payload.title) patchTab(tabId, { title: payload.title });
        },
        loaded: function () {
          patchTab(tabId, { loading: false });
          restoreRuntime();
        },
        error: function (payload) {
          patchTab(tabId, {
            loading: false,
            error: payload.description ? String(payload.description) : 'load-failed',
          });
        },
        'runtime-missing': function () {
          patchTab(tabId, { error: 'runtime-missing' });
        },
        'runtime-ready': function () {
          patchTab(tabId, { error: null });
          pollOnce();
        },
      },
    });
    carrierRef.current = carrier;
    var initialUrl = null;
    try {
      initialUrl = tabRecord && tabRecord.navigation && tabRecord.navigation.params ? tabRecord.navigation.params.url : null;
    } catch (error) {
      initialUrl = null;
    }
    if (!initialUrl) {
      try {
        initialUrl = localStorage.getItem('dsh.nudge.url.' + tabId);
      } catch (error) {
        initialUrl = null;
      }
    }
    if (!initialUrl && tabRef.current.url) initialUrl = tabRef.current.url;
    var cancelled = false;
    carrier.mount().then(function () {
      if (cancelled) return;
      if (initialUrl && isHttpUrl(initialUrl)) {
        patchTab(tabId, { url: initialUrl });
        carrier.load(initialUrl);
        return;
      }
      if (initialUrl || tabRef.current.url) return;
      // A freshly opened workspace folder has no page yet: land on its first
      // HTML file so the address bar starts on something real. Never overrides
      // an explicit / restored URL, and stays a no-op when the Host cannot
      // serve a preview or the feature is switched off.
      if (features.enableWorkspaceVersions === false) return;
      defaultWorkspaceUrl(createRemote(props.ctx), sessionId).then(function (url) {
        if (cancelled || !url || tabRef.current.url) return;
        patchTab(tabId, { url: url, error: null });
        carrier.load(url);
      });
    });
    var pollTimer = setInterval(function () {
      pollOnce();
    }, 170);
    var stopCommands = null;
    try {
      if (tabRecord && tabRecord.actions && typeof tabRecord.actions.bindCommands === 'function') {
        stopCommands = tabRecord.actions.bindCommands({
          refresh: function () {
            carrier.reload();
          },
        });
      }
    } catch (error) {
      stopCommands = null;
    }
    return function () {
      cancelled = true;
      clearInterval(pollTimer);
      if (typeof stopCommands === 'function') {
        try {
          stopCommands();
        } catch (error) {
          /* ignore */
        }
      }
      carrierRef.current = null;
      carrier.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, sessionId]);

  // ------------------------------------------------- page safe area
  // While the floating composer dock covers the page bottom, the page runtime
  // clamps its own floating UI (annotation composer, style card, annotation
  // bar) above the dock. The page is always full height; host DOM is simply a
  // higher layer than the embedded page, so the dock height is published as a
  // bottom safe area instead of shrinking the page.
  React.useEffect(function () {
    function publish(inset) {
      var carrier = carrierRef.current;
      if (!carrier || typeof carrier.setBottomInset !== 'function') return;
      Promise.resolve(carrier.setBottomInset(inset)).catch(function () {});
    }
    var unsubscribe = subscribeFloatingComposerInset(publish);
    return function () {
      unsubscribe();
      publish(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  React.useEffect(function () {
    var carrier = carrierRef.current;
    if (!carrier || typeof carrier.setBottomInset !== 'function') return;
    Promise.resolve(carrier.setBottomInset(floatingComposerInset())).catch(function () {});
  }, [tab.ready, tab.url]);

  // ------------------------------------------------- host annotate bar
  // Fullscreen: the page lives in a webview under the floating composer, so its
  // own annotate bar cannot paint above the input box. The dock renders a host
  // bar (draggable anywhere) and tells the page to hide its built-in one.
  React.useEffect(function () {
    var carrier = carrierRef.current;
    if (!carrier || typeof carrier.setBarHosted !== 'function') return undefined;
    Promise.resolve(carrier.setBarHosted(floatingActive === true)).catch(function () {});
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floatingActive, tab.ready]);

  React.useEffect(function () {
    function forward(name) {
      var carrier = carrierRef.current;
      if (!carrier) return;
      if (name === 'toggleMarkers') {
        if (typeof carrier.toggleMarkers !== 'function') return;
        Promise.resolve(carrier.toggleMarkers())
          .then(function (hidden) {
            if (typeof hidden === 'boolean') {
              markersHiddenRef.current = hidden;
              setMarkersHidden(hidden);
            }
          })
          .catch(function () {});
        return;
      }
      if (typeof carrier[name] !== 'function') return;
      Promise.resolve(carrier[name]()).catch(function () {});
    }
    setFloatingAnnotationBarHandlers({
      send: function () { forward('sendAnnotations'); },
      exit: function () { forward('exitAnnotate'); },
      discard: function () { forward('discardAnnotations'); },
      locate: function () { forward('locateLastAnnotation'); },
      toggleMarkers: function () { forward('toggleMarkers'); },
    });
    return function () {
      setFloatingAnnotationBarHandlers(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  React.useEffect(function () {
    setFloatingAnnotationBarState({
      visible: floatingActive === true && tab.mode === 'annotate',
      count: (tab.annotations || []).length,
      markersHidden: markersHidden,
      dark: theme.isDark === true,
      danger: theme.danger,
      labels: {
        annotating: runtimeLocale.statusAnnotating,
        send: runtimeLocale.statusSend,
        exit: runtimeLocale.statusExit,
        locate: runtimeLocale.statusLocate,
        hideMarkers: runtimeLocale.statusHideMarkers,
        showMarkers: runtimeLocale.statusShowMarkers,
        discard: runtimeLocale.statusDiscard,
        discardArmed: runtimeLocale.statusDiscardArmed,
        moveToolbar: runtimeLocale.statusMoveToolbar,
      },
    });
    return undefined;
  }, [floatingActive, tab.mode, tab.annotations && tab.annotations.length, markersHidden, runtimeLocale, theme.isDark, theme.danger]);

  React.useEffect(function () {
    if (!(floatingActive === true && tab.mode === 'annotate')) return undefined;
    function sync() {
      var carrier = carrierRef.current;
      if (!carrier || typeof carrier.getBarState !== 'function') return;
      Promise.resolve(carrier.getBarState())
        .then(function (state) {
          if (state && typeof state.markersHidden === 'boolean' && state.markersHidden !== markersHiddenRef.current) {
            markersHiddenRef.current = state.markersHidden;
            setMarkersHidden(state.markersHidden);
          }
        })
        .catch(function () {});
    }
    sync();
    var timer = setInterval(sync, 800);
    return function () {
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floatingActive, tab.mode, tab.ready]);

  // ----------------------------------------------------------- runtime prefs
  React.useEffect(function () {
    var carrier = carrierRef.current;
    if (!carrier) return;
    carrier.applyPreferences(theme, runtimeLocale);
  }, [theme, runtimeLocale]);

  React.useEffect(function () {
    var carrier = carrierRef.current;
    if (!carrier || !tab.ready) return;
    carrier.setMode(tab.mode);
    if (tab.mode === 'browse') {
      carrier.clearSelection();
    }
  }, [tab.mode, tab.ready]);

  // Host-level Esc: the page runtime exits annotate/edit from inside the guest
  // document, but focus can sit on host chrome (toolbar, dock, panel). Mirror
  // the same exit here so Esc works from anywhere in the panel. Skip events
  // another surface already handled, text fields, modifier chords, the shortcut
  // sheet itself (the sheet owns its Esc), and hidden mounted tabs — keepMounted
  // bodies stay alive, so a background tab must not react to Esc.
  React.useEffect(function () {
    if (tab.mode === 'browse' || !floatingVisible) return undefined;
    function onHostKeyDown(event) {
      if (event.defaultPrevented || event.isComposing === true) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableShortcutTarget(event.target)) return;
      if (document.querySelector('[data-shortcut-sheet]') !== null) return;
      patchTab(tabId, { mode: 'browse' });
    }
    window.addEventListener('keydown', onHostKeyDown);
    return function () {
      window.removeEventListener('keydown', onHostKeyDown);
    };
  }, [tab.mode, tabId, floatingVisible]);

  React.useEffect(function () {
    if (tab.url) {
      try {
        localStorage.setItem('dsh.nudge.url.' + tabId, tab.url);
      } catch (error) {
        /* ignore */
      }
    }
  }, [tab.url, tabId]);

  // Disabled product features must not leave the surface in a stale state.
  React.useEffect(function () {
    if (tab.mode === 'annotate' && features.enableAnnotate === false) patchTab(tabId, { mode: 'browse' });
    else if (tab.mode === 'edit' && features.enableEdit === false) patchTab(tabId, { mode: 'browse' });
  }, [tab.mode, features.enableAnnotate, features.enableEdit, tabId]);

  React.useEffect(function () {
    if (features.enableDomTree === false && dock === 'dom') setDock('none');
    if (features.enableWorkspaceVersions === false && dock === 'workspace') setDock('none');
  }, [features.enableDomTree, features.enableWorkspaceVersions, dock]);

  // The dock switches from a docked column to an overlay drawer when the tab
  // body gets too narrow for a split page + panel to both stay usable.
  React.useEffect(function () {
    var node = dockHostRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    var observer = new ResizeObserver(function (entries) {
      var width = entries[0] && entries[0].contentRect ? entries[0].contentRect.width : node.clientWidth;
      setDockHostWidth(width);
    });
    observer.observe(node);
    return function () {
      observer.disconnect();
    };
  }, []);
  var dockOverlay = dockHostWidth > 0 && dockHostWidth < NUDGE_DOCK_NARROW;

  // ----------------------------------------------------------- hot reload
  // Poll the Host watcher (~900ms). The first response only records the
  // baseline revision; later changes reload in browse mode, and defer while the
  // user is annotating/editing by setting `reloadPending` on the tab.
  React.useEffect(function () {
    if (!sessionId || tab.hotReload === false || features.enableHotReload === false) return undefined;
    var remote = createRemote(props.ctx);
    var cancelled = false;
    var reloadTimer = null;
    var previousRevision = null;
    previousRevisionRef.current = null;

    function scheduleReload() {
      if (reloadTimer !== null) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(function () {
        reloadTimer = null;
        if (cancelled) return;
        if (carrierRef.current) carrierRef.current.reload();
      }, HOT_RELOAD_DEBOUNCE_MS);
    }

    function pollWatch() {
      remote('watchPoll', watchPollArgs(sessionId)).then(function (result) {
        if (cancelled || !result) return;
        var revision = typeof result.revision === 'number' ? result.revision : null;
        if (revision === null) return;
        var decision = hotReloadDecision(previousRevision, revision, tabRef.current.mode);
        previousRevision = revision;
        previousRevisionRef.current = revision;
        if (decision === 'reload') {
          scheduleReload();
        } else if (decision === 'defer') {
          patchTab(tabId, { reloadPending: true });
          setNotice({ tone: 'info', text: t('hotReload.pending') });
        }
      }).catch(function () {
        /* watcher unavailable or transient bridge failure: keep polling */
      });
    }

    pollWatch();
    var pollTimer = setInterval(pollWatch, HOT_RELOAD_POLL_MS);
    return function () {
      cancelled = true;
      clearInterval(pollTimer);
      if (reloadTimer !== null) {
        clearTimeout(reloadTimer);
        reloadTimer = null;
      }
      previousRevisionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, sessionId, tab.hotReload, tab.url, features.enableHotReload]);

  // Apply a deferred reload once the user is back in browse mode.
  React.useEffect(function () {
    if (tab.mode !== 'browse' || tab.reloadPending !== true) return undefined;
    var timer = setTimeout(function () {
      patchTab(tabId, { reloadPending: false });
      if (carrierRef.current) carrierRef.current.reload();
    }, HOT_RELOAD_DEBOUNCE_MS);
    return function () {
      clearTimeout(timer);
    };
  }, [tab.mode, tab.reloadPending, tabId]);

  // ----------------------------------------------------------- poll loop
  function pollOnce() {
    var carrier = carrierRef.current;
    if (!carrier || !carrier.runtimeReady) return;
    carrier.drainEvents().then(function (events) {
      if (!Array.isArray(events) || events.length === 0) return;
      handleRuntimeEvents(events);
    }).catch(function () {});
  }

  /** Record one applied edit, tagging it with the page it belongs to (replay scope). */
  function recordEdit(operation) {
    return recordOperation(tabId, Object.assign({}, operation, { pageUrl: tabRef.current.url || '' }));
  }

  function handleRuntimeEvents(events) {
    var next = null;
    events.forEach(function (event) {
      if (!event || typeof event !== 'object') return;
      if (event.type === 'select') {
        next = event.descriptor || null;
        patchTab(tabId, { selection: next, selectionSeq: Date.now() });
      } else if (event.type === 'selection-lost') {
        patchTab(tabId, { selection: null });
      } else if (event.type === 'page-info') {
        patchTab(tabId, { url: event.url || tabRef.current.url, title: event.title || tabRef.current.title });
      } else if (event.type === 'annotate-add' && event.annotation) {
        var existing = tabRef.current.annotations || [];
        var replaced = existing.filter(function (item) { return item.id !== event.annotation.id; });
        patchTab(tabId, { annotations: replaced.concat([event.annotation]) });
      } else if (event.type === 'annotate-update' && event.annotation) {
        patchTab(tabId, {
          annotations: (tabRef.current.annotations || []).map(function (item) {
            return item.id === event.annotation.id ? event.annotation : item;
          }),
        });
      } else if (event.type === 'annotate-remove' && event.id) {
        patchTab(tabId, {
          annotations: (tabRef.current.annotations || []).filter(function (item) { return item.id !== event.id; }),
        });
      } else if (event.type === 'annotation-send') {
        insertToComposer();
      } else if (event.type === 'mode-change' && (event.mode === 'browse' || event.mode === 'annotate' || event.mode === 'edit')) {
        // The page runtime owns its own mode shortcuts (Esc / Shift+Tab); mirror
        // the authoritative mode instead of guessing from annotation events.
        if (tabRef.current.mode !== event.mode) patchTab(tabId, { mode: event.mode });
      } else if (event.type === 'annotation-exit') {
        patchTab(tabId, { mode: 'browse' });
      } else if (event.type === 'design-style' && event.selector && event.property) {
        var selection = tabRef.current.selection;
        var same = selection && selection.selector === event.selector;
        var operation = {
          kind: 'style',
          selector: event.selector,
          path: event.path || (same ? selection.path : undefined),
          property: event.property,
          before: event.before,
          after: event.after,
          coalesceKey: 'style|' + event.selector + '|' + event.property,
          sourceHints: same ? sourceHintFromDescriptor(selection) : undefined,
          outerHTML: same ? selection.outerHTML : undefined,
          textSnippet: same ? selection.text : undefined,
        };
        var opId = recordEdit(operation);
        enqueueOperation(operation, opId);
        refreshSelection();
      } else if (event.type === 'design-text' && event.selector) {
        var textSelection = tabRef.current.selection;
        var textSame = textSelection && textSelection.selector === event.selector;
        var textOperation = {
          kind: 'text',
          selector: event.selector,
          path: event.path || (textSame ? textSelection.path : undefined),
          before: event.before,
          after: event.after,
          coalesceKey: 'text|' + event.selector,
          sourceHints: textSame ? sourceHintFromDescriptor(textSelection) : undefined,
          outerHTML: textSame ? textSelection.outerHTML : undefined,
          textSnippet: textSame ? textSelection.text : undefined,
        };
        var textOpId = recordEdit(textOperation);
        enqueueOperation(textOperation, textOpId);
        refreshSelection();
      } else if (event.type === 'design-attr' && event.selector && event.attrName) {
        var attrSelection = tabRef.current.selection;
        var attrSame = attrSelection && attrSelection.selector === event.selector;
        var attrOperation = {
          kind: 'attr',
          selector: event.selector,
          path: event.path || (attrSame ? attrSelection.path : undefined),
          attrName: event.attrName,
          before: event.before,
          after: event.after,
          coalesceKey: 'attr|' + event.selector + '|' + event.attrName,
          sourceHints: attrSame ? sourceHintFromDescriptor(attrSelection) : undefined,
          outerHTML: attrSame ? attrSelection.outerHTML : undefined,
          textSnippet: attrSame ? attrSelection.text : undefined,
        };
        var attrOpId = recordEdit(attrOperation);
        enqueueOperation(attrOperation, attrOpId);
        refreshSelection();
      } else if (event.type === 'design-structure' && event.selector && (event.op === 'remove' || event.op === 'move')) {
        var structureSelection = tabRef.current.selection;
        var structureSame = structureSelection && structureSelection.selector === event.selector;
        var structureOperation = {
          kind: event.op,
          selector: event.selector,
          path: event.path || (structureSame ? structureSelection.path : undefined),
          outerHTML: event.outerHTML || (structureSame ? structureSelection.outerHTML : undefined),
          outerHTMLTruncated: event.outerHTMLTruncated === true,
          textBefore: event.textBefore || event.textSnippet || (structureSame ? structureSelection.text : undefined),
          textSnippet: event.textSnippet || (structureSame ? structureSelection.text : undefined),
          elementKey: event.elementKey,
          handle: event.handle,
          sourceHints: event.sourceHints || (structureSame ? sourceHintFromDescriptor(structureSelection) : undefined),
          // One structural gesture is one history step; never merge two of them.
          coalesceKey: '',
        };
        if (event.op === 'remove') {
          structureOperation.parentSelector = event.parentSelector == null ? null : event.parentSelector;
          structureOperation.beforeSelector = event.beforeSelector == null ? null : event.beforeSelector;
        }
        if (event.op === 'move') {
          structureOperation.targetParentSelector = event.targetParentSelector;
          structureOperation.targetParentPath = event.targetParentPath;
          structureOperation.targetParentOuterHTML = event.targetParentOuterHTML;
          structureOperation.targetParentTextBefore = event.targetParentTextBefore;
          structureOperation.beforeSelector = event.beforeSelector == null ? null : event.beforeSelector;
          structureOperation.beforePath = event.beforePath;
          structureOperation.beforeOuterHTML = event.beforeOuterHTML;
          structureOperation.beforeTextBefore = event.beforeTextBefore;
          structureOperation.fromParentSelector = event.fromParentSelector == null ? null : event.fromParentSelector;
          structureOperation.fromBeforeSelector = event.fromBeforeSelector == null ? null : event.fromBeforeSelector;
        }
        var structureOpId = recordEdit(structureOperation);
        enqueueOperation(structureOperation, structureOpId);
        if (event.op === 'remove') patchTab(tabId, { selection: null });
        else refreshSelection();
      }
    });
  }


  function restoreRuntime() {
    var carrier = carrierRef.current;
    if (!carrier) return;
    var tab = tabRef.current;
    // Re-apply only the runtime preview of this page: undone ops, ops the Host
    // already committed to disk, and ops recorded on another page or after the
    // history pointer are all excluded (a persisted remove would otherwise hit
    // the next sibling once the source order shifted).
    var edits = replayableOperations(historyOf(tab), tab.url)
      .map(runtimeEditFor)
      .filter(function (edit) { return edit !== null; });
    carrier.injectRuntime(tab.mode, edits).then(function (ok) {
      if (ok) pollOnce();
    }).catch(function () {});
  }

  // ----------------------------------------------------------- navigation
  function navigate(raw) {
    var parsed = parseAddress(raw, window.location.origin);
    if (!parsed.ok) {
      setNotice({ tone: 'error', text: t('address.' + parsed.reason) });
      return false;
    }
    setNotice(null);
    patchTab(tabId, { url: parsed.url, error: null });
    if (carrierRef.current) {
      carrierRef.current.load(parsed.url);
    }
    return true;
  }

  function reload() {
    if (carrierRef.current) carrierRef.current.reload();
  }
  function goBack() {
    if (carrierRef.current) carrierRef.current.goBack();
  }
  function goForward() {
    if (carrierRef.current) carrierRef.current.goForward();
  }
  function external() {
    if (tabRef.current.url && isHttpUrl(tabRef.current.url)) window.open(tabRef.current.url, '_blank', 'noopener,noreferrer');
  }

  // ----------------------------------------------------------- edit actions
  function currentSelection() {
    return tabRef.current.selection;
  }

  function refreshSelection() {
    var carrier = carrierRef.current;
    var selection = currentSelection();
    if (!carrier || !selection || !selection.selector) return;
    carrier.describe(selection.selector).then(function (descriptor) {
      if (descriptor) {
        patchTab(tabId, { selection: descriptor });
      }
    }).catch(function () {});
  }

  function enqueueOperation(operation, operationId) {
    var opId = operationId || makeId('op');
    // A handle the Host issued for this selector is the cheapest locator for the
    // next edit; cached handles travel with every edit kind that has a selector.
    var cachedHandle = operation.handle;
    if (!cachedHandle && operation.selector && tabRef.current.handles) {
      cachedHandle = tabRef.current.handles[operation.selector];
    }
    queueRef.current.enqueue({
      id: (operation.coalesceKey || operation.kind) + '|' + opId,
      opId: opId,
      kind: operation.kind,
      selector: operation.selector,
      path: operation.path,
      property: operation.property,
      value: operation.kind === 'style' ? operation.after : undefined,
      before: operation.before,
      after: operation.after,
      attrName: operation.attrName,
      sourceHints: operation.sourceHints,
      outerHTML: operation.outerHTML,
      outerHTMLTruncated: operation.outerHTMLTruncated,
      textSnippet: operation.textSnippet,
      textBefore: operation.textBefore,
      elementKey: operation.elementKey,
      handle: cachedHandle,
      html: operation.html,
      parentSelector: operation.parentSelector,
      beforeSelector: operation.beforeSelector,
      fromParentSelector: operation.fromParentSelector,
      fromBeforeSelector: operation.fromBeforeSelector,
      targetParentSelector: operation.targetParentSelector,
      targetParentPath: operation.targetParentPath,
      targetParentOuterHTML: operation.targetParentOuterHTML,
      targetParentTextBefore: operation.targetParentTextBefore,
      beforePath: operation.beforePath,
      beforeOuterHTML: operation.beforeOuterHTML,
      beforeTextBefore: operation.beforeTextBefore,
    });
  }

  // ----------------------------------------------------------- undo / redo
  var history = historyOf(tab);
  var canUndo = history.index >= 0 && history.ops.length > 0;
  var canRedo = history.index < history.ops.length - 1;

  /**
   * Undo/redo both text/style edits and structure edits. The inverse dependency
   * bag stays here; the rules live in `applyHistoryStep` (tested in
   * test/client-smoke.mjs).
   */
  function stepHistory(direction) {
    return applyHistoryStep(
      {
        tab: tabRef.current,
        carrier: carrierRef.current,
        translate: t,
        advance: function (dir) {
          mutateTab(tabId, function (draft) {
            var h = historyOf(draft);
            draft.history = Object.assign({}, h, { index: dir === 'undo' ? h.index - 1 : h.index + 1, lastKey: '' });
          });
        },
        enqueue: function (record) {
          // Corrective writes are not history entries: give an unnamed record its
          // own queue id so two quick undos never coalesce, and so the original
          // op (which keeps `undone`) is not re-mapped by the corrective result.
          queueRef.current.enqueue(record.opId === undefined ? Object.assign({}, record, { opId: record.id }) : record);
        },
        mark: function (op, status) {
          updateOperationStatus(tabId, [op.id], status, '');
        },
        refresh: refreshSelection,
        notice: function (tone, text) {
          setNotice({ tone: tone, text: text });
        },
      },
      direction,
    );
  }

  // ----------------------------------------------------------- annotations
  function captureAnnotationScreenshots(annotations) {
    var carrier = carrierRef.current;
    if (!carrier || carrier.kind !== 'webview' || typeof carrier.capture !== 'function') return Promise.resolve(annotations);
    return Promise.all(annotations.map(function (annotation) {
      var rect = (annotation.textSelection && annotation.textSelection.rect) || annotation.region || (annotation.element && annotation.element.rect) || null;
      if (!rect) return annotation;
      var captureRect = {
        x: Math.max(0, Math.floor(rect.x - 6)),
        y: Math.max(0, Math.floor(rect.y - 6)),
        width: Math.max(1, Math.ceil(rect.width + 12)),
        height: Math.max(1, Math.ceil(rect.height + 12)),
      };
      return carrier.capture(captureRect).then(function (dataUrl) {
        if (!dataUrl) return annotation;
        var withThumb = Object.assign({}, annotation, { thumbnail: dataUrl });
        var remote = createRemote(props.ctx);
        return remote('saveScreenshot', {
          session: sessionId,
          annotationId: annotation.id,
          dataUrl: dataUrl,
        }).then(function (result) {
          return Object.assign({}, withThumb, { screenshotPath: result.relativePath || result.path });
        }).catch(function () {
          return withThumb;
        });
      }).catch(function () {
        return annotation;
      });
    }));
  }

  function appliedOperations() {
    var history = historyOf(tabRef.current);
    return history.ops.filter(function (op, index) {
      return index <= history.index;
    });
  }

  /**
   * Insert the current page annotations (as clip cards) and the applied visual
   * edits into the conversation composer. The composer keeps them until the
   * user sends a message; `installClipSend()` appends the structured context.
   */
  function insertToComposer() {
    if (sending) return;
    var annotations = tabRef.current.annotations || [];
    var ops = appliedOperations();
    if (annotations.length === 0 && ops.length === 0) return;
    var pendingOps = ops.filter(function (op) {
      return !isOpConsumed(op.id);
    });
    if (!sessionId) {
      var fallback = buildAgentPrompt(tabRef.current, annotations, ops);
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(fallback).catch(function () {});
      }
      setNotice({ tone: 'success', text: t('annotation.copied') });
      return;
    }
    setSending(true);
    captureAnnotationScreenshots(annotations).then(function (withScreenshots) {
      var clips = withScreenshots.map(function (annotation) {
        var element = annotation.element || {};
        var selectionText = annotation.textSelection && annotation.textSelection.text ? annotation.textSelection.text : '';
        return {
          id: annotation.id,
          tabId: tabId,
          tag: String(element.tag || (annotation.region ? 'region' : 'text')).toLowerCase(),
          selector: annotation.selector || '',
          note: annotation.note || '',
          text: element.text || selectionText || '',
          textSelection: selectionText || null,
          region: annotation.region || null,
          thumbnail: annotation.thumbnail || null,
          screenshotPath: annotation.screenshotPath || null,
          pageUrl: tabRef.current.url || '',
          pageTitle: tabRef.current.title || '',
          createdAt: Date.now(),
        };
      });
      insertClips(sessionId, { clips: clips, ops: pendingOps, tabId: tabId });
      // DSH exposes the conversation service per Session scope: wrap this
      // Session's send path now, before the composer can send the cards.
      installClipSendForSession(props.ctx, sessionId);
      var carrier = carrierRef.current;
      annotations.forEach(function (annotation) {
        if (carrier) carrier.removeAnnotation(annotation.id);
      });
      patchTab(tabId, { annotations: [] });
      setNotice({ tone: 'success', text: t('annotation.inserted') });
      setSending(false);
    }).catch(function (error) {
      setNotice({ tone: 'error', text: t('annotation.insertFailed', { message: String(error && error.message ? error.message : error) }) });
      setSending(false);
    });
  }

  // ----------------------------------------------------------- shortcuts
  // Every registered command lands here; panel toggles use functional state so
  // a command queued while the tab was opening still flips the right value.
  function runShortcutAction(action) {
    if (action === 'annotate' || action === 'edit') {
      patchTab(tabId, { mode: tabRef.current.mode === action ? 'browse' : action });
      return;
    }
    if (action === 'dom') {
      toggleDock('dom');
      return;
    }
    if (action === 'workspace') {
      toggleDock('workspace');
    }
  }

  React.useEffect(function () {
    return registerNudgeTabCommands(tabId, sessionId, { run: runShortcutAction });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, sessionId]);

  var shortcutBindings = {};
  var shortcutRows = [];
  NUDGE_SHORTCUT_COMMANDS.forEach(function (command) {
    var binding = nudgeShortcutBinding(command.id);
    shortcutBindings[command.id] = binding;
    shortcutRows.push({
      id: command.id,
      label: t(command.label),
      binding: binding,
      disabled: command.feature ? features[command.feature] === false : false,
    });
  });
  shortcutBindings['page.refresh'] = nudgeShortcutBinding('page.refresh');
  shortcutRows.push({
    id: NUDGE_SHORTCUT_SPACE.id,
    label: t(NUDGE_SHORTCUT_SPACE.label),
    binding: { code: 'Space', modifiers: [] },
    pageLocal: true,
  });
  NUDGE_SHORTCUT_PAGE_KEYS.forEach(function (pageKey) {
    shortcutRows.push({
      id: pageKey.id,
      label: t(pageKey.label),
      binding: pageKey.bindings[0],
      pageLocal: true,
    });
  });

  // ----------------------------------------------------------- render

  return React.createElement(
    'div',
    {
      'data-dsh-nudge-root': '',
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        color: theme.text,
        background: theme.base,
        font: 'var(--dsw-font-xxs-12, 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif)',
      },
    },
    React.createElement(InspectorToolbar, {
      t: t,
      theme: theme,
      tab: tab,
      carrierKind: tab.carrier,
      onBack: goBack,
      onForward: goForward,
      onReload: reload,
      onNavigate: navigate,
      onMode: function (mode) {
        patchTab(tabId, { mode: mode });
      },
      onUndo: function () { stepHistory('undo'); },
      onRedo: function () { stepHistory('redo'); },
      canUndo: canUndo,
      canRedo: canRedo,
      onExternal: external,
      domOpen: domOpen,
      onToggleDom: function () {
        toggleDock('dom');
      },
      workspaceOpen: workspaceOpen,
      onToggleWorkspace: function () {
        toggleDock('workspace');
      },
      shortcuts: {
        platform: shortcutSnapshot.platform,
        bindings: shortcutBindings,
        rows: shortcutRows,
      },
      features: {
        annotate: features.enableAnnotate !== false,
        edit: features.enableEdit !== false,
        domTree: features.enableDomTree !== false,
        workspaceVersions: features.enableWorkspaceVersions !== false,
        hotReload: features.enableHotReload !== false,
      },
      hotReload: tab.hotReload !== false,
      reloadPending: tab.reloadPending === true,
      onToggleHotReload: function () {
        patchTab(tabId, { hotReload: tabRef.current.hotReload === false, reloadPending: false });
      },
    }),
    notice
      ? React.createElement(
          'div',
          {
            role: 'status',
            style: {
              flex: 'none',
              padding: '5px 12px',
              color: notice.tone === 'error' ? theme.danger : notice.tone === 'warning' ? theme.warn : theme.muted,
              background:
                notice.tone === 'error'
                  ? 'color-mix(in srgb, ' + theme.danger + ' 10%, transparent)'
                  : notice.tone === 'warning'
                    ? 'color-mix(in srgb, ' + theme.warn + ' 12%, transparent)'
                    : theme.layer1,
              font: 'var(--dsw-font-xxxs-11, 11px/1.4 sans-serif)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            },
          },
          React.createElement('span', { style: { flex: 1, minWidth: 0 } }, notice.text),
          React.createElement(
            'button',
            {
              type: 'button',
              onClick: function () { setNotice(null); },
              style: { border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0 },
              'aria-label': t('dock.retry'),
            },
            React.createElement(Icon.close, { size: 11 }),
          ),
        )
      : null,
    tab.error && tab.error !== 'runtime-missing'
      ? React.createElement(
          'div',
          {
            role: 'alert',
            style: {
              flex: 'none',
              padding: '5px 12px',
              color: theme.danger,
              background: 'color-mix(in srgb, ' + theme.danger + ' 10%, transparent)',
              font: 'var(--dsw-font-xxxs-11, 11px/1.4 sans-serif)',
            },
          },
          t('address.loadFailed') + (tab.error ? ' · ' + tab.error : ''),
        )
      : null,
    React.createElement(
      'div',
      {
        ref: dockHostRef,
        'data-dsh-nudge-dock-host': '',
        style: { flex: 1, minHeight: 0, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'row', background: theme.layer1 },
      },
      React.createElement(
        'div',
        { style: { flex: '1 1 auto', minWidth: 0, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' } },
        React.createElement('div', {
          ref: viewportRef,
          'data-dsh-nudge-webview': '',
          style: { flex: 1, minHeight: 0, minWidth: 0, display: 'flex' },
        }),
      !tab.url
        ? React.createElement(
            'div',
            {
              style: {
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                color: theme.muted,
                background: theme.base,
                pointerEvents: 'none',
              },
            },
            React.createElement(Icon.globe, { size: 26 }),
            React.createElement('div', { style: { font: 'var(--dsw-font-xs-13, 13px/1.4 sans-serif)' } }, t('dock.noPage')),
          )
        : null,
      tab.loading
        ? React.createElement(
            'div',
            {
              style: {
                position: 'absolute',
                top: 8,
                left: 10,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                borderRadius: 999,
                background: theme.hover || theme.layer2,
                color: theme.muted,
                font: 'var(--dsw-font-xxxs-11, 11px/1.3 sans-serif)',
              },
            },
            React.createElement(Spinner, { theme: theme }),
            'Loading…',
          )
        : null,
      ),
      dock !== 'none' &&
      ((dock === 'dom' && features.enableDomTree !== false) ||
        (dock === 'workspace' && features.enableWorkspaceVersions !== false))
        ? React.createElement(
            NudgeDock,
            {
              t: t,
              theme: theme,
              active: dock,
              docked: !dockOverlay,
              width: dockWidth,
              overlayWidth: Math.max(
                NUDGE_DOCK_MIN_WIDTH,
                Math.min(320, (dockHostWidth > 0 ? dockHostWidth : 416) - 96),
              ),
              showDom: features.enableDomTree !== false,
              showWorkspace: features.enableWorkspaceVersions !== false,
              onTab: function (next) {
                setDock(next);
              },
              onClose: function () {
                setDock('none');
              },
              onResize: function (next) {
                setDockWidth(next);
              },
              onResizeEnd: function (next) {
                setDockWidth(next);
                writeDockWidth(next);
              },
              onRefresh:
                dock === 'workspace'
                  ? function () {
                      if (workspaceRefreshRef.current) workspaceRefreshRef.current();
                    }
                  : null,
            },
            dock === 'dom'
              ? React.createElement(DomTreePanel, {
                  t: t,
                  theme: theme,
                  carrier: carrierRef.current,
                  selection: tab.selection,
                  embedded: true,
                  onClose: function () {
                    setDock('none');
                  },
                })
              : React.createElement(NudgeWorkspacePanel, {
                  ctx: props.ctx,
                  t: t,
                  theme: theme,
                  sessionId: sessionId,
                  currentUrl: tab.url,
                  embedded: true,
                  refreshHandle: workspaceRefreshRef,
                  // A successful source write changes git state; let the panel reload
                  // its snapshot instead of waiting for a manual refresh.
                  refreshToken:
                    tab.sync && (tab.sync.status === 'done' || tab.sync.status === 'partial') && typeof tab.sync.at === 'number' ? tab.sync.at : 0,
                  onClose: function () {
                    setDock('none');
                  },
                  onNotice: function (nextNotice) {
                    setNotice(nextNotice);
                  },
                  onNavigate: navigate,
                  onReload: reload,
                }),
          )
        : null,
    ),
  );
}

// Engineering-test seam: the client factory only publishes `name`/`inject`/
// `apply`; a harness that opts in via `__DSH_VI_TEST_HOOKS__` (same seam as the
// theme bridge) can exercise the structure payload / replay / inverse rules
// without a browser. Production exports stay untouched.
if (typeof globalThis !== 'undefined' && globalThis.__DSH_VI_TEST_HOOKS__ === true) {
  exports.__dshnudgeSyncInternals = {
    buildRuntimeLocale: buildRuntimeLocale,
    syncReasonText: syncReasonText,
    replayableOperations: replayableOperations,
    runtimeEditFor: runtimeEditFor,
    applyInverse: applyInverse,
    followUpOperation: followUpOperation,
    applyHistoryStep: applyHistoryStep,
    rememberHostCapabilities: rememberHostCapabilities,
    hostHasCapability: hostHasCapability,
    hostCapabilitySnapshot: hostCapabilitySnapshot,
    defaultWorkspaceUrl: defaultWorkspaceUrl,
  };
}
