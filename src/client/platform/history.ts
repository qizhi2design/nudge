// @ts-nocheck
/** Applied-edit history: recording, coalescing and sync status. */

// -------------------------------------------------------- edit history

function historyOf(tab) {
  return tab.history || { ops: [], index: -1, lastKey: '', lastAt: 0 };
}

/**
 * Record one applied visual edit. Continuous gesture input passes a
 * `coalesceKey`; consecutive records with the same key inside COALESCE_MS
 * update the latest operation instead of appending a new history step.
 */
function recordOperation(tabId, operation) {
  var result = mutateTab(tabId, function (draft) {
    var history = historyOf(draft);
    var ops = history.ops.slice(0, history.index + 1);
    var now = Date.now();
    var key = operation.coalesceKey || '';
    var canMerge =
      key !== '' &&
      history.lastKey === key &&
      now - history.lastAt <= COALESCE_MS &&
      ops.length > 0 &&
      ops[ops.length - 1].coalesceKey === key;

    if (canMerge) {
      var latest = Object.assign({}, ops[ops.length - 1]);
      latest.after = operation.after;
      latest.at = now;
      latest.syncStatus = 'preview';
      ops[ops.length - 1] = latest;
    } else {
      ops.push(
        Object.assign(
          {
            id: makeId(operation.kind || 'op'),
            at: now,
            syncStatus: 'preview',
            coalesceKey: key,
          },
          operation,
        ),
      );
      if (ops.length > HISTORY_LIMIT) ops.splice(0, ops.length - HISTORY_LIMIT);
    }
    draft.history = {
      ops: ops,
      index: ops.length - 1,
      lastKey: key,
      lastAt: now,
    };
  });
  var history = historyOf(result);
  var latest = history.ops[history.index];
  return latest !== undefined ? latest.id : makeId('op');
}

function updateOperationStatus(tabId, ids, status, message) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  var set = new Set(ids);
  mutateTab(tabId, function (draft) {
    var history = historyOf(draft);
    var ops = history.ops.map(function (op) {
      if (set.has(op.id)) return Object.assign({}, op, { syncStatus: status, syncMessage: message || '' });
      return op;
    });
    draft.history = Object.assign({}, history, { ops: ops });
  });
}

function pendingOperations(tab) {
  var history = historyOf(tab);
  return history.ops.filter(function (op, index) {
    return index <= history.index && op.syncStatus !== 'synced';
  });
}
