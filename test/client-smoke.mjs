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
  JSON.stringify(workspaceTestHook.toolbarLayout(900)) === JSON.stringify({ compact: false, narrow: false, tiny: false }),
  'wide toolbar keeps every action inline with labels',
)
assert(
  JSON.stringify(workspaceTestHook.toolbarLayout(600)) === JSON.stringify({ compact: true, narrow: true, tiny: false }),
  'narrow toolbar collapses secondary actions and hides labels',
)
assert(
  JSON.stringify(workspaceTestHook.toolbarLayout(400)) === JSON.stringify({ compact: true, narrow: true, tiny: true }),
  'tiny toolbar also drops forward and the go button',
)
assert(
  JSON.stringify(workspaceTestHook.toolbarLayout(Number.NaN)) === JSON.stringify({ compact: false, narrow: false, tiny: false }),
  'toolbar layout falls back to wide before the first measurement',
)
assert(source.includes('data-toolbar-secondary'), 'bundle ships the expandable secondary toolbar row')
assert(source.includes('data-toolbar-primary'), 'bundle ships the primary toolbar row marker')
assert(source.includes('data-dsh-nudge-workspace-panel'), 'bundle ships the workspace panel DOM contract')
assert(source.includes('data-hot-reload-pending'), 'bundle ships the hot-reload toolbar pending state')

const registrations = { locales: [], tabs: [], slots: [], shortcuts: [], contextMenus: [], effects: [] }
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
    commandTarget() { return { paneId: 'p', tabId: 't', sessionId: 'session-1' } },
  },
  inject(services, callback) { callback({ shortcuts: { register(def) { registrations.shortcuts.push(def); return () => {} } }, contextMenus: { register(def) { registrations.contextMenus.push(def); return () => {} } }, effect(fn) { registrations.effects.push(fn); return () => {} }, slots: this.slots }) },
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
assert(registrations.tabs.length === 1, 'exactly one tab type registered')
assert(registrations.tabs[0].id === 'dsh.nudge', 'tab type id matches the plugin id')
assert(registrations.tabs[0].kind === 'nudge', 'tab type kind registered')
assert(registrations.tabs[0].keepMounted === true, 'tab type keeps its body mounted')
assert(!registrations.tabs[0].guide || registrations.tabs[0].guide.length === 0, 'no top-level guide card: the inspector lives in the browser card submenu')
const bodyRegistrations = registrations.slots.filter((entry) => entry.register && entry.register.name === 'sidebar.right.pane.tab')
assert(bodyRegistrations.length === 1 && bodyRegistrations[0].register.key === 'dsh.nudge', 'tab body registered under the type id')
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

assert(registrations.shortcuts.length === 1 && registrations.shortcuts[0].id === 'nudge.open', 'open shortcut registered')

const settingsSection = registrations.slots.filter((entry) => entry.register && entry.register.name === 'settings.section')
assert(settingsSection.length === 1 && settingsSection[0].register.id === 'nudge-config', 'settings → nudge page registered')
assert(settingsSection[0].register.order > 60, 'settings page sorts after the shipped settings pages')
assert(typeof settingsSection[0].register.label === 'function' && settingsSection[0].register.label() === 'settings.nav', 'settings page label is localized through the plugin dictionary')
assert(typeof settingsSection[0].component === 'function', 'settings page renders a component')
const settingsIcon = registrations.slots.filter((entry) => entry.register && entry.register.name === 'settings.section.icon')
assert(settingsIcon.length === 1 && settingsIcon[0].register.id === 'nudge-config', 'settings navigation icon registered under the same id')

if (failures > 0) {
  console.error('\n' + failures + ' client smoke failure(s)')
  process.exit(1)
}
console.log('\nclient smoke ok')
