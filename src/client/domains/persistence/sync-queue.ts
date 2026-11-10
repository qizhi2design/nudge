// @ts-nocheck
/** Debounced, coalescing queue that persists live visual edits through the Host. */

// --------------------------------------------------------------- sync queue

/**
 * The sync queue coalesces rapid gestures: every call replaces the pending
 * record for the same (kind, selector, property) key, and one debounce flush
 * sends the latest batch to the Host. Preview is never blocked by this queue.
 */
function createSyncQueue(ctx, tabId, getState, getSessionId) {
  var pending = new Map();
  var timer = null;
  var sending = false;
  var remote = createRemote(ctx);

  /**
   * The live session id comes from the inspector body (it owns `props.sessionId`
   *); the tab record only ever carries UI state. The legacy `tab.sessionInfo`
   * lookup stays as a defensive fallback but is no longer required.
   */
  function sessionIdOf() {
    if (typeof getSessionId === 'function') {
      var explicit = getSessionId();
      if (typeof explicit === 'string' && explicit.length > 0) return explicit;
    }
    var tab = typeof getState === 'function' ? getState() : tabState(tabId);
    var legacy = tab && tab.sessionInfo ? tab.sessionInfo.sessionId : null;
    return typeof legacy === 'string' ? legacy : '';
  }

  function keyOf(record) {
    if (record.kind === 'style') return 'style|' + record.selector + '|' + record.property;
    if (record.kind === 'attr') return 'attr|' + record.selector + '|' + record.attrName;
    if (record.kind === 'remove') return 'remove|' + record.selector;
    if (record.kind === 'move') return 'move|' + record.selector;
    return 'text|' + record.selector;
  }

  function enqueue(record) {
    pending.set(keyOf(record), record);
    mutateTab(tabId, function (draft) {
      draft.sync = { status: 'pending', message: '', at: Date.now() };
    });
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      flush();
    }, SYNC_DEBOUNCE_MS);
  }

  function flush() {
    if (sending || pending.size === 0) return;
    var tab = typeof getState === 'function' ? getState() : tabState(tabId);
    var sessionId = sessionIdOf();
    if (!sessionId) {
      pending.clear();
      mutateTab(tabId, function (draft) {
        draft.sync = { status: 'error', message: 'no-session', at: Date.now() };
      });
      return;
    }
    var records = Array.from(pending.values());
    pending.clear();
    sending = true;
    mutateTab(tabId, function (draft) {
      draft.sync = { status: 'syncing', message: '', at: Date.now() };
    });
    updateOperationStatus(tabId, records.map(function (r) { return r.opId; }).filter(Boolean), 'syncing', '');
    var payload = records.map(function (record) {
      var edit = {
        id: record.id,
        kind: record.kind,
        selector: record.selector,
        path: record.path,
        outerHTML: truncate(record.outerHTML || '', 4000),
        textSnippet: truncate(record.textSnippet || '', 160),
        sourceHints: record.sourceHints || null,
      };
      if (record.kind === 'style') {
        edit.property = record.property;
        edit.value = record.value;
        edit.before = record.before;
        edit.after = record.after;
      } else if (record.kind === 'text') {
        edit.textBefore = record.before;
        edit.textAfter = record.after;
      } else if (record.kind === 'attr') {
        edit.attrName = record.attrName;
        edit.attrBefore = record.before;
        edit.attrAfter = record.after;
      } else if (record.kind === 'move') {
        edit.targetParentSelector = record.targetParentSelector;
        edit.targetParentOuterHTML = record.targetParentOuterHTML;
        edit.targetParentTextBefore = record.targetParentTextBefore;
        edit.beforeSelector = record.beforeSelector == null ? null : record.beforeSelector;
        edit.beforeOuterHTML = record.beforeOuterHTML;
        edit.beforeTextBefore = record.beforeTextBefore;
      }
      return edit;
    });
    remote(
      'sync',
      {
        session: sessionId,
        page: { url: tab ? tab.url : '', title: tab ? tab.title : '' },
        edits: payload,
      },
      undefined,
    )
      .then(function (result) {
        var results = Array.isArray(result && result.results) ? result.results : [];
        var byOp = new Map();
        results.forEach(function (entry) {
          byOp.set(String(entry.id), entry);
        });
        var synced = 0;
        var failed = 0;
        var previewReason = '';
        records.forEach(function (record) {
          var entry = byOp.get(record.id);
          var status = entry ? entry.status : 'failed';
          if (status === 'synced') {
            synced += 1;
            updateOperationStatus(tabId, [record.opId], 'synced', entry.file || '');
          } else if (status === 'failed') {
            failed += 1;
            updateOperationStatus(tabId, [record.opId], 'failed', entry.message || '');
          } else {
            previewReason = previewReason || String(entry.reason || '');
            updateOperationStatus(tabId, [record.opId], 'preview', entry.reason || '');
          }
        });
        var files = Array.isArray(result && result.files) ? result.files.filter(function (file) { return typeof file === 'string' && file !== ''; }) : [];
        if (files.length === 0) {
          results.forEach(function (entry) {
            if (entry && entry.status === 'synced' && typeof entry.file === 'string' && entry.file !== '' && files.indexOf(entry.file) < 0) files.push(entry.file);
          });
        }
        var failedEntry = results.find(function (entry) { return entry && entry.status === 'failed'; });
        mutateTab(tabId, function (draft) {
          draft.sync = {
            status: failed > 0 ? 'error' : synced > 0 ? 'done' : 'preview',
            message: failed > 0
              ? String((failedEntry && failedEntry.message) || '')
              : synced > 0
                ? files.join(', ')
                : previewReason,
            at: Date.now(),
          };
        });
      })
      .catch(function (error) {
        var message = error instanceof Error ? error.message : String(error);
        updateOperationStatus(tabId, records.map(function (r) { return r.opId; }).filter(Boolean), 'failed', message);
        mutateTab(tabId, function (draft) {
          draft.sync = { status: 'error', message: message, at: Date.now() };
        });
      })
      .finally(function () {
        sending = false;
        if (pending.size > 0) {
          timer = setTimeout(function () {
            timer = null;
            flush();
          }, SYNC_DEBOUNCE_MS);
        }
      });
  }

  return {
    enqueue: enqueue,
    flush: flush,
    retry: function (records) {
      records.forEach(enqueue);
    },
  };
}
