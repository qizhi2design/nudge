// @ts-nocheck
/**
 * Nudge ↔ DSH shortcut bridge.
 *
 * The DSH shortcut service owns every binding, its recorder and the shared
 * "Keyboard shortcuts" reference. Nudge contributes one editable command per
 * product action (plus the page-local Space sequence as a read-only row) and
 * routes each command to the live Inspector tab body through the command bus
 * below, so the system reference, the toolbar tooltips and the in-product
 * shortcut sheet all read the same effective bindings — including user
 * overrides recorded in the system settings.
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
 * Editable Nudge commands. `action` is what the Inspector tab body receives
 * through `runNudgeTabAction`; `feature` names the product switch that gates
 * it in `pluginConfigValues()`.
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
    id: 'nudge.annotate.toggle',
    label: 'shortcut.annotate',
    aliases: ['nudge', 'annotate', 'comment', 'annotation mode'],
    defaults: nudgeShiftDefaults('Period'),
    action: 'annotate',
    feature: 'enableAnnotate',
    regions: ['page', 'editable'],
  },
  {
    id: 'nudge.edit.toggle',
    label: 'shortcut.edit',
    aliases: ['nudge', 'edit', 'style', 'edit mode'],
    defaults: nudgeShiftDefaults('KeyE'),
    action: 'edit',
    feature: 'enableEdit',
    regions: ['page', 'editable'],
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
 * Read-only page-local rows for the mode keys the injected runtime owns. They
 * are listed in the shortcut reference (and the in-product sheet) but cannot be
 * rebound here: the page document receives the key first, not the host UI.
 */
var NUDGE_SHORTCUT_PAGE_KEYS = [
  {
    id: 'nudge.fixed.escape',
    label: 'shortcut.exitMode',
    keys: ['Escape'],
    group: 'application',
    bindings: [{ code: 'Escape', modifiers: [] }],
  },
  {
    id: 'nudge.fixed.shiftTab',
    label: 'shortcut.switchMode',
    keys: ['Shift', 'Tab'],
    group: 'application',
    bindings: [{ code: 'Tab', modifiers: ['shift'] }],
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
