// @ts-nocheck
/**
 * The Visual Inspector tab body: toolbar + embedded page + property dock,
 * annotation dock, live Auto Apply editing, edit history and the async source
 * sync queue.
 */

function NudgeBody(props) {
  var t = props.t;
  var theme = useDshTheme(props.ctx);
  var tabInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo() : null;
  var tabRecord = tabInfo && tabInfo.tab ? tabInfo.tab : null;
  var tabId = tabRecord && tabRecord.id ? tabRecord.id : 'nudge-standalone';
  var sessionId = props.sessionId || (tabRecord && tabRecord.sessionId) || '';
  var initialized = React.useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    ensureTab(tabId, { mode: 'browse' });
  }
  var tab = useTab(tabId);
  if (tab === undefined) {
    tab = ensureTab(tabId, { mode: 'browse' });
  }
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
  var domState = React.useState(false);
  var domOpen = domState[0];
  var setDomOpen = domState[1];
  var workspaceState = React.useState(false);
  var workspaceOpen = workspaceState[0];
  var setWorkspaceOpen = workspaceState[1];
  var [notice, setNotice] = React.useState(null);
  var runtimeLocale = React.useMemo(function () {
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
      },
    };
  }, [t]);

  // ----------------------------------------------------------- source sync queue
  if (queueRef.current === null) {
    queueRef.current = createSyncQueue(props.ctx, tabId, function () { return tabRef.current; });
  }

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
    carrier.mount().then(function () {
      if (initialUrl && isHttpUrl(initialUrl)) {
        patchTab(tabId, { url: initialUrl });
        carrier.load(initialUrl);
      }
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

  React.useEffect(function () {
    if (tab.url) {
      try {
        localStorage.setItem('dsh.nudge.url.' + tabId, tab.url);
      } catch (error) {
        /* ignore */
      }
    }
  }, [tab.url, tabId]);

  // ----------------------------------------------------------- hot reload
  // Poll the Host watcher (~900ms). The first response only records the
  // baseline revision; later changes reload in browse mode, and defer while the
  // user is annotating/editing by setting `reloadPending` on the tab.
  React.useEffect(function () {
    if (!sessionId || tab.hotReload === false) return undefined;
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
  }, [tabId, sessionId, tab.hotReload, tab.url]);

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
        var opId = recordOperation(tabId, operation);
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
        var textOpId = recordOperation(tabId, textOperation);
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
        var attrOpId = recordOperation(tabId, attrOperation);
        enqueueOperation(attrOperation, attrOpId);
        refreshSelection();
      }
    });
  }


  function restoreRuntime() {
    var carrier = carrierRef.current;
    if (!carrier) return;
    var edits = (tabRef.current.history && tabRef.current.history.ops ? tabRef.current.history.ops : [])
      .filter(function (op) { return op.syncStatus !== 'undone'; })
      .map(function (op) {
        if (op.kind === 'style') return { kind: 'style', selector: op.selector, property: op.property, value: op.after };
        if (op.kind === 'text') return { kind: 'text', selector: op.selector, value: op.after };
        return { kind: 'attr', selector: op.selector, attrName: op.attrName, value: op.after };
      });
    carrier.injectRuntime(tabRef.current.mode, edits).then(function (ok) {
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
    queueRef.current.enqueue({
      id: operation.coalesceKey + '|' + opId,
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
      textSnippet: operation.textSnippet,
    });
  }

  // ----------------------------------------------------------- undo / redo
  var history = historyOf(tab);
  var canUndo = history.index >= 0 && history.ops.length > 0;
  var canRedo = history.index < history.ops.length - 1;

  function applyInverse(op, direction) {
    var carrier = carrierRef.current;
    if (!carrier) return Promise.resolve();
    if (op.kind === 'style') return carrier.applyStyle(op.selector, op.property, direction === 'undo' ? op.before : op.after);
    if (op.kind === 'text') return carrier.applyText(op.selector, direction === 'undo' ? op.before : op.after);
    return carrier.applyAttr(op.selector, op.attrName, direction === 'undo' ? op.before : op.after);
  }

  function stepHistory(direction) {
    var current = historyOf(tabRef.current);
    var op = direction === 'undo' ? current.ops[current.index] : current.ops[current.index + 1];
    if (!op) return;
    var carrier = carrierRef.current;
    if (!carrier) return;
    var promise = applyInverse(op, direction);
    Promise.resolve(promise).then(function () {
      mutateTab(tabId, function (draft) {
        var h = historyOf(draft);
        draft.history = Object.assign({}, h, { index: direction === 'undo' ? h.index - 1 : h.index + 1, lastKey: '' });
      });
      var value = direction === 'undo' ? op.before : op.after;
      queueRef.current.enqueue({
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
      });
      updateOperationStatus(tabId, [op.id], 'preview', '');
      refreshSelection();
    }).catch(function (error) {
      setNotice({ tone: 'error', text: String(error && error.message ? error.message : error) });
    });
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
        setDomOpen(!domOpen);
      },
      workspaceOpen: workspaceOpen,
      onToggleWorkspace: function () {
        setWorkspaceOpen(!workspaceOpen);
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
              color: notice.tone === 'error' ? theme.danger : theme.muted,
              background: notice.tone === 'error' ? 'color-mix(in srgb, ' + theme.danger + ' 10%, transparent)' : theme.layer1,
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
      { style: { flex: 1, minHeight: 0, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'row', background: theme.layer1 } },
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
      domOpen
        ? React.createElement(DomTreePanel, {
            t: t,
            theme: theme,
            carrier: carrierRef.current,
            selection: tab.selection,
            onClose: function () {
              setDomOpen(false);
            },
          })
        : null,
      workspaceOpen
        ? React.createElement(NudgeWorkspacePanel, {
            ctx: props.ctx,
            t: t,
            theme: theme,
            sessionId: sessionId,
            currentUrl: tab.url,
            onClose: function () {
              setWorkspaceOpen(false);
            },
            onNotice: function (nextNotice) {
              setNotice(nextNotice);
            },
            onNavigate: navigate,
            onReload: reload,
          })
        : null,
    ),
  );
}
