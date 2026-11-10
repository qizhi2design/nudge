/**
 * Settings page test: renders the bundled `settings.section` component with a
 * minimal hook runtime and drives one read → edit → save round trip against a
 * fake `nudge/*` remote. Proves the page the Settings shell mounts has the
 * documented fields, seeds them from the Host snapshot, writes only the edited
 * keys, and degrades to read-only when the deployment exposes no editor.
 *
 * Engineering test only; the live shell render is exercised in the running
 * Desktop plugin.
 */
import { readFile } from 'node:fs/promises'
import { runInThisContext } from 'node:vm'

let failures = 0
let checks = 0
function ok(name) {
  checks += 1
  console.log('ok - ' + name)
}
function assert(condition, name, detail) {
  checks += 1
  if (condition) console.log('ok - ' + name)
  else {
    failures += 1
    console.error('FAIL - ' + name + (detail === undefined ? '' : ' — ' + detail))
  }
}

// ------------------------------------------------------------- hook runtime

/** One render pass: hook slots are positional, like React. */
function createRuntime() {
  let slots = []
  let effects = []
  let cursor = 0
  let version = 0

  const React = {
    createElement(type, props, ...children) {
      const flat = children.flat()
      if (typeof type === 'function') return type(Object.assign({}, props || {}, { children: flat }))
      return { type, props: props || {}, children: flat }
    },
    Fragment: 'Fragment',
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [
        slots[index],
        (next) => {
          slots[index] = typeof next === 'function' ? next(slots[index]) : next
          version += 1
        },
      ]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useEffect(fn) {
      effects.push(fn)
    },
    useLayoutEffect(fn) {
      effects.push(fn)
    },
    useCallback(fn, deps) {
      const index = cursor++
      const previous = slots[index]
      if (previous && sameDeps(previous.deps, deps)) return previous.fn
      slots[index] = { fn, deps }
      return fn
    },
    useMemo(fn) {
      return fn()
    },
    useSyncExternalStore(_subscribe, snapshot) {
      return snapshot()
    },
    useId() {
      return 'id-1'
    },
    createContext(defaultValue) {
      return { Provider: 'Provider', Consumer: 'Consumer', _currentValue: defaultValue }
    },
    useContext(context) {
      return context && context._currentValue
    },
    forwardRef(render) {
      return render
    },
    createRef() {
      return { current: null }
    },
    useReducer(_reducer, initial) {
      return [initial, () => {}]
    },
    useImperativeHandle() {},
    useInsertionEffect() {},
    useDebugValue() {},
    startTransition(fn) {
      return fn()
    },
    memo(component) {
      return component
    },
  }

  return {
    React,
    get version() {
      return version
    },
    reset() {
      slots = []
      effects = []
      cursor = 0
    },
    render(component, props) {
      cursor = 0
      effects = []
      const tree = component(props)
      const disposers = []
      for (const effect of effects) {
        const result = effect()
        if (typeof result === 'function') disposers.push(result)
      }
      return { tree, disposers }
    },
  }
}

function sameDeps(left, right) {
  if (left === undefined || right === undefined) return false
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false
  return true
}

/** Flush pending promise callbacks and timers. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ------------------------------------------------------------- DOM shim

function fakeStyles() {
  return { cssText: '', setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } }
}
globalThis.document = {
  documentElement: {},
  head: { children: [], appendChild(child) { this.children.push(child) } },
  body: { appendChild() {} },
  getElementById() {
    return null
  },
  createElement(tag) {
    return { tagName: tag, style: fakeStyles(), setAttribute() {}, appendChild() {}, removeChild() {}, addEventListener() {}, removeEventListener() {} }
  },
  addEventListener() {},
  removeEventListener() {},
}
globalThis.window = globalThis
globalThis.localStorage = { getItem() { return null }, setItem() {} }
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true })
globalThis.getComputedStyle = () => ({ getPropertyValue() { return '' } })

// ------------------------------------------------------------- bundle load

let loaded = null
globalThis.__ModuleLoader__ = {
  load(definition) {
    loaded = definition
  },
}
const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
runInThisContext(source, { filename: 'lib/client.js' })
assert(loaded !== null, 'bundle registers a factory')

const runtime = createRuntime()
const registrations = { slots: [] }
const locale = {
  register() {
    return () => {}
  },
  bind() {
    return (key, vars) => key + (vars ? '|' + JSON.stringify(vars) : '')
  },
}
const exportsObject = loaded.factory((name) => {
  if (name === 'react') return runtime.React
  if (name === 'react/jsx-runtime') return { jsx: runtime.React.createElement, jsxs: runtime.React.createElement, Fragment: 'Fragment' }
  throw new Error('unexpected require: ' + name)
})
const ctx = {
  locale,
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  inject(_services, callback) {
    const scope = {
      shortcuts: { register() { return () => {} } },
      contextMenus: { register() { return () => {} } },
      effect(fn) {
        const dispose = fn()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      get() {
        return undefined
      },
    }
    callback(scope)
  },
  slots: {
    inject(name, callback) {
      registrations.slots.push({ name, callback })
      return () => {}
    },
    register(options, component) {
      registrations.slots.push({ register: options, component })
      return () => {}
    },
  },
  sidebarRightTabs: { register() { return () => {} } },
  sidebarRight: { commandTarget() { return undefined }, openTabFromTarget() {}, openTabIn() {} },
  get() {
    return undefined
  },
  connection: { rpc: { call: () => Promise.reject(new Error('unused')) } },
}
exportsObject.apply(ctx)
for (const entry of registrations.slots) {
  if (typeof entry.callback === 'function') entry.callback()
}
const sectionEntry = registrations.slots.find((entry) => entry.register && entry.register.name === 'settings.section')
assert(sectionEntry !== undefined, 'settings section registration survived apply')
assert(typeof sectionEntry.component === 'function', 'settings section exposes a component')

// ------------------------------------------------------------- fake remote

function createRemote(behavior) {
  const calls = []
  const call = (channel, name, payload) => {
    calls.push({ channel, name, args: payload && payload.args })
    const endpoint = name.split('/')[1]
    return Promise.resolve(behavior(endpoint, payload && payload.args, calls.length)).then((value) => {
      if (value && value.__error) return { ok: false, error: { message: value.__error } }
      return { ok: true, value }
    })
  }
  return { calls, call }
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node.props === undefined) return ''
  return textOf(node.children)
}

function findNodes(tree, predicate, out = []) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return out
  if (Array.isArray(tree)) {
    for (const child of tree) findNodes(child, predicate, out)
    return out
  }
  if (tree.props !== undefined && predicate(tree)) out.push(tree)
  findNodes(tree.children, predicate, out)
  return out
}

async function settle(component, props, runtimeRef, until) {
  let rendered = runtimeRef.render(component, props)
  for (let attempt = 0; attempt < 14; attempt += 1) {
    if (until(rendered.tree)) return rendered
    await flush()
    rendered = runtimeRef.render(component, props)
  }
  return rendered
}

const PRODUCT_VALUES = {
  language: 'auto',
  enableAnnotate: true,
  enableEdit: true,
  enableDomTree: true,
  enableWorkspaceVersions: true,
  enableHotReload: true,
  contextMenuLink: true,
  contextMenuTab: true,
  hotkeyAnnotate: 'KeyA',
  hotkeyEdit: 'KeyE',
  hotkeyPrevAnnotation: 'ArrowUp',
  hotkeyNextAnnotation: 'ArrowDown',
}
const PRODUCT_DEFAULTS = { ...PRODUCT_VALUES }
const SNAPSHOT = {
  values: { ...PRODUCT_VALUES },
  defaults: { ...PRODUCT_DEFAULTS },
  overridden: ['language'],
  writable: true,
  source: 'profile',
}
const ABOUT = {
  name: '@huangqz/dsh.nudge',
  version: '0.2.0',
  pluginRoot: '/Users/example/visual-inspector/plugin',
  builds: [{ name: 'client.js', mtime: 1760000000000, size: 600000 }],
  git: { available: true, branch: 'main', commit: 'abc1234', dirty: true, remote: null },
  update: { status: 'unchecked' },
  runtime: { node: 'v24.0.0', platform: 'darwin', arch: 'arm64' },
}

function aboutPayload(check) {
  return Object.assign({}, ABOUT, {
    update: check === true ? { status: 'unavailable', reason: 'not-updatable', message: 'local link install' } : { status: 'unchecked' },
  })
}

function behavior(endpoint, args) {
  if (endpoint === 'config') return SNAPSHOT
  if (endpoint === 'about') return aboutPayload(args && args.check === true)
  if (endpoint === 'configUpdate') {
    const patch = args && args.patch ? args.patch : {}
    return { saved: true, values: Object.assign({}, PRODUCT_VALUES, patch) }
  }
  return {}
}

function sectionProps() {
  return { ctx, t: locale.bind()('settings') }
}

function switchNode(tree, label) {
  return findNodes(tree, (node) => node.type === 'button' && node.props.role === 'switch' && node.props['aria-label'] === label)[0]
}
function buttonByText(tree, text) {
  return findNodes(tree, (node) => node.type === 'button' && textOf(node) === text)[0]
}
function lastCall(calls, endpoint) {
  const matching = calls.filter((entry) => entry.name === 'nudge/' + endpoint)
  return matching[matching.length - 1]
}

// ------------------------------------------------------- render + controls

{
  runtime.reset()
  exportsObject.__test.setPluginConfig({ language: 'auto' }, null)
  const remote = createRemote(behavior)
  ctx.connection = { rpc: { call: remote.call } }
  const props = sectionProps()
  runtime.render(sectionEntry.component, props)
  await flush()
  const view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.sectionGeneral'))
  const text = textOf(view.tree)
  assert(text.includes('settings.sectionGeneral'), 'page renders the General section')
  assert(text.includes('settings.sectionFeatures'), 'page renders the Features section')
  assert(text.includes('settings.sectionContextMenu'), 'page renders the Context menu section')
  assert(text.includes('settings.sectionAbout'), 'page renders the About section')
  assert(text.includes('settings.language'), 'page renders the language row')
  assert(text.includes('settings.featureAnnotate'), 'page renders the annotation switch')
  assert(text.includes('settings.contextMenuLink'), 'page renders the link context-menu switch')
  assert(text.includes('settings.sectionShortcuts'), 'page renders the Keyboard shortcuts section')
  assert(text.includes('settings.hotkeyReset'), 'page renders the hotkey reset action')
  assert(
    text.includes('shortcut.enterAnnotate') && text.includes('shortcut.enterEdit'),
    'page renders the editable mode activation rows',
  )
  assert(
    text.includes('shortcut.exitMode') && text.includes('shortcut.holdSpace'),
    'page renders the fixed Esc / Space rows',
  )
  assert(text.includes('settings.aboutVersion') && text.includes('0.2.0'), 'page renders the plugin version')
  assert(text.includes('abc1234') && text.includes('main'), 'page renders the git branch and commit')
  assert(text.includes('settings.updateUnchecked'), 'page renders the initial update status')
  assert(!text.includes('settings.sourceRoot'), 'legacy source-root field is gone')
  assert(!text.includes('settings.maxScanFiles'), 'legacy scan-limit field is gone')
  const annotateSwitch = switchNode(view.tree, 'settings.featureAnnotate')
  assert(annotateSwitch !== undefined && annotateSwitch.props['aria-checked'] === true, 'feature switch reflects the Host value')
  const languageZh = buttonByText(view.tree, 'settings.languageZh')
  assert(languageZh !== undefined, 'language switch offers 中文')
  const languageGroup = findNodes(view.tree, (node) => node.props && node.props.role === 'group')[0]
  assert(languageGroup !== undefined, 'language options render as one segmented group')
  assert(textOf(languageGroup) === 'settings.languageAutosettings.languageZhsettings.languageEn', 'segmented group carries the three language options')
  const languageButtons = findNodes(languageGroup, (node) => node.type === 'button')
  assert(languageButtons.length === 3, 'segmented group has exactly three segments')
  const pressedLanguage = languageButtons.filter((node) => node.props['aria-pressed'] === true)
  assert(
    pressedLanguage.length === 1 && textOf(pressedLanguage[0]) === 'settings.languageAuto',
    'the stored language is the only pressed segment',
  )
}

// ------------------------------------------------------------- feature save

{
  runtime.reset()
  exportsObject.__test.setPluginConfig({ language: 'auto' }, null)
  const remote = createRemote(behavior)
  ctx.connection = { rpc: { call: remote.call } }
  const props = sectionProps()
  runtime.render(sectionEntry.component, props)
  await flush()
  let view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.featureAnnotate'))
  switchNode(view.tree, 'settings.featureAnnotate').props.onClick()
  view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.saved'))
  assert(textOf(view.tree).includes('settings.saved'), 'switching a feature reports success')
  const updateCall = lastCall(remote.calls, 'configUpdate')
  assert(updateCall !== undefined, 'feature switch calls configUpdate')
  assert(updateCall.args.patch.enableAnnotate === false, 'feature switch writes enableAnnotate=false')
  // The stored value is the single source of truth for the toolbar; the fake
  // harness re-runs effects on every manual render, so assert the store.
  assert(exportsObject.__test.pluginConfigValues().enableAnnotate === false, 'saved switch reaches the Client config store')
}

// ------------------------------------------------------- context-menu save

{
  runtime.reset()
  exportsObject.__test.setPluginConfig({ language: 'auto' }, null)
  const remote = createRemote(behavior)
  ctx.connection = { rpc: { call: remote.call } }
  const props = sectionProps()
  runtime.render(sectionEntry.component, props)
  await flush()
  let view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.contextMenuTab'))
  switchNode(view.tree, 'settings.contextMenuTab').props.onClick()
  view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.saved'))
  const updateCall = lastCall(remote.calls, 'configUpdate')
  assert(updateCall !== undefined && updateCall.args.patch.contextMenuTab === false, 'context-menu switch writes its field')
}

// ---------------------------------------------------------------- language

{
  runtime.reset()
  exportsObject.__test.setPluginConfig({ language: 'auto' }, null)
  const remote = createRemote(behavior)
  ctx.connection = { rpc: { call: remote.call } }
  const props = sectionProps()
  runtime.render(sectionEntry.component, props)
  await flush()
  let view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.languageZh'))
  buttonByText(view.tree, 'settings.languageZh').props.onClick()
  view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('已保存'))
  const updateCall = lastCall(remote.calls, 'configUpdate')
  assert(updateCall !== undefined && updateCall.args.patch.language === 'zh', 'language switch writes language=zh')
  assert(textOf(view.tree).includes('通用'), 'plugin UI switches to Chinese without a reload')
  assert(textOf(view.tree).includes('已保存'), 'saved message uses the selected language')
  exportsObject.__test.setPluginConfig({ language: 'auto' }, null)
}

// ----------------------------------------------------------- restore default

{
  runtime.reset()
  exportsObject.__test.setPluginConfig({ language: 'auto' }, null)
  const remote = createRemote(behavior)
  ctx.connection = { rpc: { call: remote.call } }
  const props = sectionProps()
  runtime.render(sectionEntry.component, props)
  await flush()
  let view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.reset'))
  buttonByText(view.tree, 'settings.reset').props.onClick()
  view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.resetDone'))
  assert(textOf(view.tree).includes('settings.resetDone'), 'restore defaults reports success')
  const updateCall = lastCall(remote.calls, 'configUpdate')
  assert(updateCall !== undefined, 'restore defaults calls configUpdate')
  Object.keys(PRODUCT_DEFAULTS).forEach((key) => {
    assert(updateCall.args.patch[key] === PRODUCT_DEFAULTS[key], 'restore defaults writes ' + key)
  })
}

// ------------------------------------------------------------ update check

{
  runtime.reset()
  exportsObject.__test.setPluginConfig({ language: 'auto' }, null)
  const remote = createRemote(behavior)
  ctx.connection = { rpc: { call: remote.call } }
  const props = sectionProps()
  runtime.render(sectionEntry.component, props)
  await flush()
  let view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.checkUpdate'))
  buttonByText(view.tree, 'settings.checkUpdate').props.onClick()
  view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.updateUnavailable'))
  assert(textOf(view.tree).includes('settings.updateUnavailable'), 'local-link install reports the honest update status')
  const checkedCalls = remote.calls.filter((entry) => entry.name === 'nudge/about' && entry.args && entry.args.check === true)
  assert(checkedCalls.length === 1, 'update check asks the Host with check=true exactly once')
}

// ----------------------------------------------------- one-click update
// The Host caches the startup check, so mounting the page shows the available
// version without a manual "check" call; clicking "Update now" drives the new
// `nudge/update` remote and must cover success and failure.

function updateAvailableAbout() {
  return Object.assign({}, ABOUT, {
    update: { status: 'available', installed: '0.2.0', latest: '0.3.0', versions: ['0.3.0'], registry: 'npm' },
  })
}

{
  runtime.reset()
  exportsObject.__test.setPluginConfig({ language: 'auto' }, null)
  let resolveUpdate = null
  let updateArgs = null
  const remote = createRemote((endpoint, args) => {
    if (endpoint === 'config') return SNAPSHOT
    if (endpoint === 'about') return updateAvailableAbout()
    if (endpoint === 'update') {
      updateArgs = args
      return new Promise((resolvePromise) => {
        resolveUpdate = resolvePromise
      })
    }
    return behavior(endpoint, args)
  })
  ctx.connection = { rpc: { call: remote.call } }
  const props = sectionProps()
  runtime.render(sectionEntry.component, props)
  await flush()
  let view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.updateNow'))
  assert(textOf(view.tree).includes('settings.updateNow'), 'cached startup snapshot renders the Update now button')
  const checkedCalls = remote.calls.filter((entry) => entry.name === 'nudge/about' && entry.args && entry.args.check === true)
  assert(checkedCalls.length === 0, 'mounting the page reads the cached snapshot without re-checking the registry')

  buttonByText(view.tree, 'settings.updateNow').props.onClick()
  view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.updating'))
  assert(textOf(view.tree).includes('settings.updating'), 'clicking Update now enters the updating state')
  assert(textOf(view.tree).includes('settings.updateProgress'), 'the updating state explains what is happening')
  assert(updateArgs !== null && updateArgs.version === '0.3.0', 'Update now asks for the advertised version')

  resolveUpdate({ status: 'restart-required', from: '0.2.0', to: '0.3.0', restart: true })
  view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.updateDone'))
  const doneText = textOf(view.tree)
  assert(doneText.includes('settings.updateDone'), 'a successful update reports the installed version')
  assert(doneText.includes('0.3.0'), 'the success status names the new version')
  assert(doneText.includes('settings.updateRestart'), 'a restart-required update asks for a DSH restart')
  assert(!doneText.includes('settings.updateNow'), 'the primary update button disappears after success')
}

{
  runtime.reset()
  exportsObject.__test.setPluginConfig({ language: 'auto' }, null)
  const remote = createRemote((endpoint, args) => {
    if (endpoint === 'config') return SNAPSHOT
    if (endpoint === 'about') return updateAvailableAbout()
    if (endpoint === 'update') return { status: 'failed', from: '0.2.0', to: '0.3.0', message: 'registry unreachable' }
    return behavior(endpoint, args)
  })
  ctx.connection = { rpc: { call: remote.call } }
  const props = sectionProps()
  runtime.render(sectionEntry.component, props)
  await flush()
  let view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.updateNow'))
  buttonByText(view.tree, 'settings.updateNow').props.onClick()
  view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.updateFailed'))
  const failedText = textOf(view.tree)
  assert(failedText.includes('settings.updateFailed'), 'a failed update uses the generic update-failed status')
  assert(failedText.includes('registry unreachable'), 'a failed update keeps the Host reason')
  assert(!failedText.includes('settings.updateDone'), 'a failed update never claims success')
  assert(failedText.includes('settings.checkUpdate'), 'the manual check button remains available after a failure')
}

// ---------------------------------------------------------------- read-only

{
  runtime.reset()
  exportsObject.__test.setPluginConfig({ language: 'auto' }, null)
  const readOnlySnapshot = Object.assign({}, SNAPSHOT, { writable: false, source: 'loader' })
  const remote = createRemote((endpoint, args) => {
    if (endpoint === 'config') return readOnlySnapshot
    if (endpoint === 'about') return aboutPayload(false)
    return behavior(endpoint, args)
  })
  ctx.connection = { rpc: { call: remote.call } }
  const props = sectionProps()
  runtime.render(sectionEntry.component, props)
  await flush()
  const view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.readOnly'))
  assert(textOf(view.tree).includes('settings.readOnly'), 'page explains the read-only deployment')
  const toggle = switchNode(view.tree, 'settings.featureAnnotate')
  assert(toggle !== undefined && toggle.props.disabled === true, 'read-only deployment disables feature switches')
  assert(remote.calls.every((entry) => entry.name !== 'nudge/configUpdate'), 'read-only page never calls configUpdate')
}

// -------------------------------------------------------------- load error

{
  runtime.reset()
  exportsObject.__test.setPluginConfig({ language: 'auto' }, null)
  const remote = createRemote((endpoint) => (endpoint === 'config' ? { __error: 'profile unavailable' } : aboutPayload(false)))
  ctx.connection = { rpc: { call: remote.call } }
  const props = sectionProps()
  runtime.render(sectionEntry.component, props)
  await flush()
  const view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.loadFailed'))
  assert(textOf(view.tree).includes('settings.loadFailed'), 'page reports a failed config read')
  assert(textOf(view.tree).includes('profile unavailable'), 'page keeps the bridge error message')
}

if (failures > 0) {
  console.error('\n' + failures + ' settings page failure(s)')
  process.exit(1)
}
console.log('\n' + checks + ' settings page checks passed')
