// @ts-nocheck
/** Module-scoped tab store shared by every Client surface. */

// ------------------------------------------------------------------ store

var listeners = new Set();
var storeState = {
  tabs: {},
};

function emit() {
  listeners.forEach(function (fn) {
    try {
      fn();
    } catch (error) {
      console.error('[dsh-nudge] store listener failed', error);
    }
  });
}

function subscribe(fn) {
  listeners.add(fn);
  return function () {
    listeners.delete(fn);
  };
}

function getSnapshot() {
  return storeState;
}

function useStore(selector) {
  var snap = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return selector === undefined ? snap : selector(snap);
}


function tabState(tabId) {
  return storeState.tabs[tabId];
}

function ensureTab(tabId, seed) {
  var existing = storeState.tabs[tabId];
  if (existing !== undefined) return existing;
  var created = Object.assign(
    {
      tabId: tabId,
      url: '',
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
      ready: false,
      mode: 'browse',
      selection: null,
      selectionSeq: 0,
      annotations: [],
      history: { ops: [], index: -1, lastKey: '', lastAt: 0 },
      sync: { status: 'idle', message: '', at: 0 },
      notices: [],
      carrier: 'none',
      hotReload: true,
      reloadPending: false,
      workspace: null,
    },
    seed || {},
  );
  storeState = Object.assign({}, storeState, {
    tabs: Object.assign({}, storeState.tabs, { [tabId]: created }),
  });
  return created;
}

function patchTab(tabId, next) {
  if (storeState.tabs[tabId] === undefined) ensureTab(tabId);
  var current = storeState.tabs[tabId];
  var merged = Object.assign({}, current, next);
  storeState = Object.assign({}, storeState, {
    tabs: Object.assign({}, storeState.tabs, { [tabId]: merged }),
  });
  emit();
  return merged;
}

function mutateTab(tabId, fn) {
  var current = storeState.tabs[tabId];
  if (current === undefined) return;
  var draft = Object.assign({}, current);
  fn(draft);
  var merged = Object.assign({}, current, draft);
  storeState = Object.assign({}, storeState, {
    tabs: Object.assign({}, storeState.tabs, { [tabId]: merged }),
  });
  emit();
  return merged;
}

function useTab(tabId) {
  return useStore(function (snap) {
    return snap.tabs[tabId];
  });
}
