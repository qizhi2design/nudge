/**
 * Workspace panel test: renders the bundled `NudgeWorkspacePanel` with the same
 * fake hook runtime style as test/settings-page.test.mjs and drives it against a
 * fake `nudge/*` bridge. Proves the three tabs follow docs/workspace-versions.md:
 * file list + open flow, branch list with the dirty switch offer (stash call
 * args), commit selection/message/empty-message guard, the two-step restore
 * call args, and the hot-reload decision table.
 *
 * Engineering test only; the live shell render is exercised in the running
 * Desktop plugin. No real timers, network, git or filesystem are touched.
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
function deepEq(name, actual, expected) {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  if (left === right) ok(name + ' (' + left + ')')
  else {
    failures += 1
    console.error('FAIL - ' + name + ': expected ' + right + ', got ' + left)
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

/** Flush pending promise callbacks. */
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
const exportsObject = loaded.factory((name) => {
  if (name === 'react') return runtime.React
  if (name === 'react/jsx-runtime') return { jsx: runtime.React.createElement, jsxs: runtime.React.createElement, Fragment: 'Fragment' }
  throw new Error('unexpected require: ' + name)
})
const testHook = exportsObject.__test
assert(testHook !== null && typeof testHook === 'object', 'bundle exposes the workspace test hook')
assert(typeof testHook.NudgeWorkspacePanel === 'function', 'test hook exposes NudgeWorkspacePanel')
assert(typeof testHook.hotReloadDecision === 'function', 'test hook exposes hotReloadDecision')
const helpers = testHook.gitStoreTestHelpers
assert(helpers !== null && typeof helpers === 'object', 'test hook exposes the git store helpers')

// ------------------------------------------------------------- locale / props

const t = (key, vars) => key + (vars ? '|' + JSON.stringify(vars) : '')
const theme = {
  brand: '#0f1115',
  base: '#ffffff',
  layer1: '#ffffff',
  layer2: '#f4f4f5',
  layer3: '#e9ecf2',
  overlay: '#e9ecf2',
  border: '#0000000a',
  borderStrong: '#0000001f',
  hover: '#2631480f',
  accent: '#4176e6',
  onBrand: '#ffffff',
  text: '#0f1115',
  muted: '#61666b',
  faint: '#81858c',
  danger: '#ec1313',
  success: '#22c55e',
  warn: '#f59e0b',
  isDark: false,
}

// ------------------------------------------------------------- fixtures

function fixture(overrides) {
  const base = {
    sessionId: 'session-1',
    cwd: '/tmp/ws',
    sourceRoot: '/tmp/ws',
    writable: true,
    truncated: false,
    git: {
      available: true,
      repoRoot: '/tmp/ws',
      relativeRoot: '',
      branch: 'main',
      detached: false,
      branches: [
        { name: 'main', current: true },
        { name: 'feat-a', current: false },
        { name: 'feat-b', current: false },
      ],
      clean: false,
      changes: [
        { path: 'demo/index.html', index: ' ', worktree: 'M', label: 'modified' },
        { path: 'demo/about.html', index: 'A', worktree: ' ', label: 'added' },
      ],
      error: null,
    },
    htmlFiles: [
      { path: 'demo/about.html', name: 'about.html', dir: 'demo', size: 900, mtime: 1760000000000, change: 'added' },
      { path: 'demo/index.html', name: 'index.html', dir: 'demo', size: 1234, mtime: 1760000000000, change: 'modified' },
    ],
    preview: { active: false, port: 0, baseUrl: '' },
  }
  return Object.assign(base, overrides || {})
}

const COMMITS = [
  {
    hash: 'abc1234def5678abc1234def5678abc1234def56',
    short: 'abc1234',
    author: 'purity3',
    date: '2026-11-08T09:00:00+08:00',
    subject: 'feat: demo page',
  },
  {
    hash: 'def5678abc1234def5678abc1234def5678abc123',
    short: 'def5678',
    author: 'purity3',
    date: '2026-11-07T21:30:00+08:00',
    subject: 'fix: spacing',
  },
]

// ------------------------------------------------------------- fake remote

function createRemote(behavior) {
  const calls = []
  const call = (channel, name, payload) => {
    const args = payload && payload.args
    calls.push({ channel, name, args })
    const endpoint = name.split('/')[1]
    return Promise.resolve(behavior(endpoint, args, calls.length)).then((value) => {
      if (value && value.__error) return { ok: false, error: { message: value.__error } }
      return { ok: true, value }
    })
  }
  return { calls, call }
}

function hostOf(remote) {
  return { connection: { rpc: { call: remote.call } } }
}

function callsTo(remote, endpoint) {
  return remote.calls.filter((entry) => entry.name === 'nudge/' + endpoint)
}

function lastCall(remote, endpoint) {
  const list = callsTo(remote, endpoint)
  return list.length === 0 ? undefined : list[list.length - 1]
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

function findNode(tree, predicate) {
  return findNodes(tree, predicate)[0]
}

function panelProps(ctx, extra) {
  return Object.assign(
    {
      ctx,
      t,
      theme,
      sessionId: 'session-1',
      currentUrl: '',
      onClose() {},
      onNotice() {},
      onNavigate() {},
      onReload() {},
    },
    extra || {},
  )
}

const PANEL = testHook.NudgeWorkspacePanel

async function settle(props, until, attempts = 20) {
  let rendered = runtime.render(PANEL, props)
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await flush()
    if (until(rendered.tree)) return rendered
    rendered = runtime.render(PANEL, props)
  }
  return rendered
}

async function clickAndSettle(props, predicate, until) {
  const rendered = runtime.render(PANEL, props)
  const node = findNode(rendered.tree, predicate)
  assert(node !== undefined, 'click target exists')
  if (node !== undefined) node.props.onClick()
  return settle(props, until)
}

// ------------------------------------------------------------- helpers

{
  console.log('\n# hot-reload decision and request-arg helpers')
  eq('first poll only records the baseline', helpers.hotReloadDecision(null, 3, 'browse'), 'ignore')
  eq('unchanged revision is ignored', helpers.hotReloadDecision(3, 3, 'browse'), 'ignore')
  eq('closed watch is ignored', helpers.hotReloadDecision(3, null, 'browse'), 'ignore')
  eq('changed revision reloads in browse', helpers.hotReloadDecision(2, 3, 'browse'), 'reload')
  eq('changed revision defers in annotate', helpers.hotReloadDecision(2, 3, 'annotate'), 'defer')
  eq('changed revision defers in edit', helpers.hotReloadDecision(2, 3, 'edit'), 'defer')
  eq('revision zero is a valid baseline', helpers.hotReloadDecision(0, 1, 'browse'), 'reload')

  deepEq('workspace args', helpers.workspaceArgs('session-1'), { session: 'session-1' })
  deepEq('gitLog args without file', helpers.gitLogArgs('session-1'), { session: 'session-1' })
  deepEq('gitLog args with file', helpers.gitLogArgs('session-1', 'demo/index.html'), { session: 'session-1', file: 'demo/index.html' })
  deepEq('previewOpen args', helpers.previewOpenArgs('session-1', 'demo/index.html'), { session: 'session-1', file: 'demo/index.html' })
  deepEq('plain branch switch args', helpers.gitSwitchArgs('session-1', 'feat-a'), { session: 'session-1', branch: 'feat-a' })
  deepEq('stash branch switch args', helpers.gitSwitchArgs('session-1', 'feat-a', { stash: true }), {
    session: 'session-1',
    branch: 'feat-a',
    options: { stash: true },
  })
  deepEq('restore args', helpers.gitRestoreFileArgs('session-1', 'demo/index.html', 'abc1234'), {
    session: 'session-1',
    file: 'demo/index.html',
    commit: 'abc1234',
  })
  deepEq('commit args', helpers.gitCommitArgs('session-1', '  feat: demo  ', ['demo/index.html']), {
    session: 'session-1',
    message: 'feat: demo',
    files: ['demo/index.html'],
  })
  deepEq('watch poll args', helpers.watchPollArgs('session-1'), { session: 'session-1' })
  eq('empty message guard', helpers.commitRequestError(t, '   ', ['a']), 'commit.emptyMessage')
  eq('empty selection guard', helpers.commitRequestError(t, 'msg', []), 'commit.noFiles')
  eq('untracked change label', helpers.changeLabelKey('untracked'), 'commit.changeUntracked')
  eq('format time', helpers.formatCommitTime(new Date(2026, 10, 8, 9, 5)), '2026-11-08 09:05')
  eq(
    'infer active file from preview URL',
    helpers.inferActiveFile(fixture(), 'http://127.0.0.1:43127/demo/index.html').path,
    'demo/index.html',
  )
  eq('infer active file is null for unknown URLs', helpers.inferActiveFile(fixture(), 'http://127.0.0.1:43127/other.html'), null)
  eq(
    'first workspace HTML prefers the index.html entry point',
    helpers.firstWorkspaceHtmlFile(fixture()).path,
    'demo/index.html',
  )
  eq(
    'first workspace HTML prefers a root index over a nested one',
    helpers.firstWorkspaceHtmlFile({ htmlFiles: [{ path: 'pages/index.html' }, { path: 'index.htm' }] }).path,
    'index.htm',
  )
  eq(
    'first workspace HTML falls back to shallowest path order',
    helpers.firstWorkspaceHtmlFile({ htmlFiles: [{ path: 'z/page.html' }, { path: 'b.html' }, { path: 'a.html' }] }).path,
    'a.html',
  )
  eq('first workspace HTML skips empty paths', helpers.firstWorkspaceHtmlFile({ htmlFiles: [{ path: '' }, { path: 'z.html' }] }).path, 'z.html')
  eq('first workspace HTML is null without files', helpers.firstWorkspaceHtmlFile({ htmlFiles: [] }), null)
  deepEq('watch changed paths are bounded to the last entries', helpers.watchChangedPaths({
    changed: [{ path: 'a' }, { path: 'b' }, { path: '' }],
  }), ['a', 'b'])
}

// ------------------------------------------------------------- files + open

{
  console.log('\n# files tab renders the scan and opens a file')
  runtime.reset()
  const remote = createRemote((endpoint) => {
    if (endpoint === 'workspace') return fixture()
    if (endpoint === 'previewOpen') {
      return { ok: true, port: 43127, baseUrl: 'http://127.0.0.1:43127/', url: 'http://127.0.0.1:43127/demo/index.html', file: 'demo/index.html', root: '/tmp/ws' }
    }
    if (endpoint === 'watchPoll') return { revision: 0, root: '/tmp/ws', watching: true, changed: [] }
    return { __error: 'unexpected endpoint: ' + endpoint }
  })
  const navigations = []
  const reloads = []
  const notices = []
  const props = panelProps(hostOf(remote), {
    onNavigate: (url) => navigations.push(url),
    onReload: () => reloads.push(1),
    onNotice: (notice) => notices.push(notice),
  })
  const view = await settle(props, (tree) => textOf(tree).includes('index.html'))
  const panel = findNode(view.tree, (node) => node.props['data-dsh-nudge-workspace-panel'] !== undefined)
  assert(panel !== undefined, 'workspace panel mounts as an aside')
  assert(panel.type === 'aside', 'panel uses the dock aside element')
  assert(panel.props['aria-label'] === 'workspace.title', 'panel has a localized aria-label')
  assert(textOf(view.tree).includes('about.html'), 'file list renders the scanned HTML files')
  assert(textOf(view.tree).includes('demo'), 'file rows show their directory')
  assert(
    findNode(view.tree, (node) => node.type === 'input' && node.props['aria-label'] === 'workspace.filterPlaceholder') !== undefined,
    'file filter input renders with a localized label',
  )
  assert(lastCall(remote, 'workspace') !== undefined, 'panel loads the workspace snapshot')
  deepEq('workspace request carries the session', lastCall(remote, 'workspace').args, { session: 'session-1' })
  assert(textOf(view.tree).includes('workspace.fileCount'), 'file count line renders')

  // Filter narrows the list.
  const filterInput = findNode(view.tree, (node) => node.type === 'input' && node.props['aria-label'] === 'workspace.filterPlaceholder')
  filterInput.props.onChange({ target: { value: 'about' } })
  const filtered = await settle(props, (tree) => !textOf(tree).includes('index.html'))
  assert(textOf(filtered.tree).includes('about.html'), 'filter keeps matching files')
  assert(
    findNode(filtered.tree, (node) => node.props['data-workspace-file'] === 'demo/index.html') === undefined,
    'filter hides non-matching files',
  )
  filterInput.props.onChange({ target: { value: '' } })
  const restored = await settle(props, (tree) => textOf(tree).includes('index.html'))

  // Open one file: previewOpen -> onNavigate(url) -> explicit reload.
  const opened = await clickAndSettle(
    props,
    (node) => node.props['data-workspace-file'] === 'demo/index.html',
    (tree) =>
      navigations.length > 0 &&
      findNode(tree, (node) => node.props['data-workspace-file'] === 'demo/index.html' && node.props['aria-pressed'] === true) !== undefined,
  )
  assert(navigations.length === 1, 'file click navigates the carrier once')
  eq('file click navigates to the preview URL', navigations[0], 'http://127.0.0.1:43127/demo/index.html')
  eq('file click does not reload after navigating', reloads.length, 0)
  deepEq('file click calls previewOpen with the file', lastCall(remote, 'previewOpen').args, {
    session: 'session-1',
    file: 'demo/index.html',
  })
  assert(
    findNode(opened.tree, (node) => node.props['data-workspace-file'] === 'demo/index.html' && node.props['aria-pressed'] === true) !== undefined,
    'opened file is marked as active',
  )
  // The panel must not fire watcher polling itself: the body owns the loop.
  const watchCalls = callsTo(remote, 'watchPoll').length
  assert(watchCalls === 0, 'panel does not own the hot-reload poll loop')
}


// ------------------------------------------------ open a file in a new Nudge tab

{
  console.log('\n# file row open-in-Nudge action opens a fresh Nudge tab')
  runtime.reset()
  const remote = createRemote((endpoint) => {
    if (endpoint === 'workspace') return fixture()
    if (endpoint === 'previewOpen') {
      return { ok: true, port: 43127, baseUrl: 'http://127.0.0.1:43127/', url: 'http://127.0.0.1:43127/demo/index.html', file: 'demo/index.html', root: '/tmp/ws' }
    }
    if (endpoint === 'watchPoll') return { revision: 0, root: '/tmp/ws', watching: true, changed: [] }
    return { __error: 'unexpected endpoint: ' + endpoint }
  })
  const opened = []
  const navigations = []
  const ctx = Object.assign(hostOf(remote), {
    sidebarRight: {
      openTabIn(sessionId, kind, options) {
        opened.push({ sessionId, kind, options })
      },
      isExpanded() {
        return true
      },
      toggleExpanded() {},
    },
  })
  const props = panelProps(ctx, { onNavigate: (url) => navigations.push(url) })
  const view = await settle(props, (tree) => textOf(tree).includes('index.html'))
  const actions = findNodes(view.tree, (node) => node.props['data-workspace-open-nudge'] !== undefined)
  assert(actions.length >= 1, 'each HTML file row offers an open-in-Nudge action')
  assert(actions[0].props['aria-label'] === 'workspace.openInNudge', 'the action carries a localized label')
  await clickAndSettle(
    props,
    (node) => node.props['data-workspace-open-nudge'] === 'demo/index.html',
    () => opened.length > 0,
  )
  deepEq('open-in-Nudge requests the preview URL', lastCall(remote, 'previewOpen').args, {
    session: 'session-1',
    file: 'demo/index.html',
  })
  eq('open-in-Nudge opens one tab', opened.length, 1)
  eq('open-in-Nudge uses the Nudge tab kind', opened[0] && opened[0].kind, 'nudge')
  eq('open-in-Nudge targets the same session', opened[0] && opened[0].sessionId, 'session-1')
  deepEq('open-in-Nudge navigates the new tab to the preview URL', opened[0] && opened[0].options, {
    params: { url: 'http://127.0.0.1:43127/demo/index.html' },
  })
  eq('open-in-Nudge does not navigate the current carrier', navigations.length, 0)
}

// ------------------------------------------------------------- branches

{
  console.log('\n# dirty branch switch offers stash or commit')
  runtime.reset()
  const remote = createRemote((endpoint, args) => {
    if (endpoint === 'workspace') return fixture()
    if (endpoint === 'gitLog') return { file: '', commits: [] }
    if (endpoint === 'gitSwitch') {
      const clean = fixture()
      clean.git.clean = true
      clean.git.changes = []
      clean.git.branch = args.branch
      clean.git.branches = [{ name: 'main', current: false }, { name: 'feat-a', current: true }, { name: 'feat-b', current: false }]
      return { ok: true, branch: args.branch, stashed: args.options && args.options.stash === true, clean: true, git: clean.git }
    }
    return { __error: 'unexpected endpoint: ' + endpoint }
  })
  const reloads = []
  const notices = []
  const props = panelProps(hostOf(remote), { onReload: () => reloads.push(1), onNotice: (notice) => notices.push(notice) })
  await settle(props, (tree) => textOf(tree).includes('index.html'))
  const versionsView = await clickAndSettle(
    props,
    (node) => node.props['data-workspace-tab'] === 'versions',
    (tree) => findNode(tree, (node) => node.props['data-workspace-branch'] === 'feat-a') !== undefined,
  )
  assert(textOf(versionsView.tree).includes('workspace.branches'), 'versions tab renders the branch section')
  assert(findNode(versionsView.tree, (node) => node.props['data-workspace-branch'] === 'main') !== undefined, 'current branch is listed')
  assert(findNode(versionsView.tree, (node) => node.props['data-workspace-branch'] === 'feat-a') !== undefined, 'other branches are listed')

  const offered = await clickAndSettle(
    props,
    (node) => node.props['data-workspace-branch'] === 'feat-a',
    (tree) => findNode(tree, (node) => node.props['data-workspace-switch-offer'] !== undefined) !== undefined,
  )
  assert(callsTo(remote, 'gitSwitch').length === 0, 'dirty switch waits for an explicit choice')
  assert(textOf(offered.tree).includes('workspace.switchDirtyHint'), 'dirty switch shows the inline hint')

  const switched = await clickAndSettle(
    props,
    (node) => node.props['data-workspace-stash-switch'] !== undefined,
    () => callsTo(remote, 'gitSwitch').length > 0,
  )
  deepEq('stash-and-switch sends the stash option', lastCall(remote, 'gitSwitch').args, {
    session: 'session-1',
    branch: 'feat-a',
    options: { stash: true },
  })
  assert(reloads.length >= 1, 'branch switch forces an explicit reload')
  assert(notices.length >= 1 && String(notices[notices.length - 1].text).includes('workspace.stashedSwitched'), 'switch reports success')
  assert(textOf(switched.tree) !== '', 'panel re-renders after the switch')

  // Clean workspace: switch directly, without the offer.
  runtime.reset()
  const cleanRemote = createRemote((endpoint, args) => {
    if (endpoint === 'workspace') {
      const clean = fixture()
      clean.git.clean = true
      clean.git.changes = []
      return clean
    }
    if (endpoint === 'gitLog') return { file: '', commits: [] }
    if (endpoint === 'gitSwitch') return { ok: true, branch: args.branch, stashed: false, clean: true, git: fixture().git }
    return { __error: 'unexpected endpoint: ' + endpoint }
  })
  const cleanReloads = []
  const cleanProps = panelProps(hostOf(cleanRemote), { onReload: () => cleanReloads.push(1) })
  await settle(cleanProps, (tree) => textOf(tree).includes('index.html'))
  await clickAndSettle(
    cleanProps,
    (node) => node.props['data-workspace-tab'] === 'versions',
    (tree) => findNode(tree, (node) => node.props['data-workspace-branch'] === 'feat-b') !== undefined,
  )
  await clickAndSettle(
    cleanProps,
    (node) => node.props['data-workspace-branch'] === 'feat-b',
    () => callsTo(cleanRemote, 'gitSwitch').length > 0,
  )
  deepEq('clean switch omits the stash option', lastCall(cleanRemote, 'gitSwitch').args, { session: 'session-1', branch: 'feat-b' })
  assert(cleanReloads.length >= 1, 'clean branch switch reloads the page')
}

// ------------------------------------------------------------- commit

{
  console.log('\n# commit tab selects files, takes a message and guards empty input')
  runtime.reset()
  const remote = createRemote((endpoint, args) => {
    if (endpoint === 'workspace') return fixture()
    if (endpoint === 'gitLog') return { file: '', commits: [] }
    if (endpoint === 'gitCommit') {
      const next = fixture()
      next.git.clean = true
      next.git.changes = []
      return {
        ok: true,
        committed: true,
        commit: { hash: '1111222233334444555566667777888899990000', short: '1111222', subject: args.message },
        git: next.git,
      }
    }
    return { __error: 'unexpected endpoint: ' + endpoint }
  })
  const notices = []
  const props = panelProps(hostOf(remote), { onNotice: (notice) => notices.push(notice) })
  await settle(props, (tree) => textOf(tree).includes('index.html'))
  const commitView = await clickAndSettle(
    props,
    (node) => node.props['data-workspace-tab'] === 'commit',
    (tree) => findNode(tree, (node) => node.props['data-workspace-select-all'] !== undefined) !== undefined,
  )
  assert(textOf(commitView.tree).includes('commit.selectAll'), 'commit tab renders select-all')
  assert(textOf(commitView.tree).includes('commit.selectedCount|{"n":"2"}'), 'all changed files start selected')
  const checkboxes = findNodes(commitView.tree, (node) => node.type === 'input' && node.props.type === 'checkbox')
  eq('one checkbox per changed file', checkboxes.length, 2)
  assert(checkboxes.every((node) => node.props.checked === true), 'checkboxes start checked')

  // Deselect the first file.
  checkboxes[0].props.onChange({ target: { checked: false } })
  const deselected = await settle(props, (tree) => textOf(tree).includes('commit.selectedCount|{"n":"1"}'))
  assert(textOf(deselected.tree).includes('commit.selectedCount|{"n":"1"}'), 'unchecking updates the selected count')

  // Empty message guard: the commit action is rejected before the bridge call.
  const guarded = await clickAndSettle(
    props,
    (node) => node.props['data-workspace-commit'] !== undefined,
    (tree) => textOf(tree).includes('commit.emptyMessage'),
  )
  assert(callsTo(remote, 'gitCommit').length === 0, 'empty message never reaches gitCommit')
  assert(textOf(guarded.tree).includes('commit.emptyMessage'), 'empty message is surfaced inline')

  // Type a message and commit the remaining selection.
  const messageInput = findNode(guarded.tree, (node) => node.props['data-workspace-commit-message'] !== undefined)
  assert(messageInput !== undefined, 'commit message textarea renders')
  messageInput.props.onChange({ target: { value: '  feat: update demo page  ' } })
  const filled = await settle(props, (tree) => {
    const input = findNode(tree, (node) => node.props['data-workspace-commit-message'] !== undefined)
    return input !== undefined && input.props.value === '  feat: update demo page  '
  })
  assert(textOf(filled.tree) !== '', 'panel renders the staged commit message')

  const committed = await clickAndSettle(
    props,
    (node) => node.props['data-workspace-commit'] !== undefined,
    () => callsTo(remote, 'gitCommit').length > 0,
  )
  deepEq('commit sends the message and the selected files', lastCall(remote, 'gitCommit').args, {
    session: 'session-1',
    message: 'feat: update demo page',
    files: ['demo/about.html'],
  })
  assert(notices.some((notice) => String(notice.text).includes('commit.done')), 'commit success is reported')
  assert(textOf(committed.tree) !== '', 'panel re-renders after a commit')
  assert(callsTo(remote, 'workspace').length > 1, 'commit refreshes the workspace snapshot')
}

// ------------------------------------------------------------- restore

{
  console.log('\n# versions tab restores a file in two steps')
  runtime.reset()
  const remote = createRemote((endpoint, args) => {
    if (endpoint === 'workspace') return fixture()
    if (endpoint === 'previewOpen') {
      return { ok: true, url: 'http://127.0.0.1:43127/demo/index.html', file: 'demo/index.html', baseUrl: 'http://127.0.0.1:43127/', port: 43127, root: '/tmp/ws' }
    }
    if (endpoint === 'gitLog') return { file: args && args.file ? args.file : '', commits: COMMITS }
    if (endpoint === 'gitRestoreFile') {
      return { ok: true, file: args.file, commit: args.commit, status: 'restored' }
    }
    return { __error: 'unexpected endpoint: ' + endpoint }
  })
  const navigations = []
  const reloads = []
  const notices = []
  const props = panelProps(hostOf(remote), {
    onNavigate: (url) => navigations.push(url),
    onReload: () => reloads.push(1),
    onNotice: (notice) => notices.push(notice),
  })
  await settle(props, (tree) => textOf(tree).includes('index.html'))
  // Open the file so the versions tab has an active file.
  await clickAndSettle(
    props,
    (node) => node.props['data-workspace-file'] === 'demo/index.html',
    () => navigations.length > 0,
  )
  const versionsView = await clickAndSettle(
    props,
    (node) => node.props['data-workspace-tab'] === 'versions',
    (tree) => textOf(tree).includes('feat: demo page'),
  )
  assert(textOf(versionsView.tree).includes('workspace.versionsFor'), 'versions tab labels the active file history')
  const logCalls = callsTo(remote, 'gitLog')
  assert(logCalls.length >= 1, 'versions tab loads gitLog')
  const fileLog = logCalls.find((entry) => entry.args && entry.args.file === 'demo/index.html')
  assert(fileLog !== undefined, 'gitLog is scoped to the active file')
  assert(textOf(versionsView.tree).includes('abc1234'), 'commit subject + short hash render')

  // First click arms the restore; it must not touch the bridge yet.
  const armed = await clickAndSettle(
    props,
    (node) => node.props['data-workspace-restore'] === 'abc1234',
    (tree) => findNode(tree, (node) => node.props['data-workspace-restore-confirm'] !== undefined) !== undefined,
  )
  assert(callsTo(remote, 'gitRestoreFile').length === 0, 'restore needs a second confirmation')
  assert(textOf(armed.tree).includes('workspace.restoreConfirm'), 'restore shows the confirm action')

  const restoreReloads = reloads.length
  eq('opening a file never reloaded the previous page', restoreReloads, 0)
  const restored = await clickAndSettle(
    props,
    (node) => node.props['data-workspace-restore-confirm'] !== undefined,
    () => callsTo(remote, 'gitRestoreFile').length > 0,
  )
  deepEq('restore sends the file and the full commit hash', lastCall(remote, 'gitRestoreFile').args, {
    session: 'session-1',
    file: 'demo/index.html',
    commit: COMMITS[0].hash,
  })
  assert(reloads.length > restoreReloads, 'restore forces an explicit reload')
  assert(notices.some((notice) => String(notice.text).includes('workspace.restored')), 'restore success is reported')
  assert(textOf(restored.tree) !== '', 'panel re-renders after a restore')
}

// ------------------------------------------------------- embedded dock mode

{
  console.log('\n# embedded panel hands its header, close and refresh to the dock')
  runtime.reset()
  const embeddedRemote = createRemote((endpoint) => {
    if (endpoint === 'workspace') return fixture()
    if (endpoint === 'gitLog') return { file: '', commits: [] }
    return { __error: 'unexpected endpoint: ' + endpoint }
  })
  const view = await settle(panelProps(hostOf(embeddedRemote), { embedded: true }), (tree) => textOf(tree).includes('index.html'))
  const root = findNode(view.tree, (node) => node.props['data-dsh-nudge-workspace-panel'] !== undefined)
  assert(root !== undefined, 'embedded workspace keeps its panel contract')
  eq('embedded workspace fills the dock width', root.props.style.width, '100%')
  eq('embedded workspace drops its own border', root.props.style.borderLeft, 'none')
  assert(
    findNode(view.tree, (node) => node.props['aria-label'] === 'workspace.close') === undefined,
    'embedded workspace hides its own close button',
  )
  assert(
    findNode(view.tree, (node) => node.props['aria-label'] === 'workspace.refresh') === undefined,
    'embedded workspace hides its own refresh button (the dock header owns it)',
  )
}

// ------------------------------------------------------------- no repo state

{
  console.log('\n# workspace without a git repository degrades gracefully')
  runtime.reset()
  const noGit = fixture({
    git: {
      available: false,
      repoRoot: '',
      relativeRoot: '',
      branch: '',
      detached: false,
      branches: [],
      clean: true,
      changes: [],
      error: 'not-a-repository',
    },
  })
  const remote = createRemote((endpoint) => {
    if (endpoint === 'workspace') return noGit
    if (endpoint === 'gitLog') return { file: '', commits: [] }
    return { __error: 'unexpected endpoint: ' + endpoint }
  })
  const props = panelProps(hostOf(remote))
  const view = await settle(props, (tree) => textOf(tree).includes('not-a-repository'))
  assert(textOf(view.tree).includes('workspace.gitUnavailable'), 'no-repository state is explained')
  assert(textOf(view.tree).includes('not-a-repository'), 'the stable git reason is surfaced')
  assert(callsTo(remote, 'gitLog').length === 0, 'no repository means no log request')
  assert(
    findNode(view.tree, (node) => node.props['data-workspace-tab'] === 'versions') === undefined,
    'the versions tab is hidden without a repository',
  )
  assert(
    findNode(view.tree, (node) => node.props['data-workspace-tab'] === 'files') === undefined,
    'a single remaining tab drops the whole secondary tab strip',
  )
}

// ------------------------------------------------------------- failures

{
  console.log('\n# bridge failures surface in the panel')
  runtime.reset()
  const remote = createRemote((endpoint) => {
    if (endpoint === 'workspace') return fixture()
    if (endpoint === 'previewOpen') return { __error: 'nudge: preview failed' }
    if (endpoint === 'gitLog') return { file: '', commits: [] }
    return { __error: 'unexpected endpoint: ' + endpoint }
  })
  const props = panelProps(hostOf(remote))
  await settle(props, (tree) => textOf(tree).includes('index.html'))
  const failed = await clickAndSettle(
    props,
    (node) => node.props['data-workspace-file'] === 'demo/index.html',
    (tree) => textOf(tree).includes('workspace.openFailed'),
  )
  assert(textOf(failed.tree).includes('workspace.openFailed'), 'open failure renders the inline error line')
  assert(textOf(failed.tree).includes('preview failed'), 'bridge message is preserved in the error')
}

if (failures > 0) {
  console.error('\n' + failures + ' workspace panel failure(s) / ' + checks + ' checks')
  process.exit(1)
}
console.log('\nworkspace panel ok (' + checks + ' checks, 0 failures)')
