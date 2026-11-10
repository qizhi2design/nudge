// @ts-nocheck
/** Debounced, coalescing queue that persists live visual edits through the Host. */

// --------------------------------------------------------------- sync queue

/**
 * Structure edits carry the whole element so the Host can re-locate and patch
 * it. The cap is a transport guard, never an ellipsis: a truncated capture is
 * flagged explicitly so no layer treats the snippet as complete.
 */
var STRUCTURE_OUTER_HTML_CAP = 65536;
var STRUCTURE_TEXT_CAP = 2048;

/** remove / move / insert share the element-anchor wire fields. */
function structureKind(kind) {
  return kind === 'remove' || kind === 'move' || kind === 'insert';
}

/** Cap the captured markup, flagging the cut instead of appending an ellipsis. */
function structureOuterHTML(record) {
  var html = typeof record.outerHTML === 'string' ? record.outerHTML : '';
  var cut = html.length > STRUCTURE_OUTER_HTML_CAP;
  return {
    outerHTML: cut ? html.slice(0, STRUCTURE_OUTER_HTML_CAP) : html,
    outerHTMLTruncated: cut || record.outerHTMLTruncated === true,
  };
}

/** Structure wire fields shared by remove / move / insert (plus kind extras). */
function structureWireFields(record) {
  var capped = structureOuterHTML(record);
  var edit = {
    outerHTML: capped.outerHTML,
    outerHTMLTruncated: capped.outerHTMLTruncated,
    textBefore: record.textBefore || record.before || record.textSnippet || '',
    textSnippet: truncate(record.textSnippet || '', STRUCTURE_TEXT_CAP),
    elementKey: record.elementKey,
  };
  if (record.kind === 'remove') {
    edit.parentSelector = record.parentSelector == null ? null : record.parentSelector;
    edit.beforeSelector = record.beforeSelector == null ? null : record.beforeSelector;
  } else if (record.kind === 'move') {
    edit.targetParentPath = record.targetParentPath == null ? null : record.targetParentPath;
    edit.beforePath = record.beforePath == null ? null : record.beforePath;
    edit.fromParentSelector = record.fromParentSelector == null ? null : record.fromParentSelector;
    edit.fromBeforeSelector = record.fromBeforeSelector == null ? null : record.fromBeforeSelector;
  } else if (record.kind === 'insert') {
    edit.html = record.html || record.outerHTML || '';
    edit.targetParentSelector = record.targetParentSelector == null ? null : record.targetParentSelector;
    edit.beforeSelector = record.beforeSelector == null ? null : record.beforeSelector;
  }
  return edit;
}

/**
 * The sync queue coalesces rapid gestures: every call replaces the pending
 * record for the same (kind, selector, property) key, and one debounce flush
 * sends the latest batch to the Host. Preview is never blocked by this queue.
 *
 * Structure gestures are never coalesced across gestures (`opId` joins the
 * key), and their Host results are reported back through `onSyncMeta` so the
 * inspector body can cache the returned element handles.
 */
function createSyncQueue(ctx, tabId, getState, getSessionId, onSyncMeta) {
  var pending = new Map();
  var timer = null;
  var sending = false;
  var remote = createRemote(ctx);

  /**
   * The live session id comes from the inspector body (it owns `props.sessionId`);
   * the tab record only ever carries UI state. The legacy `tab.sessionInfo`
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
    if (structureKind(record.kind)) {
      // A structural gesture is one edit: keeping the op id in the key stops a
      // second quick gesture on the same element from replacing the first.
      return record.kind + '|' + record.selector + '|' + (record.opId == null ? '' : record.opId);
    }
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
    if (sending || pending.size === 0) return Promise.resolve(null);
    var tab = typeof getState === 'function' ? getState() : tabState(tabId);
    var sessionId = sessionIdOf();
    if (!sessionId) {
      pending.clear();
      mutateTab(tabId, function (draft) {
        draft.sync = { status: 'error', message: 'no-session', at: Date.now() };
      });
      return Promise.resolve(null);
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
      if (structureKind(record.kind)) {
        var structureFields = structureWireFields(record);
        Object.keys(structureFields).forEach(function (name) {
          edit[name] = structureFields[name];
        });
        if (record.kind === 'move') {
          edit.targetParentSelector = record.targetParentSelector;
          edit.targetParentOuterHTML = record.targetParentOuterHTML;
          edit.targetParentTextBefore = record.targetParentTextBefore;
          edit.beforeSelector = record.beforeSelector == null ? null : record.beforeSelector;
          edit.beforeOuterHTML = record.beforeOuterHTML;
          edit.beforeTextBefore = record.beforeTextBefore;
        }
      } else if (record.kind === 'style') {
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
      }
      // The Host issues a handle for text/attr/move/insert hits; send the cached
      // one back so the next edit on the same element can skip re-locating it.
      if (record.handle) edit.handle = record.handle;
      return edit;
    });
    return remote(
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
        var preview = 0;
        var failed = 0;
        var firstPreviewReason = '';
        var firstFailedMessage = '';
        var handles = {};
        var candidates = [];
        records.forEach(function (record) {
          var entry = byOp.get(record.id);
          var status = entry ? entry.status : 'failed';
          if (status === 'synced') {
            synced += 1;
            updateOperationStatus(tabId, [record.opId], 'synced', (entry && entry.file) || '');
            markOperationPersisted(tabId, [record.opId]);
            if (entry && entry.handle && record.selector) handles[record.selector] = entry.handle;
          } else if (status === 'failed') {
            failed += 1;
            var failedMessage = String((entry && (entry.message || entry.reason)) || '');
            firstFailedMessage = firstFailedMessage || failedMessage;
            updateOperationStatus(tabId, [record.opId], 'failed', failedMessage);
          } else {
            preview += 1;
            var reason = entry ? String(entry.reason || '') : '';
            firstPreviewReason = firstPreviewReason || reason;
            updateOperationStatus(tabId, [record.opId], 'preview', reason);
            if (entry && Array.isArray(entry.candidates) && entry.candidates.length > 0) {
              candidates.push({ id: record.id, selector: record.selector, files: entry.candidates });
            }
          }
        });
        var files = Array.isArray(result && result.files) ? result.files.filter(function (file) { return typeof file === 'string' && file !== ''; }) : [];
        if (files.length === 0) {
          results.forEach(function (entry) {
            if (entry && entry.status === 'synced' && typeof entry.file === 'string' && entry.file !== '' && files.indexOf(entry.file) < 0) files.push(entry.file);
          });
        }
        // Aggregate per-record status; a preview record must never be washed out
        // by a sibling that synced in the same batch.
        var nextStatus;
        var nextMessage;
        // Structured `partial` detail so the UI can localize it (the queue has
        // no translator and must not hard-code Chinese copy).
        var nextMeta = null;
        if (failed > 0) {
          nextStatus = 'error';
          nextMessage = firstFailedMessage;
        } else if (preview === 0) {
          nextStatus = 'done';
          nextMessage = files.join(', ');
        } else if (synced === 0) {
          nextStatus = 'preview';
          nextMessage = firstPreviewReason;
        } else {
          nextStatus = 'partial';
          nextMessage = firstPreviewReason;
          nextMeta = { synced: synced, preview: preview, reason: firstPreviewReason };
        }
        mutateTab(tabId, function (draft) {
          draft.sync = { status: nextStatus, message: nextMessage, meta: nextMeta, at: Date.now(), candidates: candidates };
        });
        if (typeof onSyncMeta === 'function') {
          onSyncMeta({ handles: handles, candidates: candidates });
        }
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
