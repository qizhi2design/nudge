// @ts-nocheck
/**
 * Session-scoped "clip annotation" drafts.
 *
 * The page annotates with numbered pins only; `insertClips()`
 * moves one batch of annotations (plus the visual edits that are currently
 * applied) into the conversation composer as clip cards, mirroring the Codex
 * `commentAttachments` interaction. The composer tray renders this store and
 * the send hook consumes it once the prompt is accepted by the Host.
 */

var clipSessions = {};
var clipListeners = new Set();
var consumedOpIds = new Set();

var EMPTY_CLIP_ENTRY = Object.freeze({
  clips: [],
  ops: [],
  tabId: '',
  expanded: false,
  rev: 0,
});

function clipSessionId(sessionId) {
  return String(sessionId === undefined || sessionId === null ? '' : sessionId);
}

function clipEntryFor(sessionId, seed) {
  var id = clipSessionId(sessionId);
  if (id === '') return Object.assign({}, EMPTY_CLIP_ENTRY);
  var current = clipSessions[id];
  if (current !== undefined) return current;
  var created = {
    clips: [],
    ops: [],
    tabId: (seed && seed.tabId) || '',
    expanded: false,
    rev: 0,
  };
  clipSessions[id] = created;
  return created;
}

function notifyClips() {
  clipListeners.forEach(function (fn) {
    try {
      fn();
    } catch (error) {
      console.error('[dsh-nudge] clip listener failed', error);
    }
  });
}

function subscribeClips(fn) {
  clipListeners.add(fn);
  return function () {
    clipListeners.delete(fn);
  };
}

/** React hook: the current session's clip entry (stable empty entry when idle). */
function useClipEntry(sessionId) {
  var id = clipSessionId(sessionId);
  return React.useSyncExternalStore(
    subscribeClips,
    function () {
      return clipSessions[id] || EMPTY_CLIP_ENTRY;
    },
    function () {
      return clipSessions[id] || EMPTY_CLIP_ENTRY;
    },
  );
}

function writeClipEntry(sessionId, next) {
  var id = clipSessionId(sessionId);
  if (id === '') return next;
  var current = clipSessions[id] || EMPTY_CLIP_ENTRY;
  clipSessions[id] = Object.assign({}, next, { rev: (current.rev || 0) + 1 });
  notifyClips();
  return clipSessions[id];
}

function mergeClipList(current, incoming) {
  var next = current.slice();
  (incoming || []).forEach(function (clip) {
    if (!clip || !clip.id) return;
    var index = -1;
    for (var cursor = 0; cursor < next.length; cursor += 1) {
      if (next[cursor].id === clip.id) {
        index = cursor;
        break;
      }
    }
    if (index >= 0) next[index] = clip;
    else next.push(clip);
  });
  return next;
}

function mergeOpList(current, incoming) {
  var seen = {};
  current.forEach(function (op) {
    if (op && op.id) seen[op.id] = true;
  });
  var next = current.slice();
  (incoming || []).forEach(function (op) {
    if (!op || !op.id || seen[op.id]) return;
    seen[op.id] = true;
    next.push(op);
  });
  return next;
}

/**
 * Insert (or refresh) one batch of clips and visual edits for a session.
 * Existing clips are kept and matched by annotation id, so inserting twice
 * never duplicates a card.
 */
function insertClips(sessionId, batch) {
  var id = clipSessionId(sessionId);
  if (id === '') return EMPTY_CLIP_ENTRY;
  var current = clipEntryFor(id);
  var next = {
    clips: mergeClipList(current.clips, batch && batch.clips),
    ops: mergeOpList(current.ops, batch && batch.ops),
    tabId: (batch && batch.tabId) || current.tabId || '',
    expanded: true,
  };
  if (next.clips.length === 0 && next.ops.length === 0) return current;
  return writeClipEntry(id, next);
}

function updateClipNote(sessionId, clipId, note) {
  var id = clipSessionId(sessionId);
  var current = clipSessions[id];
  if (!current) return current;
  var next = {
    clips: current.clips.map(function (clip) {
      return clip.id === clipId ? Object.assign({}, clip, { note: String(note == null ? '' : note) }) : clip;
    }),
    ops: current.ops,
    tabId: current.tabId,
    expanded: current.expanded,
  };
  return writeClipEntry(id, next);
}

function removeClip(sessionId, clipId) {
  var id = clipSessionId(sessionId);
  var current = clipSessions[id];
  if (!current) return current;
  return writeClipEntry(id, {
    clips: current.clips.filter(function (clip) {
      return clip.id !== clipId;
    }),
    ops: current.ops,
    tabId: current.tabId,
    expanded: current.expanded,
  });
}

function removeClipOps(sessionId, opId) {
  var id = clipSessionId(sessionId);
  var current = clipSessions[id];
  if (!current) return current;
  return writeClipEntry(id, {
    clips: current.clips,
    ops: current.ops.filter(function (op) {
      return op.id !== opId;
    }),
    tabId: current.tabId,
    expanded: current.expanded,
  });
}

/** Drop every pending visual-edit row, keeping the annotation cards. */
function clearClipOps(sessionId) {
  var id = clipSessionId(sessionId);
  var current = clipSessions[id];
  if (!current) return current;
  return writeClipEntry(id, {
    clips: current.clips,
    ops: [],
    tabId: current.tabId,
    expanded: current.expanded,
  });
}

/** Drop every pending clip and pending edit for one session. */
function clearClips(sessionId) {
  var id = clipSessionId(sessionId);
  if (clipSessions[id] === undefined) return;
  clipSessions[id] = Object.assign({}, clipSessions[id], { clips: [], ops: [], expanded: false });
  notifyClips();
}

function setClipExpanded(sessionId, expanded) {
  var current = clipSessions[clipSessionId(sessionId)];
  if (!current || current.expanded === expanded) return;
  writeClipEntry(sessionId, {
    clips: current.clips,
    ops: current.ops,
    tabId: current.tabId,
    expanded: expanded === true,
  });
}

function clipPendingCount(sessionId) {
  var current = clipSessions[clipSessionId(sessionId)];
  if (!current) return 0;
  return current.clips.length + current.ops.length;
}

/**
 * Reserve the whole pending batch for one in-flight send. The cards disappear
 * immediately; `restoreClipBatch()` puts them back when the Host rejects it.
 */
function takeClipBatch(sessionId) {
  var id = clipSessionId(sessionId);
  var current = clipSessions[id];
  if (!current || (current.clips.length === 0 && current.ops.length === 0)) return null;
  var taken = {
    clips: current.clips.slice(),
    ops: current.ops.slice(),
    tabId: current.tabId,
  };
  writeClipEntry(id, { clips: [], ops: [], tabId: current.tabId, expanded: false });
  return taken;
}

function restoreClipBatch(sessionId, taken) {
  if (!taken) return;
  var id = clipSessionId(sessionId);
  var current = clipEntryFor(id, { tabId: taken.tabId });
  writeClipEntry(id, {
    clips: mergeClipList(current.clips, taken.clips),
    ops: mergeOpList(current.ops, taken.ops),
    tabId: current.tabId || taken.tabId,
    expanded: true,
  });
}

function markOpsConsumed(ops) {
  (ops || []).forEach(function (op) {
    if (op && op.id) consumedOpIds.add(op.id);
  });
}

function isOpConsumed(opId) {
  return opId ? consumedOpIds.has(opId) : false;
}
