/**
 * Host integration test: mounts the real `lib/index.js` plugin against a real
 * temporary workspace and the real `lib/source-sync.js`, then exercises the
 * `nudge/*` remote service exactly as the Client half calls it.
 *
 * This covers wiring the live UI cannot easily prove in a scripted session:
 * session resolution, policy gating, source mapping, batch persistence and
 * style-reset removal. Run: `node test/host-integration.test.mjs`.
 */
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { apply } from '../lib/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)

let failures = 0
function ok(name) {
  console.log('ok - ' + name)
}
function assert(condition, name, detail) {
  if (condition) {
    ok(name)
    return
  }
  failures += 1
  console.error('FAIL - ' + name + (detail === undefined ? '' : ' — ' + detail))
}

// ---------------------------------------------------------------- fs adapter

function versionOf(info) {
  return String(info.mtimeMs) + ':' + String(info.size)
}

async function realpathOf(input) {
  const absolute = resolve(String(input))
  const tail = []
  let cursor = absolute
  for (let guard = 0; guard < 64; guard += 1) {
    try {
      const real = await realpath(cursor)
      return tail.length > 0 ? join(real, ...tail.slice().reverse()) : real
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
      const parent = dirname(cursor)
      if (parent === cursor) return absolute
      tail.push(cursor.slice(parent.length).replace(/^[\\/]+/, ''))
      cursor = parent
    }
  }
  return absolute
}

function createFs() {
  const targets = new Map()
  function targetFor(canonicalPath) {
    let target = targets.get(canonicalPath)
    if (!target) {
      target = { path: canonicalPath, key: canonicalPath }
      targets.set(canonicalPath, target)
    }
    return target
  }
  return {
    async resolve(input) {
      return targetFor(await realpathOf(input))
    },
    processPath(target) {
      return target.path
    },
    contains(parent, child) {
      const base = parent.path.endsWith('/') ? parent.path : parent.path + '/'
      return child.path === parent.path || child.path.startsWith(base)
    },
    async stat(target) {
      try {
        const info = await stat(target.path)
        return {
          version: versionOf(info),
          type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
          size: info.size,
        }
      } catch (error) {
        if (error.code === 'ENOENT') return undefined
        throw error
      }
    },
    async readText(target) {
      return readFile(target.path, 'utf8')
    },
    async listDir(target) {
      const entries = await readdir(target.path, { withFileTypes: true })
      const out = []
      for (const entry of entries) {
        const path = join(target.path, entry.name)
        out.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
          target: targetFor(await realpathOf(path)),
        })
      }
      return out
    },
    async writeText(target, content, expected, _signal, policy) {
      if (policy && policy.mode === 'read-only') {
        const error = new Error('read-only')
        error.code = 'EACCES'
        throw error
      }
      let before = null
      try {
        before = await readFile(target.path, 'utf8')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      if (before !== null && expected && expected.kind === 'replaceIfVersion') {
        const info = await stat(target.path)
        if (versionOf(info) !== expected.version) {
          const error = new Error('stale version')
          error.code = 'FS_STALE_VERSION'
          throw error
        }
      }
      if (before === null && expected && expected.kind === 'replaceIfVersion') {
        const error = new Error('stale version')
        error.code = 'FS_STALE_VERSION'
        throw error
      }
      await mkdir(dirname(target.path), { recursive: true })
      await writeFile(target.path, content, 'utf8')
      const after = await stat(target.path)
      return {
        operation: before === null ? 'create' : 'update',
        version: versionOf(after),
        before,
        after: content,
      }
    },
  }
}

// ------------------------------------------------------------------- fixture

async function makeWorkspace() {
  const dir = await mkdtemp(join(ROOT, 'test', '.tmp-host-'))
  const demo = join(dir, 'demo')
  await mkdir(demo, { recursive: true })
  const source = await readFile(join(ROOT, 'test', 'fixtures', 'demo-page.html'), 'utf8')
  await writeFile(join(demo, 'index.html'), source, 'utf8')
  await writeFile(
    join(demo, 'app.css'),
    '.hero-title { font-size: 34px; color: rgb(16, 24, 40); }\n.marketing-card { width: 320px; }\n',
    'utf8',
  )
  return dir
}

function createCtx(fs, cwd, options = {}) {
  const services = new Map()
  const state = { provided: null, typert: null, cwd, mode: options.mode || 'workspace-write', extra: {} }
  const ctx = {
    fs,
    sessions: {
      get(id) {
        if (id !== 'session-1') return undefined
        return { id, header: { cwd: state.cwd, createdAt: 1 } }
      },
    },
    get(name) {
      if (name === 'workingDirectory') return { get: () => state.cwd }
      if (name === 'sandboxPolicy') {
        return { resolve: () => ({ mode: state.mode, workspaceRoot: state.cwd }) }
      }
      return services.get(name) ?? state.extra[name]
    },
    provide(name, service) {
      services.set(name, service)
      state.provided = { name, service }
    },
    inject(names, callback) {
      const typert = { register(contribution) { state.typert = contribution } }
      const scope = { typert, effect: (fn) => fn() }
      callback(scope)
    },
    effect() {
      return () => {}
    },
    on() {
      return () => {}
    },
  }
  return { ctx, state }
}

// --------------------------------------------------------------------- cases

const workspace = await makeWorkspace()
const fs = createFs()
const { ctx, state } = createCtx(fs, workspace)
apply(ctx, { sourceRoot: '', urlRoot: 'http://127.0.0.1:4173', maxScanFiles: 100, maxFileBytes: 2000000 })

const api = state.provided && state.provided.service
assert(api !== null && typeof api === 'object', 'apply provides the nudge service')
assert(state.provided.name === 'nudge', 'service namespace is nudge')
assert(state.typert && Array.isArray(state.typert.invocations), 'typert contribution registered')
assert(state.typert.invocations.length === 14, 'fourteen remote invocations registered')

const facts = await api.session('session-1')
assert(facts.cwd === workspace, 'session endpoint resolves the workspace cwd')
assert(facts.writable === true, 'workspace-write modes report writable')
assert(facts.sourceRoot === workspace, 'default sourceRoot is the session cwd')

// 0. Settings page bridge: the profile config editor owns the row config.
const readOnlySnapshot = await api.config()
assert(readOnlySnapshot.writable === false, 'config snapshot is read-only without a config editor')
assert(readOnlySnapshot.values.maxScanFiles === 100, 'config snapshot reports the mounted row config')
assert(readOnlySnapshot.values.sourceRoot === '', 'config snapshot normalises the mounted row config')
assert(JSON.stringify(readOnlySnapshot.defaults) === JSON.stringify({ sourceRoot: '', urlRoot: '', maxScanFiles: 400, maxFileBytes: 2000000 }), 'config snapshot reports the schema defaults')

const entry = { options: { id: 'nudge', name: 'dsh.nudge', config: { urlRoot: 'http://127.0.0.1:4173' } } }
const writes = []
state.extra.configEditor = {
  entries() {
    return [entry]
  },
  async edit(target, change) {
    const next = change(structuredClone(target.options.config), {})
    target.options.config = next
    writes.push(next)
  },
}
const writableSnapshot = await api.config()
assert(writableSnapshot.writable === true, 'config snapshot is writable with the profile editor')
assert(writableSnapshot.overridden.length === 1 && writableSnapshot.overridden[0] === 'urlRoot', 'config snapshot names the overridden fields')

const saved = await api.configUpdate({ maxScanFiles: 250, urlRoot: 'http://127.0.0.1:5199/' })
assert(saved.saved === true && saved.values.maxScanFiles === 250, 'configUpdate reports the accepted values')
assert(writes.length === 1 && writes[0].maxScanFiles === 250, 'configUpdate writes the patched field')
assert(writes[0].urlRoot === 'http://127.0.0.1:5199/', 'configUpdate writes the second patched field')
assert(!Object.prototype.hasOwnProperty.call(writes[0], 'sourceRoot'), 'configUpdate leaves unpatched fields out of the patch')
const afterSave = await api.config()
assert(afterSave.values.maxScanFiles === 250, 'config snapshot reflects the written profile layer')
assert(afterSave.values.maxFileBytes === 2000000, 'unpatched fields keep the mounted config')
assert(afterSave.overridden.includes('maxScanFiles'), 'config snapshot lists the newly overridden field')

const clamped = await api.configUpdate({ maxFileBytes: 12345 })
assert(clamped.values.maxFileBytes === 16384, 'out-of-range numbers clamp to the documented bounds')
const ignored = await api.configUpdate({ foreign: 'value' })
assert(ignored.saved === false, 'configUpdate ignores unknown fields')
assert(Object.keys(writes[1]).length === 3, 'unknown fields never reach the profile patch')
const defaults = await api.configUpdate({ sourceRoot: '', urlRoot: '', maxScanFiles: 400, maxFileBytes: 2000000 })
assert(defaults.saved === true, 'configUpdate accepts the defaults patch')

// 1. Style edit on a static element with an explicit data-source hint.
const styleEdit = {
  id: 'edit-1',
  kind: 'style',
  selector: 'h1.hero-title',
  property: 'fontSize',
  value: '48px',
  before: '34px',
  after: '48px',
  outerHTML: '<h1 class="hero-title">把每一次车型推荐<br />做成一张会说话的卡片</h1>',
  textSnippet: '把每一次车型推荐 做成一张会说话的卡片',
  sourceHints: { file: 'demo/index.html', line: 35 },
}
const styleResult = await api.sync('session-1', { url: 'http://127.0.0.1:4173/index.html', title: 'demo' }, [styleEdit])
assert(styleResult.results.length === 1, 'one result per edit')
assert(styleResult.results[0].status === 'synced', 'style edit is reported synced', JSON.stringify(styleResult.results[0]))
assert(styleResult.results[0].file === 'demo/index.html', 'style edit reports the workspace-relative file')
const htmlAfterStyle = await readFile(join(workspace, 'demo', 'index.html'), 'utf8')
assert(htmlAfterStyle.includes('dsh-nudge-overrides'), 'override style block created in source')
assert(htmlAfterStyle.includes('h1.hero-title { font-size: 48px; }'), 'override declaration written')
assert(htmlAfterStyle.includes('把每一次车型推荐'), 'unrelated HTML text preserved')

// 2. Text edit: only the text node changes; child <br /> survives.
const headingTextEdit = {
  id: 'edit-2',
  kind: 'text',
  selector: 'h1.hero-title',
  textBefore: '把每一次车型推荐',
  textAfter: '把每一次车型推荐 · 智选',
  sourceHints: { file: 'demo/index.html', line: 35 },
  textSnippet: '把每一次车型推荐',
  outerHTML: '<h1 class="hero-title">把每一次车型推荐<br />做成一张会说话的卡片</h1>',
}
const textResult = await api.sync('session-1', { url: 'http://127.0.0.1:4173/index.html' }, [headingTextEdit])
assert(textResult.results[0].status === 'synced', 'text edit is reported synced', JSON.stringify(textResult.results[0]))
const htmlAfterText = await readFile(join(workspace, 'demo', 'index.html'), 'utf8')
assert(htmlAfterText.includes('把每一次车型推荐 · 智选<br />做成一张会说话的卡片'), 'text edit preserves child markup')
assert(htmlAfterText.includes('dsh-nudge-overrides'), 'style override survives a later text edit')

// 3. Batch of style edits on a stylesheet through the URL-map + search path.
const cssEditA = {
  id: 'edit-3',
  kind: 'style',
  selector: '.marketing-card',
  property: 'width',
  value: '360px',
  before: '320px',
  after: '360px',
  sourceHints: { styleHref: 'http://127.0.0.1:4173/demo/app.css', styleSelector: '.marketing-card' },
  textSnippet: '理想 L9',
}
const cssEditB = {
  id: 'edit-4',
  kind: 'style',
  selector: '.marketing-card',
  property: 'borderRadius',
  value: '20px',
  before: '12px',
  after: '20px',
  sourceHints: { styleHref: 'http://127.0.0.1:4173/demo/app.css', styleSelector: '.marketing-card' },
  textSnippet: '理想 L9',
}
const cssResult = await api.sync('session-1', { url: 'http://127.0.0.1:4173/index.html' }, [cssEditA, cssEditB])
assert(cssResult.results.every((r) => r.status === 'synced'), 'two stylesheet edits are synced', JSON.stringify(cssResult.results))
const cssAfter = await readFile(join(workspace, 'demo', 'app.css'), 'utf8')
assert(cssAfter.includes('.marketing-card { width: 360px;'), 'first declaration updated in the authored rule')
assert(cssAfter.includes('border-radius: 20px'), 'second declaration inserted in the same rule')

// 4. Attribute edit.
const attrEdit = {
  id: 'edit-5',
  kind: 'attr',
  selector: 'button#open-card',
  attrName: 'aria-label',
  attrAfter: '新建营销卡片',
  sourceHints: { file: 'demo/index.html' },
  outerHTML: '<button id="open-card" class="btn btn-primary" type="button">＋ 新建卡片</button>',
}
const attrResult = await api.sync('session-1', { url: 'http://127.0.0.1:4173/index.html' }, [attrEdit])
assert(attrResult.results[0].status === 'synced', 'attribute edit is synced', JSON.stringify(attrResult.results[0]))
const htmlAfterAttr = await readFile(join(workspace, 'demo', 'index.html'), 'utf8')
assert(htmlAfterAttr.includes('aria-label="新建营销卡片"'), 'attribute written into the source tag')

// 5. Style reset removes the override declaration we wrote, not authored CSS.
const resetEdit = {
  id: 'edit-6',
  kind: 'style',
  selector: 'h1.hero-title',
  property: 'fontSize',
  value: '',
  before: '48px',
  after: '',
  sourceHints: { file: 'demo/index.html', line: 35 },
  textSnippet: '把每一次车型推荐',
}
const resetResult = await api.sync('session-1', { url: 'http://127.0.0.1:4173/index.html' }, [resetEdit])
assert(resetResult.results[0].status === 'synced', 'style reset is synced', JSON.stringify(resetResult.results[0]))
const htmlAfterReset = await readFile(join(workspace, 'demo', 'index.html'), 'utf8')
assert(!htmlAfterReset.includes('h1.hero-title { font-size: 48px; }'), 'reset removes the override declaration')
assert(htmlAfterReset.includes('把每一次车型推荐 · 智选'), 'reset leaves text edits untouched')

// 6. Read-only policy never writes and reports preview.
state.mode = 'read-only'
const blockedEdit = {
  id: 'edit-7',
  kind: 'style',
  selector: '.marketing-card',
  property: 'width',
  value: '500px',
  before: '360px',
  after: '500px',
  sourceHints: { styleHref: 'http://127.0.0.1:4173/demo/app.css', styleSelector: '.marketing-card' },
}
const blockedResult = await api.sync('session-1', { url: 'http://127.0.0.1:4173/index.html' }, [blockedEdit])
assert(blockedResult.writable === false, 'read-only sync reports not writable')
assert(blockedResult.results[0].status === 'preview', 'read-only sync keeps the preview status', JSON.stringify(blockedResult.results[0]))
const cssAfterBlocked = await readFile(join(workspace, 'demo', 'app.css'), 'utf8')
assert(!cssAfterBlocked.includes('width: 500px'), 'read-only sync writes nothing')

// 7. Screenshot materialisation writes a real PNG under the workspace.
state.mode = 'workspace-write'
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const shot = await api.saveScreenshot('session-1', 'annotation-1', 'data:image/png;base64,' + pngBytes.toString('base64'))
assert(typeof shot.relativePath === 'string' && shot.relativePath.startsWith('.dsh/nudge/screenshots/'), 'screenshot returns a workspace-relative path', JSON.stringify(shot))
const written = await readFile(join(workspace, shot.relativePath))
assert(written.length > 8 && written.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'screenshot file is a real PNG')

// 8. Unknown session is an explicit failure.
let unknownFailed = false
try {
  await api.sync('missing-session', { url: 'http://127.0.0.1:4173/index.html' }, [styleEdit])
} catch (error) {
  unknownFailed = /not live/.test(String(error && error.message))
}
assert(unknownFailed, 'unknown session is rejected with a clear message')

await rm(workspace, { recursive: true, force: true }).catch(() => {})

if (failures > 0) {
  console.error('\n' + failures + ' host integration failure(s)')
  process.exit(1)
}
console.log('\nhost integration ok')
