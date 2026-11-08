/**
 * Client theme-bridge test: proves the host UI reads the DSH palette from the
 * document body (where DSH publishes `--dsw-alias-*`), follows a
 * `body[data-ds-dark-theme]` flip, falls back to the OS color scheme when no
 * token exists yet, and notifies subscribers only when the palette changed.
 *
 * Engineering test only; it loads the generated bundle with a shim, exactly like
 * test/client-smoke.mjs.
 */
import { readFile } from 'node:fs/promises'
import { runInThisContext } from 'node:vm'

let failures = 0
let checks = 0
function ok(name) {
  checks += 1
  console.log('ok - ' + name)
}
function assert(condition, name) {
  checks += 1
  if (condition) console.log('ok - ' + name)
  else {
    failures += 1
    console.error('FAIL - ' + name)
  }
}
function eq(name, actual, expected) {
  if (actual === expected) ok(name + ' (' + JSON.stringify(actual) + ')')
  else {
    failures += 1
    console.error('FAIL - ' + name + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
  }
}

// ------------------------------------------------------------------ document shim
const LIGHT_TOKENS = {
  '--dsw-alias-bg-base': '#ffffff',
  '--dsw-alias-bg-layer-1': '#ffffff',
  '--dsw-alias-bg-layer-2': '#ffffff',
  '--dsw-alias-bg-layer-3': '#ffffff',
  '--dsw-alias-bg-overlay': '#e9ecf2',
  '--dsw-alias-border-l1': '#0000000a',
  '--dsw-alias-border-l2': '#0000001f',
  '--dsw-alias-brand-primary': '#0f1115',
  '--dsw-alias-state-business-primary': '#4176e6',
  '--dsw-alias-label-primary-foreground': '#ffffff',
  '--dsw-alias-label-primary': '#0f1115',
  '--dsw-alias-label-secondary': '#61666b',
  '--dsw-alias-label-tertiary': '#81858c',
  '--dsw-alias-state-error-primary': '#ec1313',
  '--dsw-alias-state-success-primary': '#22c55e',
  '--dsw-alias-state-warn-primary': '#f59e0b',
  '--dsw-alias-interactive-bg-hover': '#2631480f',
}
const DARK_TOKENS = {
  '--dsw-alias-bg-base': '#151517',
  '--dsw-alias-bg-layer-1': '#232324',
  '--dsw-alias-bg-layer-2': '#2c2c2e',
  '--dsw-alias-bg-layer-3': '#353638',
  '--dsw-alias-bg-overlay': '#61666b',
  '--dsw-alias-border-l1': '#ffffff0f',
  '--dsw-alias-border-l2': '#ffffff1f',
  '--dsw-alias-brand-primary': '#f9fafb',
  '--dsw-alias-state-business-primary': '#7aaaff',
  '--dsw-alias-label-primary-foreground': '#0f1115',
  '--dsw-alias-label-primary': '#f9fafb',
  '--dsw-alias-label-secondary': '#cfd3d6',
  '--dsw-alias-label-tertiary': '#adb2b8',
  '--dsw-alias-state-error-primary': '#f25a5a',
  '--dsw-alias-state-success-primary': '#22c55e',
  '--dsw-alias-state-warn-primary': '#f59e0b',
  '--dsw-alias-interactive-bg-hover': '#ffffff14',
}

const state = { tokens: { ...LIGHT_TOKENS }, bodyDark: false, mediaDark: false }
function fakeStyle() {
  return { cssText: '', setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } }
}
const head = { children: [], appendChild(child) { this.children.push(child) } }
const body = {
  appendChild() {},
  hasAttribute(name) {
    return name === 'data-ds-dark-theme' && state.bodyDark === true
  },
}
globalThis.document = {
  documentElement: {},
  head,
  body,
  getElementById() {
    return null
  },
  createElement(tag) {
    return { tagName: tag, style: fakeStyle(), setAttribute() {}, appendChild() {}, removeChild() {}, addEventListener() {}, removeEventListener() {} }
  },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.window = globalThis
globalThis.localStorage = { getItem() { return null }, setItem() {} }
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true })
globalThis.getComputedStyle = () => ({
  getPropertyValue(name) {
    return state.tokens[name] || ''
  },
})
globalThis.matchMedia = (query) => ({
  matches: String(query).includes('dark') ? state.mediaDark === true : false,
  addEventListener() {},
  removeEventListener() {},
})
globalThis.MutationObserver = class MutationObserver {
  constructor(callback) {
    this.callback = callback
  }
  observe() {}
  disconnect() {}
}

// ------------------------------------------------------------------ React shim
const React = {
  createElement(type, props, ...children) {
    const element = { type, props: props || {}, children }
    if (typeof type === 'function') {
      try {
        type(Object.assign({}, element.props, { children }))
      } catch {
        /* lucide/forwardRef components are not rendered under this shim */
      }
    }
    return element
  },
  Fragment: 'Fragment',
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
  useRef(initial) { return { current: initial } },
  useEffect() {},
  useLayoutEffect() {},
  useMemo(fn) { return fn() },
  useCallback(fn) { return fn },
  useSyncExternalStore(_sub, snap) { return snap() },
  useId() { return 'id-1' },
  createContext(defaultValue) { return { Provider: 'Provider', Consumer: 'Consumer', _currentValue: defaultValue } },
  forwardRef(render) { return render },
  createRef() { return { current: null } },
  useContext(context) { return context && context._currentValue },
  useReducer(_reducer, initial) { return [initial, () => {}] },
  useImperativeHandle() {},
  useInsertionEffect() {},
}

globalThis.__DSH_VI_TEST_HOOKS__ = true
let loaded = null
globalThis.__ModuleLoader__ = {
  load(definition) {
    loaded = definition
  },
}
const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
runInThisContext(source, { filename: 'lib/client.js' })
assert(loaded !== null, 'bundle registers a factory')
const exportsObject = loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
const internals = exportsObject.__dshnudgeThemeInternals
assert(internals && typeof internals.readTheme === 'function', 'theme bridge exposes its test seam')

// ------------------------------------------------------------------ palette reads
console.log('\n# reads the DSH tokens from <body>')
state.tokens = { ...LIGHT_TOKENS }
state.bodyDark = false
state.mediaDark = false
let theme = internals.readTheme()
eq('light base token', theme.base, '#ffffff')
eq('light text token', theme.text, '#0f1115')
eq('light muted token', theme.muted, '#61666b')
eq('light strong border token', theme.borderStrong, '#0000001f')
eq('light hover token', theme.hover, '#2631480f')
eq('light on-brand token', theme.onBrand, '#ffffff')
eq('light scheme detected from token luminance', theme.isDark, false)

console.log('\n# follows a body[data-ds-dark-theme] flip')
state.tokens = { ...DARK_TOKENS }
state.bodyDark = true
theme = internals.readTheme()
eq('dark base token', theme.base, '#151517')
eq('dark text token', theme.text, '#f9fafb')
eq('dark strong border token', theme.borderStrong, '#ffffff1f')
eq('dark on-brand token', theme.onBrand, '#0f1115')
eq('dark scheme detected', theme.isDark, true)

console.log('\n# falls back to the OS color scheme before tokens exist')
state.tokens = {}
state.bodyDark = false
state.mediaDark = false
theme = internals.readTheme()
eq('light fallback text', theme.text, '#0f1115')
eq('light fallback scheme', theme.isDark, false)
state.mediaDark = true
theme = internals.readTheme()
eq('dark fallback text', theme.text, '#f9fafb')
eq('dark fallback scheme', theme.isDark, true)
state.mediaDark = false

console.log('\n# system dark fallback wins even without the DSH attribute')
state.tokens = {}
state.bodyDark = false
state.mediaDark = true
theme = internals.readTheme()
eq('fallback text follows prefers-color-scheme', theme.text, '#f9fafb')
assert(theme.base !== '#ffffff', 'fallback base is not the light canvas')
state.mediaDark = false

// ------------------------------------------------------------------ store notifications
console.log('\n# theme store notifies only on a real palette change')
state.tokens = { ...LIGHT_TOKENS }
state.bodyDark = false
const store = internals.createThemeStore(undefined)
const seen = []
const unsubscribe = store.subscribe(function () {
  seen.push(store.getSnapshot().text)
})
eq('subscriber attached', seen.length, 0)
eq('initial snapshot is light', store.getSnapshot().text, '#0f1115')
store.refresh(false)
eq('identical palette does not notify', seen.length, 0)
state.tokens = { ...DARK_TOKENS }
state.bodyDark = true
store.refresh(false)
eq('palette change notified once', seen.length, 1)
eq('notified snapshot is dark', store.getSnapshot().text, '#f9fafb')
eq('signature matches the current read', internals.themeSignature(store.getSnapshot()), internals.themeSignature(internals.readTheme()))
unsubscribe()
state.tokens = { ...LIGHT_TOKENS }
state.bodyDark = false
store.refresh(false)
eq('unsubscribed listener is not called', seen.length, 1)

// ------------------------------------------------------------------ runtime palette
console.log('\n# runtime palette contract')
state.tokens = { ...LIGHT_TOKENS }
state.bodyDark = false
const lightPalette = internals.themePaletteForRuntime(internals.readTheme())
eq('runtime light isDark', lightPalette.isDark, false)
eq('runtime light panel surface', lightPalette.panelBg, '#ffffff')
eq('runtime light border', lightPalette.border, '#0000001f')
state.tokens = { ...DARK_TOKENS }
state.bodyDark = true
const darkPalette = internals.themePaletteForRuntime(internals.readTheme())
eq('runtime dark isDark', darkPalette.isDark, true)
eq('runtime dark panel surface', darkPalette.panelBg, '#2c2c2e')
eq('runtime dark border', darkPalette.border, '#ffffff1f')

// ------------------------------------------------------------------ component wiring
console.log('\n# registered host components render from the live palette')
const registrations = { slots: [], effects: [] }
const ctx = {
  locale: {
    register() { return () => {} },
    bind() { return (key) => key },
  },
  slots: {
    inject(name, callback) { registrations.slots.push({ name, callback }); return () => {} },
    register(options, component) { registrations.slots.push({ register: options, component }); return () => {} },
  },
  sidebarRightTabs: { register() { return () => {} } },
  sidebarRight: { openTab() {}, openTabFromTarget() {}, commandTarget() { return { paneId: 'p', tabId: 't', sessionId: 's' } } },
  inject(_services, callback) {
    callback({
      shortcuts: { register() { return () => {} } },
      contextMenus: { register() { return () => {} } },
      effect() { return () => {} },
      slots: this.slots,
      get() { return undefined },
    })
  },
  effect(fn) { registrations.effects.push(fn); return () => {} },
  get() { return undefined },
}
exportsObject.apply(ctx)
for (const entry of registrations.slots) {
  if (typeof entry.callback === 'function') entry.callback()
}
const menuRegistration = registrations.slots.find((entry) => entry.register && entry.register.name === 'sidebar.right.tab.menu.item')
assert(!!menuRegistration && typeof menuRegistration.component === 'function', 'browser tab menu action is registered')

// Slot registrations wrap the real component in one element; unwrap until the
// plain DOM element the component returns is reached.
function renderSlot(registration, props) {
  let node = registration.component(Object.assign({ ctx }, props))
  let guard = 0
  while (node && typeof node.type === 'function' && guard < 8) {
    node = node.type(node.props || {})
    guard += 1
  }
  return node
}
state.tokens = { ...LIGHT_TOKENS }
state.bodyDark = false
const lightMenu = renderSlot(menuRegistration, { t: (key) => key, tab: { kind: 'browser' }, sessionId: 's', dismiss() {} })
eq('light component text uses the light token', lightMenu.props.style.color, '#0f1115')
state.tokens = { ...DARK_TOKENS }
state.bodyDark = true
const darkMenu = renderSlot(menuRegistration, { t: (key) => key, tab: { kind: 'browser' }, sessionId: 's', dismiss() {} })
eq('dark component text uses the dark token', darkMenu.props.style.color, '#f9fafb')

if (failures > 0) {
  console.error('\n' + failures + ' client theme failure(s) / ' + checks + ' checks')
  process.exit(1)
}
console.log('\nclient theme ok (' + checks + ' checks, 0 failures)')
