// @ts-nocheck
/**
 * Nudge ↔ DSH shortcut bridge.
 *
 * The DSH shortcut service owns every binding, its recorder and the shared
 * "Keyboard shortcuts" reference. Nudge contributes one editable command per
 * app-level product action and routes each command to the live Inspector tab
 * body through the command bus below, so the system reference and the toolbar
 * tooltips read the same effective bindings — including user overrides recorded
 * in the system settings.
 *
 * Annotate / edit activation is deliberately NOT a DSH command any more: the
 * page-local single keys are configured in Settings → Nudge → Shortcuts, applied
 * by the injected runtime, and shown only in the toolbar tooltips.
 */

/** One physical combination; mirrors the DSH shortcut binding shape. */
function nudgeShiftDefaults(code) {
  var binding = { code: code, modifiers: ['primary', 'shift'] }
  return {
    'desktop:macos': binding,
    'desktop:windows': binding,
    'desktop:linux': binding,
    'web:macos': binding,
    'web:windows': binding,
  }
}

/**
 * Editable app-level Nudge commands. `action` is what the Inspector tab body
 * receives through `runNudgeTabAction`; `feature` names the product switch that
 * gates it in `pluginConfigValues()`. Mode activation / annotation navigation are
 * page-local single keys configured in the plugin settings, so they have no row
 * here.
 */
var NUDGE_SHORTCUT_COMMANDS = [
  {
    id: 'nudge.open',
    label: 'shortcut.open',
    aliases: ['nudge', 'open', 'inspector', 'open nudge'],
    defaults: nudgeShiftDefaults('KeyI'),
    action: 'open',
    feature: null,
    regions: ['page', 'editable', 'terminal'],
  },
  {
    id: 'nudge.dom.toggle',
    label: 'shortcut.domTree',
    aliases: ['nudge', 'dom', 'tree', 'outline'],
    defaults: nudgeShiftDefaults('KeyD'),
    action: 'dom',
    feature: 'enableDomTree',
    regions: ['page', 'editable'],
  },
  {
    id: 'nudge.workspace.toggle',
    label: 'shortcut.workspace',
    aliases: ['nudge', 'workspace', 'versions', 'git', 'commit'],
    defaults: nudgeShiftDefaults('KeyG'),
    action: 'workspace',
    feature: 'enableWorkspaceVersions',
    regions: ['page', 'editable'],
  },
]

/**
 * Read-only fixed row: holding Space (inside the embedded page) hands the page
 * back to the user. Registering it keeps the system reference honest about the
 * interaction without making it editable.
 */
var NUDGE_SHORTCUT_SPACE = {
  id: 'nudge.fixed.space',
  label: 'shortcut.holdSpace',
  keys: ['Space'],
  group: 'application',
  bindings: [{ code: 'Space', modifiers: [] }],
}

/**
 * Read-only page-local rows for the mode keys the injected runtime owns and
 * hard-codes: Esc leaves annotate / edit. The Space row above covers the other
 * fixed page interaction. Mode activation (A / E) and annotation navigation
 * (↑ / ↓) are configurable in Settings → Nudge → Shortcuts, so they are not
 * listed here; the page document receives those keys first, not the host UI.
 */
var NUDGE_SHORTCUT_PAGE_KEYS = [
  {
    id: 'nudge.fixed.escape',
    label: 'shortcut.exitMode',
    keys: ['Escape'],
    group: 'application',
    bindings: [{ code: 'Escape', modifiers: [] }],
  },
]

// ------------------------------------------------------------ service bridge

var nudgeShortcutService = null
var nudgeShortcutServiceOff = null
var nudgeShortcutListeners = new Set()

function nudgeShortcutNotify() {
  nudgeShortcutListeners.forEach(function (listener) {
    try {
      listener()
    } catch (error) {
      console.error('[dsh-nudge] shortcut listener failed', error)
    }
  })
}

/** Publish the live shortcut service and follow its catalog updates. */
function installNudgeShortcutService(service) {
  if (nudgeShortcutServiceOff !== null) {
    try {
      nudgeShortcutServiceOff()
    } catch (error) {
      /* ignore */
    }
    nudgeShortcutServiceOff = null
  }
  nudgeShortcutService = service || null
  if (
    nudgeShortcutService !== null &&
    nudgeShortcutService.catalog &&
    typeof nudgeShortcutService.catalog.subscribe === 'function'
  ) {
    try {
      nudgeShortcutServiceOff = nudgeShortcutService.catalog.subscribe(function () {
        nudgeShortcutNotify()
      })
    } catch (error) {
      nudgeShortcutServiceOff = null
    }
  }
  nudgeShortcutNotify()
  return function () {
    if (nudgeShortcutServiceOff !== null) {
      try {
        nudgeShortcutServiceOff()
      } catch (error) {
        /* ignore */
      }
      nudgeShortcutServiceOff = null
    }
    if (nudgeShortcutService === service) nudgeShortcutService = null
    nudgeShortcutNotify()
  }
}

function subscribeNudgeShortcuts(listener) {
  nudgeShortcutListeners.add(listener)
  return function () {
    nudgeShortcutListeners.delete(listener)
  }
}

function guessNudgePlatform() {
  try {
    var platform = String((navigator && navigator.platform) || '')
    if (/mac/i.test(platform)) return 'macos'
    if (/win/i.test(platform)) return 'windows'
  } catch (error) {
    /* ignore */
  }
  return 'linux'
}

/** Effective platform plus every catalog row; safe before the service mounts. */
function nudgeShortcutState() {
  var service = nudgeShortcutService
  if (service === null) return { platform: guessNudgePlatform(), rows: [] }
  var rows = []
  try {
    if (service.catalog && typeof service.catalog.getSnapshot === 'function') {
      rows = service.catalog.getSnapshot()
    }
  } catch (error) {
    rows = []
  }
  return {
    platform: service.platform || guessNudgePlatform(),
    rows: Array.isArray(rows) ? rows : [],
  }
}

function nudgeShortcutRow(id) {
  var rows = nudgeShortcutState().rows
  for (var index = 0; index < rows.length; index += 1) {
    if (rows[index] && rows[index].id === id) return rows[index]
  }
  return null
}

/** Effective binding for a command id, or null when unbound/unknown. */
function nudgeShortcutBinding(id) {
  var row = nudgeShortcutRow(id)
  return row && row.binding ? row.binding : null
}

// ------------------------------------------------------------ command bus

var nudgeTabCommandsByTab = Object.create(null)
var nudgePendingCommandsBySession = Object.create(null)

/**
 * Bind one mounted Inspector body's action surface. Returns a disposer and
 * immediately drains commands queued while the tab was opening.
 */
function registerNudgeTabCommands(tabId, sessionId, api) {
  var key = String(tabId || '')
  if (key === '' || !api) return function () {}
  nudgeTabCommandsByTab[key] = { tabId: key, sessionId: sessionId, api: api }
  flushNudgeCommands(sessionId, api)
  return function () {
    var entry = nudgeTabCommandsByTab[key]
    if (entry !== undefined && entry.api === api) delete nudgeTabCommandsByTab[key]
  }
}

function nudgeTabCommandEntry(tabId) {
  return nudgeTabCommandsByTab[String(tabId || '')] || null
}

function queueNudgeCommand(sessionId, action) {
  var key = String(sessionId || '')
  if (key === '') return
  var list = nudgePendingCommandsBySession[key]
  if (list === undefined) {
    list = []
    nudgePendingCommandsBySession[key] = list
  }
  if (list.indexOf(action) === -1) list.push(action)
}

function flushNudgeCommands(sessionId, api) {
  var key = String(sessionId || '')
  var list = nudgePendingCommandsBySession[key]
  if (list === undefined) return
  delete nudgePendingCommandsBySession[key]
  for (var index = 0; index < list.length; index += 1) runNudgeTabAction(api, list[index])
}

/** Apply one action to a live Inspector tab; unknown actions are ignored. */
function runNudgeTabAction(api, action) {
  if (!api || typeof api.run !== 'function') return false
  try {
    api.run(String(action || ''))
    return true
  } catch (error) {
    console.error('[dsh-nudge] shortcut action failed', error)
    return false
  }
}
