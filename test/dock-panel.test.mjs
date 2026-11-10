/**
 * Dock test: the right-side dock hosts exactly one panel at a time.
 *
 * Renders the bundled `NudgeDock` with the same fake hook runtime used by
 * test/workspace-panel.test.mjs and asserts the state the inspector body relies
 * on: tab switching, a single close action, the resize contract (clamp, keys,
 * double click) and the overlay mode used below 760px (no resizer, Esc closes).
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
function eq(name, actual, expected) {
  if (actual === expected) ok(name + ' (' + JSON.stringify(actual) + ')')
  else {
    failures += 1
    console.error('FAIL - ' + name + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
  }
}

// ------------------------------------------------------------- hook runtime
function sameDeps(left, right) {
  if (left === undefined || right === undefined) return false
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false
  return true
}

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

// ------------------------------------------------------------- document shim
const listeners = new Map()
function fakeStyles() {
  return { cssText: '', setProperty() {}, removeProperty() {}, getPropertyValue() { return '' } }
}
const body = {
  style: fakeStyles(),
  appendChild() {},
  addEventListener() {},
  removeEventListener() {},
}
const document = {
  documentElement: {},
  head: { children: [], appendChild(child) { this.children.push(child) } },
  body,
  getElementById() {
    return null
  },
  createElement(tag) {
    return { tagName: tag, style: fakeStyles(), setAttribute() {}, appendChild() {}, removeChild() {}, addEventListener() {}, removeEventListener() {} }
  },
  addEventListener(type, handler) {
    const list = listeners.get(type) || []
    list.push(handler)
    listeners.set(type, list)
  },
  removeEventListener(type, handler) {
    const list = listeners.get(type) || []
    const index = list.indexOf(handler)
    if (index >= 0) list.splice(index, 1)
    listeners.set(type, list)
  },
}
function dispatch(type, event) {
  for (const handler of (listeners.get(type) || []).slice()) handler(event)
}
globalThis.document = document
globalThis.window = globalThis
const storage = new Map()
globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null
  },
  setItem(key, value) {
    storage.set(key, String(value))
  },
  removeItem(key) {
    storage.delete(key)
  },
}
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true })
globalThis.getComputedStyle = () => ({ getPropertyValue() { return '' } })
globalThis.ResizeObserver = class ResizeObserver {
  constructor(callback) {
    this.callback = callback
  }
  observe() {}
  disconnect() {}
}

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
const exportsObject = loaded.factory((name) => {
  if (name === 'react') return runtime.React
  if (name === 'react/jsx-runtime') return { jsx: runtime.React.createElement, jsxs: runtime.React.createElement, Fragment: 'Fragment' }
  throw new Error('unexpected require: ' + name)
})
const hook = exportsObject.__test
assert(typeof hook.NudgeDock === 'function', 'test hook exposes NudgeDock')
assert(typeof hook.DomTreePanel === 'function', 'test hook exposes DomTreePanel')

// ------------------------------------------------------------------ helpers
const t = (key) => key
const theme = {
  brand: '#0f1115',
  base: '#ffffff',
  layer1: '#ffffff',
  layer2: '#ffffff',
  border: '#0000000a',
  borderStrong: '#0000001f',
  hover: '#2631480f',
  accent: '#4176e6',
  text: '#0f1115',
  muted: '#61666b',
  faint: '#81858c',
  warn: '#f59e0b',
  isDark: false,
}

function findNode(tree, predicate) {
  if (tree === null || tree === undefined) return null
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = findNode(child, predicate)
      if (found) return found
    }
    return null
  }
  if (typeof tree !== 'object') return null
  if (tree.props && predicate(tree)) return tree
  return findNode(tree.children, predicate)
}
function findNodes(tree, predicate, out = []) {
  if (tree === null || tree === undefined) return out
  if (Array.isArray(tree)) {
    for (const child of tree) findNodes(child, predicate, out)
    return out
  }
  if (typeof tree !== 'object') return out
  if (tree.props && predicate(tree)) out.push(tree)
  findNodes(tree.children, predicate, out)
  return out
}

// ------------------------------------------------------------ width helper
eq('clamp below the floor', hook.clampDockWidth(100), hook.NUDGE_DOCK_MIN_WIDTH)
eq('clamp above the cap', hook.clampDockWidth(1000), hook.NUDGE_DOCK_MAX_WIDTH)
eq('clamp keeps the default for NaN', hook.clampDockWidth(Number.NaN), hook.NUDGE_DOCK_DEFAULT_WIDTH)
eq('clamp rounds numeric strings', hook.clampDockWidth('312'), 312)
eq('no stored width falls back to the default', hook.readDockWidth(), hook.NUDGE_DOCK_DEFAULT_WIDTH)
hook.writeDockWidth(500)
eq('stored width is clamped before writing', storage.get('dsh.nudge.dockWidth'), String(hook.NUDGE_DOCK_MAX_WIDTH))
storage.set('dsh.nudge.dockWidth', '365')
eq('stored width is read back', hook.readDockWidth(), 365)
storage.set('dsh.nudge.dockWidth', 'garbage')
eq('a broken stored width falls back to the default', hook.readDockWidth(), hook.NUDGE_DOCK_DEFAULT_WIDTH)
hook.writeDockWidth(300)

// ------------------------------------------------------------- docked mode
function dockProps(overrides) {
  return Object.assign(
    {
      t,
      theme,
      active: 'dom',
      docked: true,
      width: 300,
      overlayWidth: 320,
      showDom: true,
      showWorkspace: true,
      onTab() {},
      onClose() {},
      onResize() {},
      onResizeEnd() {},
      onRefresh() {},
    },
    overrides,
  )
}
runtime.reset()
const docked = runtime.render(hook.NudgeDock, dockProps({ children: [] }))
const dockRoot = findNode(docked.tree, (node) => node.props['data-dsh-nudge-dock'] !== undefined)
assert(dockRoot !== null, 'dock renders its root contract attribute')
eq('docked mode is declared on the root', dockRoot.props['data-dock-mode'], 'docked')
const tabs = findNodes(docked.tree, (node) => node.props['data-dock-tab'] !== undefined)
eq('two panel tabs render', tabs.length, 2)
eq('DOM tab is selected first', tabs[0].props['aria-selected'], true)
eq('workspace tab is inactive first', tabs[1].props['aria-selected'], false)
const resizer = findNode(docked.tree, (node) => node.props['data-dock-resizer'] !== undefined)
assert(resizer !== null, 'docked mode renders the resize separator')
eq('separator reports its value', resizer.props['aria-valuenow'], 300)
assert(
  findNode(docked.tree, (node) => node.props['aria-label'] === 'dock.close') !== null,
  'dock header owns the single close action',
)
assert(
  findNode(docked.tree, (node) => node.props['aria-label'] === 'workspace.refresh') === null,
  'the refresh action is not shown on the DOM tab',
)

// tab switching and close delegate to the body
let switched = null
let closed = 0
runtime.reset()
const tabsView = runtime.render(
  hook.NudgeDock,
  dockProps({
    children: [],
    onTab(next) {
      switched = next
    },
    onClose() {
      closed += 1
    },
  }),
)
const workspaceTab = findNodes(tabsView.tree, (node) => node.props['data-dock-tab'] === 'workspace')[0]
workspaceTab.props.onClick()
eq('clicking the workspace tab asks the body to switch', switched, 'workspace')
findNodes(tabsView.tree, (node) => node.props['aria-label'] === 'dock.close')[0].props.onClick()
eq('close asks the body to close the dock', closed, 1)

// workspace tab exposes the header refresh borrowed from the panel
let refreshed = 0
runtime.reset()
const workspaceView = runtime.render(
  hook.NudgeDock,
  dockProps({
    active: 'workspace',
    children: [],
    onRefresh() {
      refreshed += 1
    },
  }),
)
const refreshButton = findNode(workspaceView.tree, (node) => node.props['aria-label'] === 'workspace.refresh')
assert(refreshButton !== null, 'workspace tab shows the refresh action in the dock header')
refreshButton.props.onClick()
eq('refresh delegates to the workspace panel action', refreshed, 1)

// resize contract: arrow keys, Home and double click
const resized = []
runtime.reset()
const resizeView = runtime.render(
  hook.NudgeDock,
  dockProps({
    width: 300,
    children: [],
    onResize(next) {
      resized.push(['live', next])
    },
    onResizeEnd(next) {
      resized.push(['end', next])
    },
  }),
)
const separator = findNode(resizeView.tree, (node) => node.props['data-dock-resizer'] !== undefined)
separator.props.onKeyDown({ key: 'ArrowLeft', preventDefault() {} })
separator.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} })
separator.props.onKeyDown({ key: 'Home', preventDefault() {} })
separator.props.onDoubleClick()
eq('arrow left widens the dock by one step', resized[1][1], 316)
eq('arrow right narrows the dock by one step', resized[3][1], 284)
eq('Home and double click restore the default width', resized[5][1], hook.NUDGE_DOCK_DEFAULT_WIDTH)
assert(resized.length >= 8, 'every resize commits through the same contract')

// ------------------------------------------------------------- overlay mode
listeners.clear()
let overlayClosed = 0
runtime.reset()
const overlay = runtime.render(
  hook.NudgeDock,
  dockProps({
    docked: false,
    width: 300,
    overlayWidth: 332,
    children: [],
    onClose() {
      overlayClosed += 1
    },
  }),
)
const overlayRoot = findNode(overlay.tree, (node) => node.props['data-dsh-nudge-dock'] !== undefined)
eq('narrow panes switch the dock to overlay', overlayRoot.props['data-dock-mode'], 'overlay')
assert(
  findNode(overlay.tree, (node) => node.props['data-dock-resizer'] !== undefined) === null,
  'overlay mode has no resize separator',
)
eq('overlay uses the clamped overlay width', overlayRoot.props.style.width, 332)
dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} })
eq('Escape closes the overlay', overlayClosed, 1)
for (const dispose of overlay.disposers) dispose()
dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} })
eq('the Escape listener is released with the dock', overlayClosed, 1)

// --------------------------------------------------- embedded DOM tree panel
const carrier = {
  domChildren() {
    return Promise.resolve([])
  },
  focusDomPath() {
    return Promise.resolve()
  },
}
runtime.reset()
const treeView = runtime.render(hook.DomTreePanel, {
  t,
  theme,
  carrier,
  selection: null,
  embedded: true,
  onClose() {},
})
const treeRoot = findNode(treeView.tree, (node) => node.props['data-dsh-nudge-dom-panel'] !== undefined)
assert(treeRoot !== null, 'embedded DOM tree keeps its panel contract')
eq('embedded DOM tree fills the dock width', treeRoot.props.style.width, '100%')
eq('embedded DOM tree drops its own border', treeRoot.props.style.borderLeft, 'none')
assert(
  findNode(treeView.tree, (node) => node.props['aria-label'] === 'dom.close') === null,
  'embedded DOM tree hides its own close button (the dock owns it)',
)

console.log('\n' + checks + ' checks / ' + failures + ' failures')
if (failures > 0) process.exit(1)
