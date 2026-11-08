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

const SNAPSHOT = {
  values: { sourceRoot: '', urlRoot: 'http://127.0.0.1:4173', maxScanFiles: 100, maxFileBytes: 2000000 },
  defaults: { sourceRoot: '', urlRoot: '', maxScanFiles: 400, maxFileBytes: 2000000 },
  overridden: ['urlRoot', 'maxScanFiles'],
  writable: true,
  source: 'profile',
}

// ------------------------------------------------------------- render helpers

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

function fieldInput(tree, label) {
  return findNodes(tree, (node) => node.type === 'input' && node.props['aria-label'] === label)[0]
}

async function settle(component, props, runtimeRef, until) {
  let rendered = runtimeRef.render(component, props)
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await flush()
    if (until(rendered.tree)) return rendered
    rendered = runtimeRef.render(component, props)
  }
  return rendered
}

// ------------------------------------------------------------- read → save

{
  runtime.reset()
  const remote = createRemote((endpoint) => (endpoint === 'config' ? SNAPSHOT : { saved: false, values: SNAPSHOT.values }))
  ctx.connection = { rpc: { call: remote.call } }
  const props = { ctx, t: locale.bind()('settings') }
  runtime.render(sectionEntry.component, props)
  await flush()
  const loadedView = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.sourceRoot'))
  const loadedText = textOf(loadedView.tree)
  assert(loadedText.includes('settings.title'), 'page renders its title')
  assert(loadedText.includes('settings.sourceRoot'), 'page renders the source-root field')
  assert(loadedText.includes('settings.urlRoot'), 'page renders the url-root field')
  assert(loadedText.includes('settings.maxScanFiles'), 'page renders the scan-limit field')
  assert(loadedText.includes('settings.maxFileBytes'), 'page renders the file-size field')
  assert(loadedText.includes('settings.overridden'), 'page marks the overridden fields')
  const scanInput = fieldInput(loadedView.tree, 'settings.maxScanFiles')
  assert(scanInput !== undefined && scanInput.props.value === '100', 'page seeds the field from the Host snapshot')
  assert(scanInput.props.disabled === false, 'page keeps the field editable when writing is allowed')

  scanInput.props.onChange({ target: { value: '250' } })
  const edited = await settle(sectionEntry.component, props, runtime, (tree) => {
    const input = fieldInput(tree, 'settings.maxScanFiles')
    return input !== undefined && input.props.value === '250'
  })
  assert(fieldInput(edited.tree, 'settings.maxScanFiles').props.value === '250', 'edit updates the staged draft')

  const saveButton = findNodes(edited.tree, (node) => node.type === 'button' && textOf(node) === 'settings.save')[0]
  assert(saveButton !== undefined, 'page renders the save button')
  saveButton.props.onClick()
  const savedView = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.saved'))
  assert(textOf(savedView.tree).includes('settings.saved'), 'save reports success')
  const updateCall = remote.calls.find((entry) => entry.name === 'nudge/configUpdate')
  assert(updateCall !== undefined, 'save calls the Host configUpdate endpoint')
  assert(updateCall.args.patch.maxScanFiles === 250, 'save writes the edited field')
  assert(!Object.prototype.hasOwnProperty.call(updateCall.args.patch, 'urlRoot'), 'save leaves untouched fields out of the patch')
}

// ------------------------------------------------------------- read-only

{
  runtime.reset()
  const readOnlySnapshot = { ...SNAPSHOT, writable: false, source: 'loader' }
  const remote = createRemote(() => readOnlySnapshot)
  ctx.connection = { rpc: { call: remote.call } }
  const props = { ctx, t: locale.bind()('settings') }
  runtime.render(sectionEntry.component, props)
  await flush()
  const view = await settle(sectionEntry.component, props, runtime, (tree) => textOf(tree).includes('settings.readOnly'))
  assert(textOf(view.tree).includes('settings.readOnly'), 'page explains the read-only deployment')
  const input = fieldInput(view.tree, 'settings.sourceRoot')
  assert(input.props.disabled === true, 'read-only deployment disables the fields')
  const saveButton = findNodes(view.tree, (node) => node.type === 'button' && textOf(node) === 'settings.save')[0]
  assert(saveButton.props.disabled === true, 'read-only deployment disables the save button')
  assert(remote.calls.every((entry) => entry.name === 'nudge/config'), 'read-only page never calls configUpdate')
}

if (failures > 0) {
  console.error('\n' + failures + ' settings page failure(s)')
  process.exit(1)
}
console.log('\n' + checks + ' settings page checks passed')
