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
// Opt into the engineering client seams (same gate as test/client-theme.test.mjs).
globalThis.__DSH_VI_TEST_HOOKS__ = true
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
  JSON.stringify(workspaceTestHook.toolbarLayout(900)) === JSON.stringify({ compact: false, tiny: false, panelLabels: true }),
  'wide toolbar keeps mode and panel labels and two rows',
)
assert(
  JSON.stringify(workspaceTestHook.toolbarLayout(600)) === JSON.stringify({ compact: false, tiny: false, panelLabels: true }),
  'the dedicated action row keeps mode and panel labels at sidebar widths',
)
assert(
  JSON.stringify(workspaceTestHook.toolbarLayout(500)) === JSON.stringify({ compact: false, tiny: false, panelLabels: false }),
  'mid-width pane keeps mode labels but folds the DOM / workspace labels',
)
assert(
  JSON.stringify(workspaceTestHook.toolbarLayout(579)) === JSON.stringify({ compact: false, tiny: false, panelLabels: false }) &&
    JSON.stringify(workspaceTestHook.toolbarLayout(580)) === JSON.stringify({ compact: false, tiny: false, panelLabels: true }),
  'panel labels appear exactly at the measured no-overflow width',
)
assert(
  JSON.stringify(workspaceTestHook.toolbarLayout(440)) === JSON.stringify({ compact: true, tiny: false, panelLabels: false }),
  'very narrow toolbar collapses mode labels in the action row',
)
assert(
  JSON.stringify(workspaceTestHook.toolbarLayout(400)) === JSON.stringify({ compact: true, tiny: true, panelLabels: false }),
  'tiny toolbar also drops forward and the go button',
)
assert(
  JSON.stringify(workspaceTestHook.toolbarLayout(Number.NaN)) === JSON.stringify({ compact: false, tiny: false, panelLabels: true }),
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
assert(source.includes('data-dsh-nudge-dock'), 'bundle ships the single-panel dock contract')
assert(source.includes('data-dock-resizer'), 'bundle ships the dock resize handle contract')
assert(source.includes('data-dockkit-pointer'), 'bundle ships the drag pointer catcher for the embedded webview')
assert(source.includes('data-workspace-file-dir'), 'bundle ships the hover-only file directory contract')
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

// -------------------------------------- structure payload / status / replay / undo
const clientInternals = exportsObject.__dshnudgeSyncInternals
assert(clientInternals !== null && typeof clientInternals === 'object', 'client sync/history test seam is exposed')
assert(typeof clientInternals.defaultWorkspaceUrl === 'function', 'default workspace page seam is exposed')

console.log('\n# default workspace page for a freshly opened folder')
{
  const calls = []
  let workspaceReply = {
    htmlFiles: [
      { path: 'demo/about.html', name: 'about.html' },
      { path: 'demo/index.html', name: 'index.html' },
    ],
  }
  const remote = (endpoint, args) => {
    calls.push({ endpoint, args })
    if (endpoint === 'workspace') return Promise.resolve(workspaceReply)
    if (endpoint === 'previewOpen') return Promise.resolve({ url: 'http://127.0.0.1:43127/' + args.file })
    return Promise.resolve(null)
  }
  const url = await clientInternals.defaultWorkspaceUrl(remote, 'session-1')
  assert(url === 'http://127.0.0.1:43127/demo/index.html', 'the first workspace page is the index.html entry point')
  assert(calls.length === 2 && calls[0].endpoint === 'workspace', 'the default page scans the workspace first')
  assert(
    calls[1].endpoint === 'previewOpen' && calls[1].args.file === 'demo/index.html' && calls[1].args.session === 'session-1',
    'the default page starts the preview server for the chosen file',
  )

  calls.length = 0
  workspaceReply = { htmlFiles: [] }
  assert((await clientInternals.defaultWorkspaceUrl(remote, 'session-1')) === null, 'no HTML files leaves the address bar alone')
  assert(calls.length === 1, 'an empty workspace never starts a preview server')

  calls.length = 0
  assert((await clientInternals.defaultWorkspaceUrl(remote, '')) === null, 'a session-less tab has no default page')
  assert(calls.length === 0, 'a session-less tab never calls the Host')

  const failing = () => Promise.reject(new Error('host down'))
  assert((await clientInternals.defaultWorkspaceUrl(failing, 'session-1')) === null, 'a Host failure stays silent')
  const noUrl = (endpoint) => Promise.resolve(endpoint === 'workspace' ? { htmlFiles: [{ path: 'index.html' }] } : {})
  assert((await clientInternals.defaultWorkspaceUrl(noUrl, 'session-1')) === null, 'a preview without a URL is ignored')
}

const structureUrl = 'http://127.0.0.1:57327/index.html'

function structureQueue(tabId, value) {
  const stub = syncRpcStub(value)
  syncInternals.ensureTab(tabId, { url: structureUrl, title: 'demo' })
  const meta = []
  const queue = workspaceTestHook.createSyncQueue(
    stub.ctx,
    tabId,
    () => syncInternals.tabState(tabId),
    () => 'session-1',
    (payload) => meta.push(payload),
  )
  return { stub, queue, meta }
}

console.log('\n# structure remove wire payload')
const removeHtml = '<article class="marketing-card"><h3>问界 M9</h3></article>' + '\n'.repeat(70000)
const removeRun = structureQueue('sync-structure-remove', {
  results: [{ id: 'remove|op-remove', status: 'preview', reason: 'unresolved-element' }],
  files: [],
  warnings: [],
})
removeRun.queue.enqueue({
  id: 'remove|op-remove',
  opId: 'op-remove',
  kind: 'remove',
  selector: 'article.marketing-card',
  path: [1, 2],
  outerHTML: removeHtml,
  textSnippet: '问界 M9',
  textBefore: '问界 M9 卡片',
  elementKey: 'el_7',
  parentSelector: '#card-grid',
  beforeSelector: 'article:nth-of-type(2)',
  sourceHints: { file: 'demo/index.html', line: 92 },
})
removeRun.queue.flush()
const removeEdit = removeRun.stub.calls[0].payload.args.edits[0]
assert(removeEdit.kind === 'remove', 'a structure remove travels as kind remove')
assert(removeEdit.textBefore === '问界 M9 卡片', 'remove payload carries textBefore (not only textSnippet)')
assert(
  removeEdit.outerHTML === removeHtml.slice(0, 65536) && removeEdit.outerHTML.length === 65536 && !removeEdit.outerHTML.endsWith('…'),
  'remove outerHTML is capped at 64 KiB without appending an ellipsis',
)
assert(removeEdit.outerHTMLTruncated === true, 'a cut outerHTML is explicitly flagged as truncated')
assert(removeEdit.elementKey === 'el_7', 'remove payload carries the runtime element key')
assert(
  removeEdit.parentSelector === '#card-grid' && removeEdit.beforeSelector === 'article:nth-of-type(2)',
  'remove payload carries the parent / next-sibling anchors',
)
await new Promise((resolve) => setTimeout(resolve, 0))
const removeTab = syncInternals.tabState('sync-structure-remove')
assert(removeTab.sync.status === 'preview' && removeTab.sync.message === 'unresolved-element', 'a preview-only structure batch is reported as preview, never done')

console.log('\n# structure move wire payload + handle feedback')
const moveRun = structureQueue('sync-structure-move', {
  results: [
    { id: 'move|op-move', status: 'synced', file: 'index.html', handle: { openStart: 120, line: 33, tag: 'article', openTagDigest: 'digest-1' } },
  ],
  files: ['index.html'],
  warnings: [],
})
moveRun.queue.enqueue({
  id: 'move|op-move',
  opId: 'op-move',
  kind: 'move',
  selector: '#open-card',
  path: [0, 1],
  outerHTML: '<div id="open-card">x</div>',
  textSnippet: 'x',
  textBefore: 'x',
  elementKey: 'el_2',
  targetParentSelector: '#hero',
  targetParentPath: [0, 0],
  beforeSelector: '#intro',
  beforePath: [1, 2],
  fromParentSelector: '#card-grid',
  fromBeforeSelector: null,
})
moveRun.queue.flush()
const moveEdit = moveRun.stub.calls[0].payload.args.edits[0]
assert(moveEdit.kind === 'move' && moveEdit.targetParentSelector === '#hero', 'a move keeps its target parent selector')
assert(
  JSON.stringify(moveEdit.targetParentPath) === JSON.stringify([0, 0]) && JSON.stringify(moveEdit.beforePath) === JSON.stringify([1, 2]),
  'the move payload carries targetParentPath / beforePath (previously dropped)',
)
assert(
  moveEdit.fromParentSelector === '#card-grid' && moveEdit.fromBeforeSelector === null,
  'the move payload carries the original parent / sibling anchors',
)
await new Promise((resolve) => setTimeout(resolve, 0))
const moveTab = syncInternals.tabState('sync-structure-move')
assert(moveTab.sync.status === 'done', 'an all-synced batch is reported as done')
assert(
  moveRun.meta.length === 1 && moveRun.meta[0].handles['#open-card'] && moveRun.meta[0].handles['#open-card'].line === 33,
  'the Host handle is reported back keyed by selector',
)

console.log('\n# structure coalescing')
const coalesceRun = structureQueue('sync-structure-coalesce', {
  results: [
    { id: 'move|op-a', status: 'synced', file: 'index.html' },
    { id: 'move|op-b', status: 'synced', file: 'index.html' },
  ],
  files: ['index.html'],
  warnings: [],
})
coalesceRun.queue.enqueue({ id: 'move|op-a', opId: 'op-a', kind: 'move', selector: '#card', path: [0], outerHTML: '<p id="card">a</p>', targetParentSelector: '#a' })
coalesceRun.queue.enqueue({ id: 'move|op-b', opId: 'op-b', kind: 'move', selector: '#card', path: [0], outerHTML: '<p id="card">a</p>', targetParentSelector: '#b' })
coalesceRun.queue.flush()
assert(coalesceRun.stub.calls[0].payload.args.edits.length === 2, 'two quick gestures on the same selector are both sent, not coalesced')
await new Promise((resolve) => setTimeout(resolve, 0))

console.log('\n# status aggregation')
const mixedRun = structureQueue('sync-status-mixed', {
  results: [
    { id: 'text|op-mixed-text', status: 'synced', file: 'index.html' },
    { id: 'remove|op-mixed-remove', status: 'preview', reason: 'unresolved-target-parent' },
  ],
  files: ['index.html'],
  warnings: [],
})
mixedRun.queue.enqueue({ id: 'text|op-mixed-text', opId: 'op-mixed-text', kind: 'text', selector: 'h2', before: 'a', after: 'b' })
mixedRun.queue.enqueue({ id: 'remove|op-mixed-remove', opId: 'op-mixed-remove', kind: 'remove', selector: '#gone', outerHTML: '<p></p>' })
mixedRun.queue.flush()
await new Promise((resolve) => setTimeout(resolve, 0))
const mixedTab = syncInternals.tabState('sync-status-mixed')
assert(mixedTab.sync.status === 'partial', 'one synced + one preview aggregates to partial, never done')
assert(
  mixedTab.sync.meta && mixedTab.sync.meta.synced === 1 && mixedTab.sync.meta.preview === 1 && mixedTab.sync.meta.reason === 'unresolved-target-parent',
  'the partial status carries structured synced/preview counts + the first raw reason for localization',
)
assert(
  mixedTab.sync.message === 'unresolved-target-parent',
  'the partial message stays the raw reason code (the dock localizes it)',
)

const previewRun = structureQueue('sync-status-preview', {
  results: [
    { id: 'remove|op-p1', status: 'preview', reason: 'path-mismatch' },
    { id: 'remove|op-p2', status: 'preview', reason: 'unresolved-target-anchor' },
  ],
  files: [],
  warnings: [],
})
previewRun.queue.enqueue({ id: 'remove|op-p1', opId: 'op-p1', kind: 'remove', selector: '#p1', outerHTML: '<p></p>' })
previewRun.queue.enqueue({ id: 'remove|op-p2', opId: 'op-p2', kind: 'remove', selector: '#p2', outerHTML: '<p></p>' })
previewRun.queue.flush()
await new Promise((resolve) => setTimeout(resolve, 0))
const previewTab = syncInternals.tabState('sync-status-preview')
assert(previewTab.sync.status === 'preview' && previewTab.sync.message === 'path-mismatch', 'an all-preview batch reports preview with the first reason')

const doneRun = structureQueue('sync-status-done', {
  results: [
    { id: 'remove|op-d1', status: 'synced', file: 'index.html' },
    { id: 'remove|op-d2', status: 'synced', file: 'index.html' },
  ],
  files: ['index.html'],
  warnings: [],
})
doneRun.queue.enqueue({ id: 'remove|op-d1', opId: 'op-d1', kind: 'remove', selector: '#d1', outerHTML: '<p></p>' })
doneRun.queue.enqueue({ id: 'remove|op-d2', opId: 'op-d2', kind: 'remove', selector: '#d2', outerHTML: '<p></p>' })
doneRun.queue.flush()
await new Promise((resolve) => setTimeout(resolve, 0))
const doneTab = syncInternals.tabState('sync-status-done')
assert(doneTab.sync.status === 'done' && doneTab.sync.message === 'index.html', 'an all-synced batch reports done with the written files')
assert(
  doneTab.history && doneTab.history.ops.length === 0,
  'sync status reports do not invent history operations',
)

console.log('\n# replay filter')
const replayHistory = {
  index: 3,
  ops: [
    { id: 'kept', kind: 'style', syncStatus: 'preview', selector: 'h1.hero-title', property: 'color', after: 'red' },
    { id: 'persisted', kind: 'remove', syncStatus: 'preview', persisted: true, pageUrl: structureUrl },
    { id: 'other-page', kind: 'move', syncStatus: 'preview', pageUrl: 'http://127.0.0.1:57327/other.html' },
    { id: 'undone', kind: 'remove', syncStatus: 'undone', pageUrl: structureUrl },
    { id: 'ahead', kind: 'remove', syncStatus: 'preview', pageUrl: structureUrl },
  ],
}
const replayed = clientInternals.replayableOperations(replayHistory, structureUrl)
assert(replayed.length === 1 && replayed[0].id === 'kept', 'replay keeps only live preview ops of this page')
assert(!replayed.some((op) => op.id === 'persisted'), 'an op the Host persisted is not replayed')
assert(!replayed.some((op) => op.id === 'other-page'), 'an op recorded on another page is not replayed')
assert(!replayed.some((op) => op.id === 'ahead'), 'ops after history.index are not replayed')
assert(!replayed.some((op) => op.id === 'undone'), 'an undone op is not replayed')

console.log('\n# structure undo / redo')
function stepDeps(op, carrier) {
  const state = { enqueued: [], marked: [], notices: [], advanced: 0 }
  return {
    state,
    deps: {
      tab: { history: { ops: [op], index: 0 } },
      carrier,
      translate: (key, vars) => key + (vars && vars.reason ? ':' + vars.reason : ''),
      advance: () => { state.advanced += 1 },
      enqueue: (record) => state.enqueued.push(record),
      mark: (target, status) => state.marked.push([target.id, status]),
      refresh: () => {},
      notice: (tone, text) => state.notices.push({ tone, text }),
    },
  }
}

const removeOp = {
  id: 'op-remove-undo',
  kind: 'remove',
  selector: 'article.marketing-card',
  path: [1, 2],
  outerHTML: '<article class="marketing-card">x</article>',
  textBefore: 'x',
  textSnippet: 'x',
  elementKey: 'el_9',
  parentSelector: '#card-grid',
  beforeSelector: 'article:nth-of-type(2)',
  syncStatus: 'preview',
}
const removeCalls = []
const removeStep = stepDeps(removeOp, {
  applyInsert: (spec) => { removeCalls.push(spec); return Promise.resolve({ ok: true }) },
  applyMoveElement: () => Promise.resolve({ ok: false }),
  reapply: () => Promise.resolve({ ok: true }),
})
const removeUndone = await clientInternals.applyHistoryStep(removeStep.deps, 'undo')
assert(removeUndone === true, 'undo of a remove completes')
assert(removeCalls.length === 1, 'undo of a remove calls carrier.applyInsert')
assert(
  removeCalls[0].parentSelector === '#card-grid' && removeCalls[0].beforeSelector === 'article:nth-of-type(2)' && removeCalls[0].html === removeOp.outerHTML,
  'the insert inverse uses the saved parent / sibling anchors and full markup',
)
assert(
  removeStep.state.enqueued.length === 1 &&
    removeStep.state.enqueued[0].kind === 'insert' &&
    removeStep.state.enqueued[0].targetParentSelector === '#card-grid' &&
    removeStep.state.enqueued[0].html === removeOp.outerHTML,
  'undo enqueues an insert edit so the source is patched back',
)
assert(removeStep.state.marked.length === 1 && removeStep.state.marked[0][1] === 'undone', 'undo marks the op undone so replay skips it')
assert(removeStep.state.advanced === 1, 'undo advances the history pointer')
assert(
  removeStep.state.notices.some((notice) => notice.text.indexOf('dock.structureUndoDone') === 0),
  'undo reports that the source was written back',
)

const truncatedOp = Object.assign({}, removeOp, { id: 'op-remove-truncated', outerHTMLTruncated: true })
const truncatedCalls = []
const truncatedStep = stepDeps(truncatedOp, {
  applyInsert: (spec) => { truncatedCalls.push(spec); return Promise.resolve({ ok: true }) },
  applyMoveElement: () => Promise.resolve({ ok: false }),
  reapply: () => Promise.resolve({ ok: true }),
})
await clientInternals.applyHistoryStep(truncatedStep.deps, 'undo')
assert(truncatedCalls.length === 1, 'a truncated capture still restores the live DOM')
assert(truncatedStep.state.enqueued.length === 0, 'a truncated capture never queues an insert patch (source stays untouched)')
assert(
  truncatedStep.state.notices.some((notice) => notice.text.indexOf('dock.structureUndoTruncated') === 0 && notice.tone === 'error'),
  'a truncated capture reports the failed write-back',
)

const moveOp = {
  id: 'op-move-undo',
  kind: 'move',
  selector: '#moved',
  elementKey: 'el_2',
  fromParentSelector: '#origin',
  fromBeforeSelector: 'article:nth-of-type(1)',
  targetParentSelector: '#hero',
  targetParentPath: [0, 1],
  beforeSelector: null,
  outerHTML: '<p id="moved">x</p>',
  textBefore: 'x',
  textSnippet: 'x',
  syncStatus: 'preview',
}
const moveCalls = []
const moveStep = stepDeps(moveOp, {
  applyInsert: () => Promise.resolve({ ok: false }),
  applyMoveElement: (spec) => { moveCalls.push(spec); return Promise.resolve({ ok: true, selector: 'p#moved' }) },
  reapply: () => Promise.resolve({ ok: true }),
})
const moveUndone = await clientInternals.applyHistoryStep(moveStep.deps, 'undo')
assert(moveUndone === true && moveCalls.length === 1, 'undo of a move calls carrier.applyMoveElement')
assert(
  moveCalls[0].elementKey === 'el_2' && moveCalls[0].parentSelector === '#origin' && moveCalls[0].beforeSelector === 'article:nth-of-type(1)',
  'the move inverse uses the element key and the original parent / sibling anchors',
)
assert(
  moveStep.state.enqueued.length === 1 &&
    moveStep.state.enqueued[0].kind === 'move' &&
    moveStep.state.enqueued[0].selector === 'p#moved' &&
    moveStep.state.enqueued[0].targetParentSelector === '#origin' &&
    moveStep.state.enqueued[0].beforeSelector === 'article:nth-of-type(1)',
  'undo of a move enqueues a move edit back to the original parent',
)
assert(moveStep.state.marked.length === 1 && moveStep.state.marked[0][1] === 'undone', 'undone move is marked undone')

console.log('\n# runtime locale forwarding')
const zhRuntimeLocale = clientInternals.buildRuntimeLocale((key) => zhDict[key] || key)
assert(
  zhRuntimeLocale.annotation.designDelete === zhDict['annotation.designDelete'] &&
    zhRuntimeLocale.annotation.designDeleteHint === zhDict['annotation.designDeleteHint'] &&
    zhRuntimeLocale.annotation.designMoveHint === zhDict['annotation.designMoveHint'] &&
    zhRuntimeLocale.annotation.designDelete === '删除元素',
  'runtime locale forwards the delete / move card strings (zh no longer shows English)',
)
assert(
  clientInternals.syncReasonText((key) => 'zh:' + key, 'unsupported-js-source') === 'zh:source.reasonJsSource',
  'the new unsupported-js-source reason is localized',
)
assert(
  clientInternals.syncReasonText((key) => 'zh:' + key, 'unsupported-edit-kind') === 'zh:source.reasonUnsupportedKind',
  'unsupported-edit-kind is localized instead of showing a raw code',
)
assert(
  ['invalid-edit', 'file-missing', 'read-failed', 'write-failed', 'stale-version', 'read-only-policy'].every(
    (code) => clientInternals.syncReasonText((key) => 'zh:' + key, code) !== code,
  ),
  'every Host reason code maps to localized copy',
)

console.log('\n# stale Host capability detection')
assert(clientInternals.hostHasCapability('insert') === true, 'capabilities are assumed until probed (no false alarm)')
clientInternals.rememberHostCapabilities(['structure-v1'])
assert(clientInternals.hostHasCapability('insert') === false, 'an old Host without insert disables the capability')
clientInternals.rememberHostCapabilities(['structure-v1', 'insert', 'handle'])
assert(
  clientInternals.hostHasCapability('insert') === true && clientInternals.hostCapabilitySnapshot().length === 3,
  'a current Host advertises insert/handle',
)
assert(
  source.includes('dock.syncHostStale') && source.includes('reasonUnsupportedKind'),
  'the stale-Host mismatch renders actionable copy, not a raw reason code',
)
clientInternals.rememberHostCapabilities(null)
assert(
  zhDict['source.reasonProtected'] !== undefined &&
    zhDict['source.reasonTargetParent'] !== undefined &&
    zhDict['source.reasonTargetAnchor'] !== undefined &&
    zhDict['source.reasonInvalidMove'] !== undefined &&
    zhDict['source.reasonUnsupportedParent'] !== undefined &&
    zhDict['source.reasonJsSource'] !== undefined &&
    zhDict['source.reasonStaleHandle'] !== undefined &&
    zhDict['source.reasonTooLarge'] !== undefined &&
    zhDict['source.reasonNoMapping'] !== undefined &&
    zhDict['source.reasonUnsupportedKind'] !== undefined &&
    zhDict['source.reasonUnsupportedSource'] !== undefined &&
    zhDict['source.reasonInvalidEdit'] !== undefined &&
    zhDict['source.reasonMissingFile'] !== undefined &&
    zhDict['source.reasonIoFailed'] !== undefined &&
    zhDict['source.reasonStaleVersion'] !== undefined &&
    zhDict['source.reasonInternal'] !== undefined &&
    zhDict['source.reasonReadOnly'] !== undefined &&
    enDict['source.reasonJsSource'] !== undefined &&
    enDict['source.reasonUnsupportedKind'] !== undefined,
  'every structure reason code has a zh + en explanation',
)
assert(
  zhDict['dock.syncPartial'] === '部分未写入' &&
    String(zhDict['dock.syncPartialText']).indexOf('{synced}') !== -1 &&
    String(zhDict['dock.syncHostStale']).indexOf('DSH') !== -1 &&
    zhDict['dock.structureUndoDone'] === '已撤销并回写源码',
  'new dock copy is localized in zh',
)
assert(enDict['dock.syncPartial'] === 'Partially synced' && String(enDict['dock.structureUndoFailed']).indexOf('{reason}') !== -1, 'new dock copy is localized in en')

if (failures > 0) {
  console.error('\n' + failures + ' client smoke failure(s)')
  process.exit(1)
}
console.log('\nclient smoke ok')
