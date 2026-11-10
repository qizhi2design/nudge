/**
 * Client-half smoke test: loads the generated factory bundle with a minimal
 * React/DOM shim, runs `apply(ctx)`, and asserts every registration survives
 * with the exact ids the sidebar dispatches on. Engineering test only; it is
 * not a substitute for exercising the running Desktop plugin.
 */
import { readFile } from 'node:fs/promises'
import { runInThisContext } from 'node:vm'

let failures = 0
function ok(name) { console.log('ok - ' + name) }
function assert(condition, name) {
  if (condition) ok(name)
  else { failures += 1; console.error('FAIL - ' + name) }
}

function fakeStyles() {
  const style = { cssText: '', setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } }
  return style
}
const head = { children: [], appendChild(child) { this.children.push(child) } }
const elements = new Set()
globalThis.document = {
  documentElement: {},
  head,
  body: { appendChild() {} },
  getElementById() { return null },
  createElement(tag) {
    const el = { tagName: tag, style: fakeStyles(), setAttribute() {}, appendChild() {}, removeChild() {}, addEventListener() {}, removeEventListener() {} }
    elements.add(el)
    return el
  },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.window = globalThis
globalThis.localStorage = { getItem() { return null }, setItem() {} }
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true })
globalThis.getComputedStyle = () => ({ getPropertyValue() { return '' } })

const hooks = { effect: 0, state: 0, ref: 0, memo: 0, sync: 0, layout: 0 }
const React = {
  createElement(type, props, ...children) {
    const element = { type, props: props || {}, children }
    if (typeof type === 'function') {
      try { type(Object.assign({}, element.props, { children })) } catch { /* components are not rendered in this test */ }
    }
    return element
  },
  Fragment: 'Fragment',
  useState(initial) { hooks.state += 1; return [typeof initial === 'function' ? initial() : initial, () => {}] },
  useRef(initial) { hooks.ref += 1; return { current: initial } },
  useEffect() { hooks.effect += 1 },
  useLayoutEffect() { hooks.layout += 1 },
  useMemo(fn) { hooks.memo += 1; return fn() },
  useCallback(fn) { return fn },
  useSyncExternalStore(_sub, snap) { hooks.sync += 1; return snap() },
  useId() { return 'id-1' },
  createContext(defaultValue) { return { Provider: 'Provider', Consumer: 'Consumer', _currentValue: defaultValue } },
  forwardRef(render) { return render },
  createRef() { return { current: null } },
  useContext(context) { return context && context._currentValue },
  useReducer(_reducer, initial) { return [initial, () => {}] },
  useImperativeHandle() {},
  useInsertionEffect() {},
}

let loaded = null
globalThis.__ModuleLoader__ = {
  load(definition) {
    loaded = definition
  },
}
const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
runInThisContext(source, { filename: 'lib/client.js' })
assert(loaded !== null, 'bundle registers a factory')
assert(loaded.id === 'dsh.nudge', 'factory id equals the package name')
const exportsObject = loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
assert(Array.isArray(exportsObject.inject) && exportsObject.inject.includes('slots'), 'client exports the service inject list')
assert(typeof exportsObject.apply === 'function', 'client exports apply')
const workspaceTestHook = exportsObject.__test
assert(workspaceTestHook !== null && typeof workspaceTestHook === 'object', 'client exposes the workspace test hook')
assert(typeof workspaceTestHook.NudgeWorkspacePanel === 'function', 'workspace panel is bundled')
assert(typeof workspaceTestHook.hotReloadDecision === 'function', 'hot-reload decision is bundled')
assert(workspaceTestHook.hotReloadDecision(1, 2, 'browse') === 'reload', 'hot-reload reload branch is bundled')
assert(workspaceTestHook.hotReloadDecision(1, 2, 'annotate') === 'defer', 'hot-reload defer branch is bundled')
assert(workspaceTestHook.hotReloadDecision(2, 2, 'browse') === 'ignore', 'hot-reload ignore branch is bundled')
assert(typeof workspaceTestHook.gitStoreTestHelpers === 'object', 'workspace request helpers are bundled')
assert(typeof workspaceTestHook.toolbarLayout === 'function', 'responsive toolbar layout helper is bundled')
assert(
  JSON.stringify(workspaceTestHook.toolbarLayout(900)) === JSON.stringify({ compact: false, tiny: false }),
  'wide toolbar keeps mode labels and two rows',
)
assert(
  JSON.stringify(workspaceTestHook.toolbarLayout(600)) === JSON.stringify({ compact: false, tiny: false }),
  'the dedicated action row keeps mode labels at sidebar widths',
)
assert(
  JSON.stringify(workspaceTestHook.toolbarLayout(440)) === JSON.stringify({ compact: true, tiny: false }),
  'very narrow toolbar collapses mode labels in the action row',
)
assert(
  JSON.stringify(workspaceTestHook.toolbarLayout(400)) === JSON.stringify({ compact: true, tiny: true }),
  'tiny toolbar also drops forward and the go button',
)
assert(
  JSON.stringify(workspaceTestHook.toolbarLayout(Number.NaN)) === JSON.stringify({ compact: false, tiny: false }),
  'toolbar layout falls back to wide before the first measurement',
)
assert(typeof workspaceTestHook.pluginConfigDefaults === 'function', 'plugin config defaults are bundled')
const pluginDefaults = workspaceTestHook.pluginConfigDefaults()
assert(pluginDefaults.language === 'auto', 'plugin language defaults to auto')
assert(pluginDefaults.enableAnnotate === true && pluginDefaults.enableHotReload === true, 'feature switches default to enabled')
assert(pluginDefaults.enableFloatingComposer === true, 'the fullscreen floating composer defaults to enabled')
assert(typeof workspaceTestHook.floatingComposerEligible === 'function', 'floating-composer eligibility is bundled')
assert(typeof workspaceTestHook.installFloatingComposer === 'function', 'floating-composer installer is bundled')
assert(typeof workspaceTestHook.setFloatingComposerRequest === 'function', 'floating-composer request seam is bundled')
assert(typeof workspaceTestHook.setFloatingComposerAnnotating === 'function', 'floating-composer annotate seam is bundled')
assert(workspaceTestHook.formatPluginText('检查更新 {version}', { version: '0.2.0' }) === '检查更新 0.2.0', 'locale placeholders interpolate')
assert(
  workspaceTestHook.pluginTranslate((key) => 'host:' + key, 'settings.title') === 'host:settings.title',
  'auto language falls back to the DSH translator',
)
workspaceTestHook.setPluginConfig({ language: 'zh' }, null)
assert(workspaceTestHook.pluginTranslate((key) => 'host:' + key, 'settings.title') === '轻推', 'explicit zh uses the embedded dictionary')
workspaceTestHook.setPluginConfig({ language: 'auto' }, null)
assert(source.includes('data-toolbar-secondary'), 'bundle ships the always-visible action row')
assert(source.includes('data-toolbar-primary'), 'bundle ships the primary toolbar row marker')
assert(source.includes('data-dsh-nudge-workspace-panel'), 'bundle ships the workspace panel DOM contract')
assert(source.includes('data-hot-reload-pending'), 'bundle ships the hot-reload toolbar pending state')
assert(source.includes('--dsw-specific-menu'), 'guide dropdown uses the DSH menu surface token')
assert(source.includes('NudgeMark'), 'bundle ships the Nudge product mark')

const registrations = {
  locales: [],
  tabs: [],
  slots: [],
  shortcuts: [],
  fixedShortcuts: [],
  contextMenus: [],
  effects: [],
  catalogRows: [],
  sidebarTabs: [],
  openedIn: null,
  focused: [],
  noTarget: false,
}
const ctx = {
  locale: {
    register(ns, dicts) { registrations.locales.push({ ns, dicts }); return () => {} },
    bind() { return (key, vars) => key + (vars ? JSON.stringify(vars) : '') },
  },
  slots: {
    inject(name, callback) { registrations.slots.push({ name, callback }); return () => {} },
    register(options, component) { registrations.slots.push({ register: options, component }); return () => {} },
  },
  sidebarRightTabs: {
    register(definition) { registrations.tabs.push(definition); return () => {} },
  },
  sidebarRight: {
    openTab(kind, options) { registrations.opened = { kind, options } },
    openTabFromTarget(kind, target) { registrations.openedFromTarget = { kind, target } },
    openTabIn(sessionId, kind, options) { registrations.openedIn = { sessionId, kind, options } },
    tabsIn() { return registrations.sidebarTabs },
    focus(tabId) { registrations.focused.push(tabId) },
    isExpanded() { return true },
    toggleExpanded() {},
    commandTarget() {
      return registrations.noTarget ? undefined : { paneId: 'p', tabId: 't', sessionId: 'session-1' }
    },
  },
  inject(services, callback) {
    callback({
      shortcuts: {
        register(def) { registrations.shortcuts.push(def); return () => {} },
        registerFixed(def) { registrations.fixedShortcuts.push(def); return () => {} },
        catalog: { getSnapshot() { return registrations.catalogRows }, subscribe() { return () => {} } },
        platform: 'macos',
        runtime: 'desktop',
      },
      contextMenus: { register(def) { registrations.contextMenus.push(def); return () => {} } },
      effect(fn) { registrations.effects.push(fn); return () => {} },
      slots: this.slots,
    })
  },
  effect(fn, label) { registrations.effects.push({ fn, label }) },
  get() { return undefined },
}
exportsObject.apply(ctx)
assert(
  head.children.some((child) => child.id === 'dsh-nudge-global-style' && String(child.textContent || '').includes('dshnudge-')),
  'injected global styles include Host UI CSS',
)

// Run the effect bodies the way Cordis would, collecting their disposers.
for (const entry of registrations.effects) {
  const fn = typeof entry === 'function' ? entry : entry.fn
  if (typeof fn === 'function') {
    const result = fn()
    if (typeof result === 'function') registrations.disposers = (registrations.disposers || 0) + 1
  }
}
for (const entry of registrations.slots) {
  if (typeof entry.callback === 'function') entry.callback()
}
assert(registrations.locales.length === 1 && registrations.locales[0].ns === 'dsh.nudge', 'locale namespace registered')
assert(registrations.locales[0].dicts.zh && registrations.locales[0].dicts.en, 'zh and en dictionaries embedded')
const zhDict = registrations.locales[0].dicts.zh
const enDict = registrations.locales[0].dicts.en
assert(zhDict['workspace.tabs.files'] === '文件' && zhDict['workspace.tabs.versions'] === '版本' && zhDict['workspace.tabs.commit'] === '提交', 'workspace tabs localized in zh')
assert(zhDict['commit.emptyMessage'] === '请填写提交说明', 'commit guard message localized in zh')
assert(enDict['workspace.title'] === 'Workspace versions', 'workspace panel title localized in en')
assert(enDict['commit.emptyMessage'] === 'Enter a commit message', 'commit guard message localized in en')
assert(enDict['hotReload.pending'] !== undefined, 'hot-reload pending string localized in en')
assert(
  zhDict['shortcut.exitMode'] === '退出标注 / 编辑模式' && enDict['shortcut.switchMode'] === 'Switch between annotate and edit',
  'mode shortcut hints localized in both dictionaries',
)
assert(registrations.tabs.length === 1, 'exactly one tab type registered')
assert(registrations.tabs[0].id === 'dsh.nudge', 'tab type id matches the plugin id')
assert(registrations.tabs[0].kind === 'nudge', 'tab type kind registered')
assert(registrations.tabs[0].keepMounted === true, 'tab type keeps its body mounted')
assert(!registrations.tabs[0].guide || registrations.tabs[0].guide.length === 0, 'no top-level guide card: the inspector lives in the browser card submenu')
const bodyRegistrations = registrations.slots.filter((entry) => entry.register && entry.register.name === 'sidebar.right.pane.tab')
assert(bodyRegistrations.length === 1 && bodyRegistrations[0].register.key === 'dsh.nudge', 'tab body registered under the type id')
const titleRegistrations = registrations.slots.filter((entry) => entry.register && entry.register.name === 'sidebar.right.pane.tab.title')
assert(titleRegistrations.length === 1 && titleRegistrations[0].register.key === 'dsh.nudge', 'tab title registered under the type id')
assert(titleRegistrations[0].register.locale === 'dsh.nudge', 'tab title follows the plugin locale')
assert(typeof titleRegistrations[0].register.inject === 'function', 'tab title receives the plugin translator')
assert(typeof titleRegistrations[0].component === 'function', 'tab title renders a component with the product mark')
const composerOpen = registrations.slots.filter((entry) => entry.register && entry.register.name === 'conversation.input.left')
assert(composerOpen.length === 0, 'composer open button retired')
const composerChip = registrations.slots.filter((entry) => entry.register && entry.register.name === 'conversation.composer.dock')
assert(composerChip.length === 0, 'legacy composer dock chip retired')
const clipTray = registrations.slots.filter((entry) => entry.register && entry.register.name === 'conversation.input.overlay')
assert(clipTray.length === 1 && clipTray[0].register.id === 'nudge-clips', 'composer clip annotation tray registered')
assert(
  head.children.some((child) => child.id === 'dsh-nudge-global-style' && String(child.textContent || '').includes('[data-dsh-nudge-clip-chip]')),
  'global styles reserve a composer row for the clip chip',
)
const guideCard = registrations.slots.filter((entry) => entry.register && entry.register.name === 'sidebar.right.tab.guide.entry')
assert(guideCard.length === 1 && guideCard[0].register.key === '@deepseek-ai/dsh-client-ui-sidebar-browser', 'browser guide card extension registered')
const tabMenu = registrations.slots.filter((entry) => entry.register && entry.register.name === 'sidebar.right.tab.menu.item')
assert(tabMenu.length === 1 && tabMenu[0].register.id === 'nudge-open-browser', 'browser tab menu action registered')

assert(registrations.contextMenus.length === 1 && registrations.contextMenus[0].target === 'url' && registrations.contextMenus[0].id === 'nudge.url', 'link (URL) context menu action registered')

assert(
  registrations.shortcuts.map((command) => command.id).join(',') ===
    'nudge.open,nudge.annotate.toggle,nudge.edit.toggle,nudge.dom.toggle,nudge.workspace.toggle',
  'nudge registers one editable command per product action',
)
assert(
  registrations.shortcuts.every((command) => typeof command.label === 'function' && command.label().indexOf('shortcut.') === 0),
  'shortcut labels are localized through the plugin dictionary',
)
assert(
  registrations.shortcuts.every((command) => command.defaults['desktop:macos'] && command.defaults['web:macos']),
  'shortcut defaults cover desktop and web profiles',
)
assert(
  registrations.shortcuts.find((command) => command.id === 'nudge.annotate.toggle').defaults['desktop:macos'].code === 'Period',
  'annotation mode follows the reference Cmd/Ctrl+Shift+. binding',
)
assert(
  registrations.fixedShortcuts.length === 3 &&
    registrations.fixedShortcuts[0].id === 'nudge.fixed.space' &&
    registrations.fixedShortcuts[0].bindings[0].code === 'Space',
  'page-local Space interaction registers as a read-only fixed row',
)
assert(
  registrations.fixedShortcuts.some((fixed) => fixed.id === 'nudge.fixed.escape' && fixed.bindings[0].code === 'Escape') &&
    registrations.fixedShortcuts.some(
      (fixed) => fixed.id === 'nudge.fixed.shiftTab' && fixed.bindings[0].code === 'Tab' && fixed.bindings[0].modifiers.indexOf('shift') !== -1,
    ),
  'page-local Esc / Shift+Tab mode keys register as read-only fixed rows',
)
assert(
  Array.isArray(workspaceTestHook.nudgeShortcutPageKeys) && workspaceTestHook.nudgeShortcutPageKeys.length === 2,
  'the mode page-key rows are exposed to the shortcut sheet',
)
const keycapModel = workspaceTestHook.keycapModel
const macKeys = keycapModel({ code: 'Period', modifiers: ['meta', 'shift'] }, 'macos')
assert(
  macKeys.length === 3 &&
    macKeys[0].kind === 'icon' &&
    macKeys[0].icon === 'shift' &&
    macKeys[1].icon === 'command' &&
    macKeys[2].label === '.',
  'macOS keycaps use Lucide Command/Shift glyphs in system modifier order',
)
const winKeys = keycapModel({ code: 'KeyI', modifiers: ['control', 'shift'] }, 'windows')
assert(
  winKeys[0].label === 'Ctrl' && winKeys[1].icon === 'shift' && winKeys[2].label === 'I',
  'Windows keycaps keep Ctrl text and the Lucide Shift glyph',
)
assert(workspaceTestHook.keycapKeyLabel('KeyD') === 'D' && workspaceTestHook.keycapKeyLabel('Slash') === '/', 'keycap labels map physical codes')
const spaceKeys = keycapModel({ code: 'Space', modifiers: [] }, 'macos')
assert(spaceKeys.length === 1 && spaceKeys[0].icon === 'space' && spaceKeys[0].label === 'Space', 'Space renders the Lucide Space glyph')

// Resolve branches: feature gate, missing session, live tab dispatch and open.
const byId = (id) => registrations.shortcuts.find((command) => command.id === id)
workspaceTestHook.setPluginConfig({ enableAnnotate: false }, null)
const gated = byId('nudge.annotate.toggle').resolve({})
assert(gated.status === 'blocked' && gated.reason.indexOf('shortcut.featureOff') === 0, 'disabled feature blocks its shortcut')
workspaceTestHook.setPluginConfig({}, null)
registrations.noTarget = true
const noSession = byId('nudge.open').resolve({})
assert(noSession.status === 'blocked' && noSession.reason.indexOf('shortcut.noSession') === 0, 'no sidebar target blocks the shortcut')
registrations.noTarget = false
registrations.sidebarTabs = [{ id: 't', kind: 'nudge' }]
const dispatched = []
const disposeCommands = workspaceTestHook.registerNudgeTabCommands('t', 'session-1', { run: (action) => dispatched.push(action) })
byId('nudge.annotate.toggle').resolve({}).run()
assert(dispatched.join(',') === 'annotate', 'command routes to the live inspector tab body')
disposeCommands()
registrations.sidebarTabs = []
const disposeOpened = []
byId('nudge.dom.toggle').resolve({}).run()
assert(
  registrations.openedIn && registrations.openedIn.kind === 'nudge' && registrations.openedIn.options.paneId === 'p',
  'panel command opens the inspector in the target pane when no tab exists',
)
const disposeQueued = workspaceTestHook.registerNudgeTabCommands('opened-tab', 'session-1', { run: (action) => disposeOpened.push(action) })
assert(disposeOpened.join(',') === 'dom', 'command queued for a fresh tab runs once the body mounts')
disposeQueued()
workspaceTestHook.registerNudgeTabCommands('t2', 'session-1', { run: () => {} })()
assert(workspaceTestHook.initialInspectorMode({ navigation: { params: { mode: 'annotate' } } }) === 'annotate', 'shortcut params open the inspector in annotate')
assert(workspaceTestHook.initialInspectorMode({ navigation: { params: { mode: 'bogus' } } }) === 'browse', 'unknown shortcut params fall back to browse')
assert(typeof workspaceTestHook.ShortcutSheet === 'function' && typeof workspaceTestHook.ModeHintContent === 'function', 'shortcut surfaces are exported from the UI bundle')
assert(source.includes('data-shortcut-sheet'), 'bundle ships the shortcut sheet surface')
assert(source.includes('mode-change'), 'bundle ships the runtime -> client mode channel')
assert(source.includes('data-mode-hint-content'), 'bundle ships the hover tooltip hint')
assert(source.includes('dshnudge-keycap'), 'bundle ships the Lucide keycap surface')

const settingsSection = registrations.slots.filter((entry) => entry.register && entry.register.name === 'settings.section')
assert(settingsSection.length === 1 && settingsSection[0].register.id === 'nudge-config', 'settings → nudge page registered')
assert(settingsSection[0].register.order > 60, 'settings page sorts after the shipped settings pages')
assert(typeof settingsSection[0].register.label === 'function' && settingsSection[0].register.label() === 'settings.nav', 'settings page label is localized through the plugin dictionary')
assert(typeof settingsSection[0].component === 'function', 'settings page renders a component')
const settingsIcon = registrations.slots.filter((entry) => entry.register && entry.register.name === 'settings.section.icon')
assert(settingsIcon.length === 1 && settingsIcon[0].register.id === 'nudge-config', 'settings navigation icon registered under the same id')

// --------------------------------------------------- source-sync queue wiring
const syncInternals = workspaceTestHook.syncQueueInternals
assert(syncInternals !== null && typeof syncInternals === 'object', 'sync queue test seam is exposed')
assert(syncInternals.SYNC_DEBOUNCE_MS === 550, 'sync queue debounce stays at 550 ms')
assert(typeof workspaceTestHook.createSyncQueue === 'function', 'source-sync queue is bundled')

function syncRpcStub(value) {
  const calls = []
  const ctx = {
    connection: {
      rpc: {
        call(path, name, payload) {
          calls.push({ path, name, payload })
          return Promise.resolve({ ok: true, value })
        },
      },
    },
  }
  return { ctx, calls }
}
const syncedValue = {
  results: [{ id: 'text|op-synced', status: 'synced', file: 'index.html', strategy: 'html-text', line: 40 }],
  files: ['index.html'],
  warnings: [],
}
const live = syncRpcStub(syncedValue)
syncInternals.ensureTab('sync-tab', {
  url: 'http://127.0.0.1:57327/index.html',
  title: 'demo',
  history: { ops: [{ id: 'op-synced', kind: 'text', syncStatus: 'preview' }], index: 0, lastKey: '', lastAt: 0 },
})
const liveQueue = workspaceTestHook.createSyncQueue(
  live.ctx,
  'sync-tab',
  () => syncInternals.tabState('sync-tab'),
  () => 'session-1',
)
liveQueue.enqueue({
  id: 'text|op-synced',
  opId: 'op-synced',
  kind: 'text',
  selector: 'h1.hero-title',
  path: [],
  before: '把每一次车型推荐',
  after: '把每一次车型推荐33333',
  outerHTML: '<h1 class="hero-title">把每一次车型推荐<br>做成一张会说话的卡片</h1>',
  textSnippet: '把每一次车型推荐 做成一张会说话的卡片',
  sourceHints: { file: 'demo/index.html', line: 30 },
})
liveQueue.flush()
assert(live.calls.length === 1 && live.calls[0].name === 'nudge/sync', 'the queue calls the Host sync endpoint')
assert(live.calls[0].payload && live.calls[0].payload.args.session === 'session-1', 'the queue forwards the live session id')
assert(live.calls[0].payload.args.edits[0].textBefore === '把每一次车型推荐', 'the queue forwards the text-before payload')
assert(live.calls[0].payload.args.edits[0].textAfter === '把每一次车型推荐33333', 'the queue forwards the text-after payload')
await new Promise((resolve) => setTimeout(resolve, 0))
const syncedTab = syncInternals.tabState('sync-tab')
assert(syncedTab.sync.status === 'done', 'a synced batch marks the tab as done')
assert(syncedTab.sync.message === 'index.html', 'the synced file is reported on the tab')
assert(
  syncedTab.history.ops.some((op) => op.id === 'op-synced' && op.syncStatus === 'synced'),
  'the matching history operation is marked synced',
)

const offline = syncRpcStub(syncedValue)
syncInternals.ensureTab('sync-tab-nosession', { url: 'http://127.0.0.1:57327/index.html', title: 'demo' })
const offlineQueue = workspaceTestHook.createSyncQueue(
  offline.ctx,
  'sync-tab-nosession',
  () => syncInternals.tabState('sync-tab-nosession'),
  () => '',
)
offlineQueue.enqueue({ id: 'text|op-offline', opId: 'op-offline', kind: 'text', selector: 'h1.hero-title', before: 'a', after: 'b' })
offlineQueue.flush()
assert(offline.calls.length === 0, 'a missing session never reaches the Host')
const offlineTab = syncInternals.tabState('sync-tab-nosession')
assert(offlineTab.sync.status === 'error' && offlineTab.sync.message === 'no-session', 'a missing session is recorded as a sync error')
assert(
  source.split('dock.syncSynced').length - 1 >= 3,
  'sync success is rendered in the dock, not only localized',
)
assert(
  source.split('dock.syncFailed').length - 1 >= 3,
  'sync failure is rendered in the dock, not only localized',
)
assert(source.includes('refreshToken'), 'the workspace panel receives a post-sync refresh token')

if (failures > 0) {
  console.error('\n' + failures + ' client smoke failure(s)')
  process.exit(1)
}
console.log('\nclient smoke ok')
