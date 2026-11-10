// @ts-nocheck
/**
 * Session-scoped "clip annotation" drafts.
 *
 * The page annotates with numbered pins only; `insertClips()`
 * moves one batch of annotations (plus the visual edits that are currently
 * applied) into the conversation composer as clip cards, mirroring the Codex
 * `commentAttachments` interaction. The composer tray renders this store and
 * the send hook consumes it once the prompt is accepted by the Host.
 *
 * HMR contract
 * ------------
 * The Client bundle is re-evaluated on a DSH client hot reload: every module
 * gets a fresh instance and module-level variables reset, while the page, its
 * Session scopes and any send wrapper installed by the previous module instance
 * stay alive. A wrapper installed before a reload therefore keeps running its
 * *old* closure; a module-scoped store would look empty to it and the pending
 * cards would never reach the Host. The store state and the send dispatcher
 * therefore live on `globalThis` under one fixed key, so every module instance
 * (old or new) reads and writes the same records.
 */

/** Fixed key of the HMR-surviving Client runtime state (one object per page). */
var CLIENT_STATE_KEY = '__dshnudgeClientState';
var CLIENT_STATE_VERSION = 1;

/** Fallback bucket when no global object is reachable (never in a browser). */
var clientStateFallback = {};

/** The page global object (browser) or the sandbox global (tests). */
function clientGlobalObject() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis) return globalThis;
  } catch (error) {
    /* fall through */
  }
  try {
    if (typeof window !== 'undefined' && window) return window;
  } catch (error) {
    /* fall through */
  }
  try {
    if (typeof self !== 'undefined' && self) return self;
  } catch (error) {
    /* fall through */
  }
  return null;
}

/** One fresh Client runtime state; only called when no live state exists. */
function createClientState() {
  return {
    version: CLIENT_STATE_VERSION,
    /** Clip-annotation drafts (this module). */
    clip: {
      sessions: {},
      listeners: new Set(),
      consumedOpIds: new Set(),
    },
    /** Send-hook wiring (bootstrap/register.tsx); created lazily there. */
    send: null,
  };
}

/**
 * Read (or lazily create) the page-wide Client runtime state.
 *
 * Every module instance that asks for a key must receive the *same* object:
 * the HMR-stable send wrapper only sees dispatcher updates because it and the
 * new module share this record. Consumers therefore mutate the fields in
 * place and never replace a sub-object once published.
 */
function clientStateStore() {
  var root = clientGlobalObject();
  if (root === null) {
    var fallback = clientStateFallback[CLIENT_STATE_KEY];
    if (!fallback) {
      fallback = createClientState();
      clientStateFallback[CLIENT_STATE_KEY] = fallback;
    }
    return fallback;
  }
  var current = root[CLIENT_STATE_KEY];
  if (current && typeof current === 'object' && current.version === CLIENT_STATE_VERSION) return current;
  var created = createClientState();
  try {
    root[CLIENT_STATE_KEY] = created;
  } catch (error) {
    return created;
  }
  var installed = root[CLIENT_STATE_KEY];
  return installed && typeof installed === 'object' ? installed : created;
}

/** The clip-draft slice of the shared Client state (never replaced in place). */
function clipState() {
  var state = clientStateStore();
  var clip = state.clip;
  if (!clip || typeof clip !== 'object') {
    clip = { sessions: {}, listeners: new Set(), consumedOpIds: new Set() };
    state.clip = clip;
  }
  if (!clip.sessions || typeof clip.sessions !== 'object') clip.sessions = {};
  if (!clip.listeners || typeof clip.listeners.add !== 'function') clip.listeners = new Set();
  if (!clip.consumedOpIds || typeof clip.consumedOpIds.add !== 'function') clip.consumedOpIds = new Set();
  return clip;
}

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
  var sessions = clipState().sessions;
  var id = clipSessionId(sessionId);
  if (id === '') return Object.assign({}, EMPTY_CLIP_ENTRY);
  var current = sessions[id];
  if (current !== undefined) return current;
  var created = {
    clips: [],
    ops: [],
    tabId: (seed && seed.tabId) || '',
    expanded: false,
    rev: 0,
  };
  sessions[id] = created;
  return created;
}

function notifyClips() {
  // Iterate a copy: a listener may unsubscribe while being notified.
  var listeners = Array.from(clipState().listeners);
  listeners.forEach(function (fn) {
    try {
      fn();
    } catch (error) {
      console.error('[dsh-nudge] clip listener failed', error);
    }
  });
}

function subscribeClips(fn) {
  var listeners = clipState().listeners;
  listeners.add(fn);
  return function () {
    listeners.delete(fn);
  };
}

/** React hook: the current session's clip entry (stable empty entry when idle). */
function useClipEntry(sessionId) {
  var id = clipSessionId(sessionId);
  return React.useSyncExternalStore(
    subscribeClips,
    function () {
      return clipState().sessions[id] || EMPTY_CLIP_ENTRY;
    },
    function () {
      return clipState().sessions[id] || EMPTY_CLIP_ENTRY;
    },
  );
}

function writeClipEntry(sessionId, next) {
  var sessions = clipState().sessions;
  var id = clipSessionId(sessionId);
  if (id === '') return next;
  var current = sessions[id] || EMPTY_CLIP_ENTRY;
  sessions[id] = Object.assign({}, next, { rev: (current.rev || 0) + 1 });
  notifyClips();
  return sessions[id];
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
  var current = clipState().sessions[id];
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
  var current = clipState().sessions[id];
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
  var current = clipState().sessions[id];
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
  var current = clipState().sessions[id];
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
  var sessions = clipState().sessions;
  var id = clipSessionId(sessionId);
  if (sessions[id] === undefined) return;
  sessions[id] = Object.assign({}, sessions[id], { clips: [], ops: [], expanded: false });
  notifyClips();
}

function setClipExpanded(sessionId, expanded) {
  var current = clipState().sessions[clipSessionId(sessionId)];
  if (!current || current.expanded === expanded) return;
  writeClipEntry(sessionId, {
    clips: current.clips,
    ops: current.ops,
    tabId: current.tabId,
    expanded: expanded === true,
  });
}

function clipPendingCount(sessionId) {
  var current = clipState().sessions[clipSessionId(sessionId)];
  if (!current) return 0;
  return current.clips.length + current.ops.length;
}

/**
 * Every Session that still carries a pending batch. The bootstrap uses this
 * after a hot reload to re-install its send hook before the composer tray
 * remounts.
 */
function clipPendingSessionIds() {
  var sessions = clipState().sessions;
  var ids = [];
  Object.keys(sessions).forEach(function (id) {
    var entry = sessions[id];
    if (!entry) return;
    var clips = entry.clips || [];
    var ops = entry.ops || [];
    if (clips.length > 0 || ops.length > 0) ids.push(id);
  });
  return ids;
}

/**
 * Reserve the whole pending batch for one in-flight send. The cards disappear
 * immediately; `restoreClipBatch()` puts them back when the Host rejects it.
 */
function takeClipBatch(sessionId) {
  var id = clipSessionId(sessionId);
  var current = clipState().sessions[id];
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
  var consumed = clipState().consumedOpIds;
  (ops || []).forEach(function (op) {
    if (op && op.id) consumed.add(op.id);
  });
}

function isOpConsumed(opId) {
  return opId ? clipState().consumedOpIds.has(opId) : false;
}
