/**
 * Floating-composer test: exercises the DOM-side fullscreen adapter with a
 * hand-rolled element/document shim, then pins the pure eligibility gate.
 *
 * The adapter intentionally depends on semantic host markers
 * (`data-rightbar-fullscreen`, `data-sidebar-right-panel`,
 * `data-rightbar-col`, `data-conversation-session`, `data-composer-seat`), not
 * on hashed CSS classes, so a small DOM double is enough to prove:
 *
 *   - only a fullscreen, visible, docked Nudge presentation marks the chat;
 *   - another plugin already floating the chat makes Nudge stand down;
 *   - the surface starts compact, expands on interaction, collapses on an
 *     outside pointer press, and restores the untouched layout on exit.
 *
 * Engineering test only. The live shell render is exercised in the running
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

// --------------------------------------------------------------- DOM double

const ATTR_PART = /\[([\w-]+)(?:="([^"]*)")?\]/g

/** Match one compound selector: optional tag, then attribute predicates. */
function matchesCompound(element, selector) {
  const source = selector.trim()
  if (source === '') return false
  const tag = /^([a-zA-Z][\w-]*)/.exec(source)
  if (tag !== null && element.tagName !== tag[1].toUpperCase()) return false
  let rest = tag !== null ? source.slice(tag[0].length) : source
  ATTR_PART.lastIndex = 0
  let consumed = 0
  let match
  while ((match = ATTR_PART.exec(rest)) !== null) {
    consumed += match[0].length
    if (!element.hasAttribute(match[1])) return false
    if (match[2] !== undefined && element.getAttribute(match[1]) !== match[2]) return false
  }
  return consumed === rest.length
}

function matchesSelector(element, selector) {
  return selector.split(',').some((part) => matchesCompound(element, part))
}

function fakeStyle() {
  const values = new Map()
  return {
    setProperty(name, value) {
      values.set(name, String(value))
    },
    getPropertyValue(name) {
      return values.get(name) ?? ''
    },
    removeProperty(name) {
      values.delete(name)
    },
  }
}

class FakeElement {
  constructor(tag, attributes) {
    this.tagName = tag.toUpperCase()
    this.attrs = Object.assign({}, attributes)
    this.children = []
    this.parent = null
    this.style = fakeStyle()
    this.rectHeight = 0
    this.listeners = new Map()
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value)
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
  }
  removeAttribute(name) {
    delete this.attrs[name]
  }
  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name)
  }
  appendChild(child) {
    child.parent = this
    this.children.push(child)
    return child
  }
  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) {
      this.children.splice(index, 1)
      child.parent = null
    }
    return child
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(handler)
  }
  removeEventListener(type, handler) {
    if (this.listeners.has(type)) this.listeners.get(type).delete(handler)
  }
  fire(type, event) {
    const handlers = this.listeners.get(type)
    if (handlers === undefined) return
    for (const handler of handlers) handler(Object.assign({ target: this }, event))
  }
  get parentNode() {
    return this.parent
  }
  get previousElementSibling() {
    if (this.parent === null) return null
    const index = this.parent.children.indexOf(this)
    return index > 0 ? this.parent.children[index - 1] : null
  }
  matches(selector) {
    return matchesSelector(this, selector)
  }
  querySelectorAll(selector) {
    const found = []
    const walk = (node) => {
      for (const child of node.children) {
        if (matchesSelector(child, selector)) found.push(child)
        walk(child)
      }
    }
    walk(this)
    return found
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }
  closest(selector) {
    let node = this
    while (node !== null && node !== undefined) {
      if (typeof node.matches === 'function' && node.matches(selector)) return node
      node = node.parent
    }
    return null
  }
  contains(node) {
    let current = node
    while (current !== null && current !== undefined) {
      if (current === this) return true
      current = current.parent
    }
    return false
  }
  getClientRects() {
    return [{ width: 0, height: this.rectHeight }]
  }
  getBoundingClientRect() {
    return { width: 420, height: this.rectHeight, top: 0, left: 0, right: 420, bottom: this.rectHeight }
  }
}

class FakeWindow {
  constructor() {
    this.frames = []
    this.nextId = 1
    this.listeners = new Map()
    const store = new Map()
    this.localStorage = {
      getItem(key) {
        return store.has(key) ? store.get(key) : null
      },
      setItem(key, value) {
        store.set(key, String(value))
      },
    }
  }
  requestAnimationFrame(callback) {
    const id = this.nextId
    this.nextId += 1
    this.frames.push({ id, callback })
    return id
  }
  cancelAnimationFrame(id) {
    this.frames = this.frames.filter((frame) => frame.id !== id)
  }
  setTimeout(callback) {
    return this.requestAnimationFrame(callback)
  }
  clearTimeout(id) {
    this.cancelAnimationFrame(id)
  }
  /** Controllable prefers-color-scheme double (one query per window). */
  matchMedia(query) {
    if (this.mediaQuery) return this.mediaQuery
    const listeners = new Set()
    const media = {
      media: query,
      matches: false,
      addEventListener(type, handler) {
        if (type === 'change') listeners.add(handler)
      },
      removeEventListener(type, handler) {
        if (type === 'change') listeners.delete(handler)
      },
      addListener(handler) {
        listeners.add(handler)
      },
      removeListener(handler) {
        listeners.delete(handler)
      },
      setMatches(value) {
        media.matches = value === true
        for (const handler of Array.from(listeners)) handler({ matches: media.matches })
      },
      listenerCount() {
        return listeners.size
      },
    }
    this.mediaQuery = media
    return media
  }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(handler)
  }
  removeEventListener(type, handler) {
    if (this.listeners.has(type)) this.listeners.get(type).delete(handler)
  }
  flush() {
    const frames = this.frames
    this.frames = []
    for (const frame of frames) frame.callback()
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super('#document', {})
    this.defaultView = new FakeWindow()
    this.documentElement = this
    this.body = new FakeElement('body', {})
    this.appendChild(this.body)
    this.activeElement = null
    this.handlers = new Map()
    this.window = this.defaultView
  }
  createElement(tag, attributes) {
    return new FakeElement(tag, attributes)
  }
  createElementNS(namespace, tag, attributes) {
    const element = new FakeElement(tag, attributes)
    element.namespaceUri = namespace
    return element
  }
  addEventListener(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, [])
    this.handlers.get(type).push(handler)
  }
  removeEventListener(type, handler) {
    const list = this.handlers.get(type)
    if (list === undefined) return
    this.handlers.set(
      type,
      list.filter((entry) => entry !== handler),
    )
  }
  dispatch(type, event) {
    const list = this.handlers.get(type) ?? []
    for (const handler of list) handler(event)
  }
}

// ------------------------------------------------------------ fixture build

/** Build the minimal shell the adapter reads: frame > center column + panel. */
function buildSurface() {
  const doc = new FakeDocument()
  const frame = new FakeElement('div', { 'data-rightbar-fullscreen': '' })
  const center = new FakeElement('div', { class: 'center' })
  const rightbar = new FakeElement('div', { 'data-rightbar-col': '' })
  const panel = new FakeElement('div', {
    'data-sidebar-right-panel': 'fullscreen',
    'data-sidebar-right-open': '',
  })
  const sessionHost = new FakeElement('div', { 'data-sidebar-right-session': 'session-1' })
  sessionHost.appendChild(panel)
  rightbar.appendChild(sessionHost)
  const content = new FakeElement('div', { 'data-conversation-session': 'session-1' })
  const scroll = new FakeElement('div', { 'data-conversation-scroll': '' })
  const seat = new FakeElement('div', { 'data-composer-seat': '' })
  seat.rectHeight = 48
  const input = new FakeElement('textarea', { 'data-composer-input': '' })
  input.value = ''
  seat.appendChild(input)
  scroll.appendChild(seat)
  content.appendChild(scroll)
  center.appendChild(content)
  frame.appendChild(center)
  frame.appendChild(rightbar)
  doc.body.appendChild(frame)
  return { doc, frame, center, content, seat, input, panel, rightbar }
}

// -------------------------------------------------------------- bundle load

const head = { children: [], appendChild(child) { this.children.push(child) } }
globalThis.document = { documentElement: {}, head, body: { appendChild() {} }, getElementById() { return null } }
globalThis.window = globalThis
globalThis.localStorage = { getItem() { return null }, setItem() {} }
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true })
globalThis.getComputedStyle = () => ({ getPropertyValue() { return '' } })

const React = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children }
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
  createContext(value) { return { Provider: 'Provider', Consumer: 'Consumer', _currentValue: value } },
  forwardRef(render) { return render },
  createRef() { return { current: null } },
  useContext(context) { return context && context._currentValue },
  useReducer(_reducer, initial) { return [initial, () => {}] },
  useImperativeHandle() {},
  useInsertionEffect() {},
}

let loaded = null
globalThis.__ModuleLoader__ = { load(definition) { loaded = definition } }
const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
runInThisContext(source, { filename: 'lib/client.js' })
const test = loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
}).__test

const { floatingComposerEligible, installFloatingComposer, setFloatingComposerRequest, setFloatingComposerAnnotating, setFloatingComposerLabels, subscribeFloatingComposerInset, floatingComposerInset, setFloatingAnnotationBarHandlers, setFloatingAnnotationBarState } = test

// ------------------------------------------------------- pure eligibility

const baseState = {
  fullscreen: true,
  panelOpen: true,
  tabVisible: true,
  docked: true,
  configEnabled: true,
  foreignFloating: false,
  chatPresent: true,
}
assert(typeof floatingComposerEligible === 'function', 'eligibility gate is bundled')
assert(floatingComposerEligible(baseState) === true, 'a docked fullscreen Nudge tab is eligible')
for (const key of ['fullscreen', 'panelOpen', 'tabVisible', 'docked', 'configEnabled', 'chatPresent']) {
  const state = Object.assign({}, baseState, { [key]: false })
  assert(floatingComposerEligible(state) === false, 'eligibility rejects ' + key + ' === false')
}
assert(
  floatingComposerEligible(Object.assign({}, baseState, { foreignFloating: true })) === false,
  'eligibility stands down while another plugin floats the chat',
)

// ------------------------------------------------- adapter behavior (DOM)

{
  const surface = buildSurface()
  const install = installFloatingComposer(surface.doc)
  assert(typeof install === 'function', 'installer returns a disposer')
  const insets = []
  const unsubscribeInset = subscribeFloatingComposerInset((value) => insets.push(value))
  assert(typeof unsubscribeInset === 'function', 'the page-inset subscription returns a disposer')
  assert(floatingComposerInset() === 0, 'no reserved strip before the dock mounts')

  setFloatingComposerRequest('tab-a', 'session-1', true)
  surface.doc.defaultView.flush()
  assert(surface.center.hasAttribute('data-dsh-nudge-floating-chat'), 'fullscreen marks the conversation column')
  assert(surface.center.getAttribute('data-dsh-nudge-float-mode') === 'compact', 'the surface starts as the bottom composer dock')
  assert(
    surface.center.style.getPropertyValue('--dsh-nudge-float-compact-height') === '62px',
    'compact height follows the measured composer seat plus the top breathing gap',
  )
  assert(floatingComposerInset() === 62, 'the compact dock publishes its height as the page safe area')
  assert(insets[insets.length - 1] === 62, 'subscribers receive the published page safe area')
  assert(surface.center.querySelector('[data-dsh-nudge-float-bar]') === null, 'no floating-window header row is added')
  assert(!surface.content.hasAttribute('data-dsh-nudge-floating-chat'), 'only the column is marked, not the content')

  // Host annotate bar: fullscreen puts the page under the dock, so the dock
  // renders a draggable twin bar above every layer and forwards actions.
  const annotBar = surface.doc.body.querySelector('[data-dsh-nudge-float-annotbar]')
  assert(annotBar !== null, 'the host renders an annotate bar for the floating dock')
  assert(annotBar.style.display === 'none', 'the host annotate bar starts hidden')
  const barActions = []
  setFloatingAnnotationBarHandlers({
    send: () => barActions.push('send'),
    exit: () => barActions.push('exit'),
    discard: () => barActions.push('discard'),
    locate: () => barActions.push('locate'),
    toggleMarkers: () => barActions.push('markers'),
  })
  setFloatingAnnotationBarState({
    visible: true,
    count: 2,
    markersHidden: false,
    labels: {
      annotating: '正在批注',
      send: '发送',
      exit: '退出批注',
      locate: '定位最新批注',
      hideMarkers: '隐藏标记',
      showMarkers: '显示标记',
      discard: '丢弃批注',
      discardArmed: '再次点击丢弃全部批注',
      moveToolbar: '移动工具栏',
    },
  })
  assert(annotBar.style.display === 'flex', 'the host annotate bar follows the visible state')
  assert(annotBar.querySelector('[data-annotbar-count]').textContent === '正在批注 · 2', 'the host bar mirrors the annotation count')
  assert(annotBar.querySelector('[data-annotbar-send]').getAttribute('aria-disabled') === 'false', 'the host send button enables with pending annotations')
  assert(annotBar.style.left !== '' && annotBar.style.top !== '', 'the host bar receives a default position above the dock')
  assert(annotBar.style.height === '48px' && annotBar.style.borderRadius === '14px', 'the host bar mirrors the page bar geometry (48px pill / 14px radius)')
  assert(annotBar.querySelector('[data-annotbar-grip]') !== null && annotBar.querySelector('[data-annotbar-locate]') !== null && annotBar.querySelector('[data-annotbar-markers]') !== null && annotBar.querySelector('[data-annotbar-discard]') !== null && annotBar.querySelector('[data-annotbar-exit]') !== null, 'the host bar keeps the page bar button set')
  const barLeftBefore = annotBar.style.left
  const barTopBefore = annotBar.style.top
  annotBar.querySelector('[data-annotbar-grip]').fire('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 })
  surface.doc.dispatch('pointermove', { clientX: 170, clientY: 160 })
  surface.doc.dispatch('pointerup', {})
  assert(annotBar.style.left !== barLeftBefore || annotBar.style.top !== barTopBefore, 'the host bar can be dragged across the whole container')
  annotBar.querySelector('[data-annotbar-send]').fire('click', {})
  annotBar.querySelector('[data-annotbar-locate]').fire('click', {})
  annotBar.querySelector('[data-annotbar-markers]').fire('click', {})
  annotBar.querySelector('[data-annotbar-exit]').fire('click', {})
  assert(barActions.join(',') === 'send,locate,markers,exit', 'host bar buttons forward the page actions')
  annotBar.querySelector('[data-annotbar-discard]').fire('click', {})
  assert(barActions.indexOf('discard') === -1, 'the first discard press only arms the action')
  assert(annotBar.querySelector('[data-annotbar-discard]').hasAttribute('data-armed'), 'the armed discard state is reflected on the host bar')
  annotBar.querySelector('[data-annotbar-discard]').fire('click', {})
  assert(barActions[barActions.length - 1] === 'discard', 'the second discard press forwards the discard')
  setFloatingAnnotationBarState({ visible: false, count: 0, markersHidden: false })
  assert(annotBar.style.display === 'none', 'the host annotate bar hides outside annotate mode')
  setFloatingAnnotationBarHandlers(null)

  const collapseButton = surface.doc.body.querySelector('[data-dsh-nudge-float-collapse]')
  const shrinkButton = surface.doc.body.querySelector('[data-dsh-nudge-float-shrink]')
  const floatButton = surface.doc.body.querySelector('[data-dsh-nudge-float-button]')
  assert(collapseButton !== null, 'the dock carries a collapse-messages control')
  assert(shrinkButton !== null, 'the dock carries a separate shrink-to-floating-button control')
  assert(floatButton !== null, 'a floating restore button is mounted')
  assert(collapseButton !== shrinkButton && collapseButton !== floatButton, 'the three controls are distinct buttons')
  assert(
    collapseButton.hidden === true && shrinkButton.hidden === false && floatButton.hidden === true,
    'the compact input shows only the shrink control (nothing to collapse)',
  )
  assert(shrinkButton.style.top === 'auto' && String(shrinkButton.style.bottom || '') !== '', 'the compact shrink control floats above the input bar')
  assert(surface.panel.style.getPropertyValue('bottom') === '', 'compact browsing leaves the page full height')
  setFloatingComposerLabels({ collapse: '收起消息区', shrink: '收缩为悬浮按钮', expand: '展开对话' })
  assert(collapseButton.getAttribute('aria-label') === '收起消息区', 'localised labels reach the collapse control')
  assert(shrinkButton.getAttribute('aria-label') === '收缩为悬浮按钮', 'localised labels reach the shrink control')
  assert(floatButton.getAttribute('aria-label') === '展开对话', 'localised labels reach the floating button')

  surface.doc.dispatch('pointerdown', { target: surface.seat })
  assert(surface.center.getAttribute('data-dsh-nudge-float-mode') === 'expanded', 'pressing the composer opens the messages')
  assert(
    collapseButton.hidden === false && shrinkButton.hidden === false && floatButton.hidden === true,
    'the expanded dock shows the collapse and shrink controls side by side',
  )
  assert(collapseButton.style.bottom === 'auto' && String(collapseButton.style.top || '') !== '', 'the expanded collapse control sits inside the dock corner')
  const collapseRight = Number(String(collapseButton.style.right || '').replace('px', '')) || 0
  const shrinkRight = Number(String(shrinkButton.style.right || '').replace('px', '')) || 0
  assert(
    shrinkRight === collapseRight + 26 + 6,
    'the two expanded controls are separate buttons, not one merged control',
    'collapse right=' + collapseRight + ' shrink right=' + shrinkRight,
  )

  // Annotate mode starts compact, but the composer still expands: focusing the
  // input opens the history, and the page panel never shrinks.
  setFloatingComposerAnnotating('tab-a', true)
  assert(surface.center.hasAttribute('data-dsh-nudge-float-annotate'), 'annotate mode marks the dock')
  assert(surface.center.getAttribute('data-dsh-nudge-float-mode') === 'compact', 'annotate mode starts collapsed')
  assert(surface.panel.style.getPropertyValue('bottom') === '', 'annotate mode keeps the page full height (page fills the bottom)')
  assert(floatingComposerInset() === 62, 'annotate mode keeps publishing the dock height to the page')
  // Focus (not just pointerdown) on the composer opens the history in annotate
  // mode — this is the regression the field report is about.
  surface.doc.dispatch('focusin', { target: surface.input })
  assert(surface.center.getAttribute('data-dsh-nudge-float-mode') === 'expanded', 'focusing the composer opens the messages in annotate mode')
  assert(floatingComposerInset() === 0, 'the expanded annotate dock reserves nothing')
  setFloatingComposerAnnotating('tab-other', true)
  setFloatingComposerAnnotating('tab-a', false)
  assert(surface.panel.style.getPropertyValue('bottom') === '', 'another annotating tab never shrinks the page either')
  setFloatingComposerAnnotating('tab-other', false)

  surface.doc.dispatch('pointerdown', { target: surface.seat })
  assert(surface.center.getAttribute('data-dsh-nudge-float-mode') === 'expanded', 'the composer opens the messages again after annotating')
  assert(floatingComposerInset() === 0, 'an expanded dock no longer reserves the bottom strip')
  collapseButton.fire('click', {})
  assert(
    surface.center.getAttribute('data-dsh-nudge-float-mode') === 'compact',
    'the collapse control puts the messages away and keeps the input bar',
  )
  assert(floatingComposerInset() === 62, 'the collapsed dock publishes its height as the page safe area again')
  assert(
    collapseButton.hidden === true && shrinkButton.hidden === false && floatButton.hidden === true,
    'only the shrink control remains above the collapsed input bar',
  )
  surface.doc.dispatch('pointerdown', { target: surface.seat })
  assert(surface.center.getAttribute('data-dsh-nudge-float-mode') === 'expanded', 'pressing the composer opens the messages again')
  shrinkButton.fire('click', {})
  assert(surface.center.getAttribute('data-dsh-nudge-float-mode') === 'hidden', 'the shrink control collapses the dock to the floating button')
  assert(floatingComposerInset() === 0, 'a hidden dock reserves nothing')
  assert(
    collapseButton.hidden === true && shrinkButton.hidden === true && floatButton.hidden === false,
    'the floating button replaces the dock',
  )
  floatButton.fire('click', {})
  assert(surface.center.getAttribute('data-dsh-nudge-float-mode') === 'expanded', 'the floating button restores the messages')
  assert(
    collapseButton.hidden === false && shrinkButton.hidden === false,
    'both dock controls return with the messages',
  )

  // The page is an Electron guest / iframe: pointer events never reach this
  // document, but focus moving into it does.
  const pageWrapper = new FakeElement('div', { 'data-dsh-nudge-webview': '' })
  const guest = new FakeElement('webview', {})
  pageWrapper.appendChild(guest)
  surface.panel.appendChild(pageWrapper)
  surface.doc.dispatch('focusin', { target: guest })
  assert(surface.center.getAttribute('data-dsh-nudge-float-mode') === 'compact', 'focus entering the embedded page collapses the messages')

  surface.doc.dispatch('pointerdown', { target: surface.seat })
  assert(surface.center.getAttribute('data-dsh-nudge-float-mode') === 'expanded', 'pressing the composer opens the messages again')

  const outside = new FakeElement('div', {})
  surface.doc.body.appendChild(outside)
  surface.doc.dispatch('pointerdown', { target: outside })
  assert(surface.center.getAttribute('data-dsh-nudge-float-mode') === 'compact', 'an outside press collapses the messages')

  setFloatingComposerRequest('tab-a', 'session-1', false)
  surface.doc.defaultView.flush()
  assert(!surface.center.hasAttribute('data-dsh-nudge-floating-chat'), 'leaving fullscreen restores the column')
  assert(!surface.center.hasAttribute('data-dsh-nudge-float-mode'), 'leaving fullscreen removes the mode marker')
  assert(surface.center.style.getPropertyValue('--dsh-nudge-float-compact-height') === '', 'leaving fullscreen clears the height variable')
  assert(surface.doc.body.querySelector('[data-dsh-nudge-float-collapse]') === null, 'leaving fullscreen removes the collapse control')
  assert(surface.doc.body.querySelector('[data-dsh-nudge-float-shrink]') === null, 'leaving fullscreen removes the shrink control')
  assert(surface.doc.body.querySelector('[data-dsh-nudge-float-annotbar]') === null, 'leaving fullscreen removes the host annotate bar')
  assert(floatingComposerInset() === 0, 'leaving fullscreen clears the published page safe area')
  unsubscribeInset()
  install()
}

// A hidden Nudge tab publishing its own state must not clear a visible tab's
// request for the same Session.
{
  const surface = buildSurface()
  const install = installFloatingComposer(surface.doc)
  setFloatingComposerRequest('tab-visible', 'session-1', true)
  setFloatingComposerRequest('tab-hidden', 'session-1', false)
  surface.doc.defaultView.flush()
  assert(
    surface.center.hasAttribute('data-dsh-nudge-floating-chat'),
    'one tab hiding keeps another tab\'s fullscreen request',
  )
  setFloatingComposerRequest('tab-visible', 'session-1', false)
  surface.doc.defaultView.flush()
  assert(!surface.center.hasAttribute('data-dsh-nudge-floating-chat'), 'the last active tab withdrawing restores the column')
  install()
}

// Another plugin already floating the chat wins.
{
  const surface = buildSurface()
  const foreign = new FakeElement('div', { 'data-dsh-floating-chat': '' })
  surface.doc.body.appendChild(foreign)
  const install = installFloatingComposer(surface.doc)
  setFloatingComposerRequest('tab-a', 'session-1', true)
  surface.doc.defaultView.flush()
  assert(!surface.center.hasAttribute('data-dsh-nudge-floating-chat'), 'foreign floating chat makes Nudge stand down')
  setFloatingComposerRequest('tab-a', 'session-1', false)
  install()
}

// A mismatched Session must not mark an unrelated conversation.
{
  const surface = buildSurface()
  const install = installFloatingComposer(surface.doc)
  setFloatingComposerRequest('tab-a', 'session-2', true)
  surface.doc.defaultView.flush()
  assert(!surface.center.hasAttribute('data-dsh-nudge-floating-chat'), 'a different Session leaves the column alone')
  setFloatingComposerRequest('tab-a', 'session-2', false)
  install()
}


// --------------------------------------------- annotation bar palette regression
// Field report: the host clone of the annotate bar showed an invisible hovered
// glyph (SVG built in the wrong namespace), a washed-out disabled send button
// (whole-button opacity 0.45) and never followed the dark theme. These checks pin
// the palette tokens, the SVG namespace and the OS-preference fallback.
{
  const surface = buildSurface()
  const install = installFloatingComposer(surface.doc)
  const media = surface.doc.defaultView.matchMedia('(prefers-color-scheme: dark)')
  setFloatingComposerRequest('tab-palette', 'session-1', true)
  surface.doc.defaultView.flush()
  const bar = surface.doc.body.querySelector('[data-dsh-nudge-float-annotbar]')
  assert(bar !== null, 'palette: the host annotate bar mounts')
  const locate = bar.querySelector('[data-annotbar-locate]')
  const send = bar.querySelector('[data-annotbar-send]')
  const locateIcon = locate !== null ? locate.children[0] : null
  assert(locateIcon !== null && locateIcon.namespaceUri === 'http://www.w3.org/2000/svg', 'palette: bar glyph uses the real SVG namespace')
  assert(locateIcon !== null && locateIcon.style.display === 'block', 'palette: bar glyph is block-laid-out so it cannot collapse invisible')
  assert(locateIcon !== null && locateIcon.getAttribute('stroke') === 'currentColor', 'palette: bar glyph inherits the button ink')

  setFloatingAnnotationBarState({ visible: true, count: 0 })
  assert(send.getAttribute('aria-disabled') === 'true', 'palette: the disabled send reports aria-disabled')
  assert(send.style.getPropertyValue('background') === '#e6ecf5', 'palette: light disabled send uses the disabled accent fill token')
  assert(send.style.getPropertyValue('color') === '#4a5563', 'palette: light disabled send keeps a readable ink token')
  assert(send.style.getPropertyValue('background') !== send.style.getPropertyValue('color'), 'palette: disabled send fill and ink are distinct')
  assert(send.style.getPropertyValue('opacity') === '', 'palette: disabled send never fades the whole button with opacity')

  locate.fire('mouseenter', {})
  assert(locate.style.getPropertyValue('color') === '#0f1115', 'palette: hovered icon uses the text token (visible glyph)')
  assert(locate.style.getPropertyValue('background') === 'rgba(15,17,21,0.06)', 'palette: hovered icon uses the hover fill token')
  locate.fire('mouseleave', {})
  assert(locate.style.getPropertyValue('color') === '#61666b', 'palette: resting icon uses the muted token')

  // Before the host publishes a dark flag, the OS preference drives the palette.
  media.setMatches(true)
  assert(bar.style.getPropertyValue('background') === '#262626', 'palette: OS dark preference paints the dark bar surface')
  assert(bar.style.getPropertyValue('border-color') === 'rgba(255,255,255,0.10)', 'palette: dark bar uses the dark border token')
  assert(bar.style.getPropertyValue('color') === '#f5f5f5', 'palette: dark bar uses the dark text token')
  assert(send.style.getPropertyValue('background') === '#39424f', 'palette: dark disabled send uses the dark disabled fill token')
  assert(send.style.getPropertyValue('color') === '#c3ccd8', 'palette: dark disabled send keeps a readable ink token')
  media.setMatches(false)
  assert(bar.style.getPropertyValue('background') === '#ffffff', 'palette: a light OS preference repaints the light bar surface')
  assert(send.style.getPropertyValue('background') === '#e6ecf5', 'palette: light preference restores the light disabled fill')

  // An explicit host dark flag wins over the OS preference.
  setFloatingAnnotationBarState({ visible: true, count: 0, dark: true })
  assert(bar.style.getPropertyValue('background') === '#262626', 'palette: explicit dark host flag paints the dark surface')
  locate.fire('mouseenter', {})
  assert(locate.style.getPropertyValue('color') === '#f5f5f5', 'palette: dark hovered icon uses the dark text token')
  locate.fire('mouseleave', {})
  setFloatingAnnotationBarState({ visible: true, count: 2, dark: true })
  assert(send.getAttribute('aria-disabled') === 'false', 'palette: send enables with pending annotations')
  assert(send.style.getPropertyValue('background') === '#0069FB', 'palette: enabled send uses the accent token')
  assert(send.style.getPropertyValue('color') === '#ffffff', 'palette: enabled send uses the on-accent ink token')
  setFloatingAnnotationBarState({ visible: true, count: 0, dark: false })
  media.setMatches(true)
  assert(bar.style.getPropertyValue('background') === '#ffffff', 'palette: explicit light host flag ignores the OS dark preference')
  media.setMatches(false)

  setFloatingComposerRequest('tab-palette', 'session-1', false)
  surface.doc.defaultView.flush()
  install()
}

// The floating restore button hovers over the inspected page (which can be
// light while the host theme is dark). Its hover fill must stay opaque.
assert(
  source.includes('--dsw-alias-button-floating-hover'),
  'the floating button hover uses the opaque floating-button fill token',
)
assert(
  !source.includes('[data-dsh-nudge-float-button]:hover{background:var(--dsw-alias-interactive-bg-hover'),
  'the floating button hover no longer uses the translucent generic hover tint',
)
assert(
  source.includes('--dsw-alias-button-floating-fill'),
  'the floating button base fill uses the dedicated floating-button token',
)
assert(
  source.includes('setBottomInset') && source.includes('setBottomInset('),
  'the bundle ships the page safe-area channel',
)

console.log('')
if (failures === 0) console.log('floating-composer: ' + checks + ' checks passed')
else {
  console.error('floating-composer: ' + failures + ' of ' + checks + ' checks failed')
  process.exit(1)
}
