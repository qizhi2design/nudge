// @ts-nocheck
/** Debounced, coalescing queue that persists live visual edits through the Host. */

// --------------------------------------------------------------- sync queue

/**
 * The sync queue coalesces rapid gestures: every call replaces the pending
 * record for the same (kind, selector, property) key, and one debounce flush
 * sends the latest batch to the Host. Preview is never blocked by this queue.
 */
function createSyncQueue(ctx, tabId, getState) {
  var pending = new Map();
  var timer = null;
  var sending = false;
  var remote = createRemote(ctx);

  function keyOf(record) {
    if (record.kind === 'style') return 'style|' + record.selector + '|' + record.property;
    if (record.kind === 'attr') return 'attr|' + record.selector + '|' + record.attrName;
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
    var tab = tabState(tabId);
    if (!tab || !tab.sessionInfo || !tab.sessionInfo.sessionId) {
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
      } else {
        edit.attrName = record.attrName;
        edit.attrBefore = record.before;
        edit.attrAfter = record.after;
      }
      return edit;
    });
    remote(
      'sync',
      {
        session: tab.sessionInfo.sessionId,
        page: { url: tab.url, title: tab.title },
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
            updateOperationStatus(tabId, [record.opId], 'preview', entry.reason || '');
          }
        });
        mutateTab(tabId, function (draft) {
          draft.sync = {
            status: failed > 0 ? 'error' : synced > 0 ? 'done' : 'preview',
            message: failed > 0 ? String((results.find(function (r) { return r.status === 'failed'; }) || {}).message || '') : '',
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
