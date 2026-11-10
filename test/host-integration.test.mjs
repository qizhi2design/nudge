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
assert(state.typert.invocations.length === 17, 'seventeen remote invocations registered')

const pong = await api.ping()
assert(
  pong && pong.ok === true && Array.isArray(pong.capabilities) && pong.capabilities.indexOf('insert') !== -1 && pong.capabilities.indexOf('handle') !== -1,
  'ping advertises Host capabilities so the Client can detect a stale Host half',
)

const facts = await api.session('session-1')
assert(facts.cwd === workspace, 'session endpoint resolves the workspace cwd')
assert(facts.writable === true, 'workspace-write modes report writable')
assert(facts.sourceRoot === workspace, 'default sourceRoot is the session cwd')

// 0. Settings page bridge: product preferences live in the profile config row.
const readOnlySnapshot = await api.config()
assert(readOnlySnapshot.writable === false, 'config snapshot is read-only without a config editor')
assert(readOnlySnapshot.values.language === 'auto', 'config snapshot reports the default language')
assert(readOnlySnapshot.values.enableAnnotate === true, 'config snapshot reports the feature defaults')
assert(!Object.prototype.hasOwnProperty.call(readOnlySnapshot.values, 'sourceRoot'), 'settings snapshot hides the internal mapping fields')
assert(
  Object.keys(readOnlySnapshot.defaults).sort().join(',') ===
    ['contextMenuLink', 'contextMenuTab', 'enableAnnotate', 'enableDomTree', 'enableEdit', 'enableFloatingComposer', 'enableHotReload', 'enableWorkspaceVersions', 'language'].sort().join(','),
  'config snapshot reports the product defaults',
)

const entry = {
  options: {
    id: 'nudge',
    name: 'dsh.nudge',
    config: { language: 'zh', enableAnnotate: false, urlRoot: 'http://127.0.0.1:4173' },
  },
}
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
assert(writableSnapshot.values.language === 'zh', 'config snapshot reflects the overridden language')
assert(writableSnapshot.values.enableAnnotate === false, 'config snapshot reflects the overridden feature switch')
assert(
  writableSnapshot.overridden.includes('language') && writableSnapshot.overridden.includes('enableAnnotate'),
  'config snapshot names the overridden product fields',
)
assert(!writableSnapshot.overridden.includes('urlRoot'), 'internal mapping fields are not reported as product overrides')

const saved = await api.configUpdate({ enableEdit: false, language: 'en' })
assert(saved.saved === true && saved.values.enableEdit === false, 'configUpdate reports the accepted feature switch')
assert(saved.values.language === 'en', 'configUpdate reports the accepted language')
assert(writes.length === 1 && writes[0].enableEdit === false, 'configUpdate writes the feature switch')
assert(writes[0].language === 'en', 'configUpdate writes the language')
assert(!Object.prototype.hasOwnProperty.call(writes[0], 'sourceRoot'), 'configUpdate leaves internal fields out of the patch')
const afterSave = await api.config()
assert(afterSave.values.enableEdit === false, 'config snapshot reflects the written feature switch')
assert(afterSave.overridden.includes('enableEdit'), 'config snapshot lists the newly overridden switch')

const ignored = await api.configUpdate({ foreign: 'value', urlRoot: 'https://example.test/' })
assert(ignored.saved === false, 'configUpdate ignores unknown and internal fields')
assert(writes.length === 1, 'unknown fields never reach the profile patch')
assert(writes[0].urlRoot === 'http://127.0.0.1:4173', 'internal mapping config is preserved untouched')

const clampedLanguage = await api.configUpdate({ language: 'xx' })
assert(clampedLanguage.values.language === 'auto', 'invalid language falls back to auto')
const invalidBoolean = await api.configUpdate({ enableHotReload: 'no' })
assert(invalidBoolean.values.enableHotReload === true, 'invalid booleans fall back to the default')
const resetPatch = {
  language: 'auto',
  enableAnnotate: true,
  enableEdit: true,
  enableDomTree: true,
  enableWorkspaceVersions: true,
  enableHotReload: true,
  contextMenuLink: true,
  contextMenuTab: true,
}
const defaults = await api.configUpdate(resetPatch)
assert(defaults.saved === true, 'configUpdate accepts the product defaults patch')

// 0b. About & update snapshot: package/build/git facts, honest update check.
const about = await api.about(false)
assert(about.name === 'dsh.nudge', 'about reports the package name')
assert(typeof about.version === 'string' && about.version.length > 0, 'about reports the package version', about.version)
assert(typeof about.pluginRoot === 'string' && about.pluginRoot.endsWith('plugin'), 'about reports the plugin root', about.pluginRoot)
assert(Array.isArray(about.builds) && about.builds.some((build) => build.name === 'client.js'), 'about reports the built client artifact')
assert(about.git !== null && typeof about.git === 'object', 'about reports git facts')
if (about.git.available === true) {
  assert(typeof about.git.branch === 'string' && about.git.branch.length > 0, 'about reports the git branch')
  assert(typeof about.git.commit === 'string' && about.git.commit.length > 0, 'about reports the short commit')
}
assert(about.update.status === 'unchecked', 'about skips the update check unless asked')
assert(typeof about.runtime.node === 'string', 'about reports the runtime node version')
state.extra.pluginManager = {
  async listVersions() {
    return { status: 'listed', installed: about.version, registry: 'npm', versions: [{ version: '9.9.9' }], attempts: [] }
  },
}
const checked = await api.about(true)
assert(checked.update.status === 'available', 'about reports an available published version')
assert(checked.update.latest === '9.9.9', 'about reports the newest published version')
delete state.extra.pluginManager
const unavailable = await api.about(true)
assert(unavailable.update.status === 'unavailable', 'about reports the update check as unavailable without a plugin manager')

// 0c. One-click update: only the plugin manager is asked; failures stay data.
const noManager = await api.update('9.9.9')
assert(noManager.status === 'failed', 'update without a plugin manager fails instead of throwing')
assert(typeof noManager.message === 'string' && noManager.message.length > 0, 'update failure keeps a readable message')
state.extra.pluginManager = {
  async listVersions() {
    return { status: 'listed', installed: about.version, registry: 'npm', versions: [{ version: '9.9.9' }], attempts: [] }
  },
  async updateBundle(packageName, version, options) {
    assert(packageName === 'dsh.nudge', 'updateBundle receives the plugin package name')
    assert(typeof options?.requestId === 'string' && options.requestId.length > 0, 'updateBundle receives a request id')
    return {
      from: about.version,
      to: version,
      step: 'install',
      result: { changed: true, application: 'restart-required', stage: 'install', target: packageName },
    }
  },
}
const updated = await api.update('9.9.9')
assert(updated.status === 'restart-required', 'update reports a restart-required success')
assert(updated.to === '9.9.9' && updated.restart === true, 'update reports the installed version and restart flag')
const afterUpdate = await api.about(false)
assert(afterUpdate.update.status === 'current', 'about reads the post-update current snapshot')
state.extra.pluginManager.updateBundle = async () => ({
  from: '9.9.9',
  to: '9.9.10',
  step: 'check',
  result: {
    changed: false,
    application: 'failed',
    stage: 'install',
    target: 'dsh.nudge',
    error: { code: 'invalid-spec', diagnostic: 'dsh.nudge@9.9.10 declares no dsh.bundle' },
  },
})
const refused = await api.update('9.9.10')
assert(refused.status === 'failed', 'a refused update is reported as failed data')
assert(refused.message.includes('declares no dsh.bundle'), 'a refused update keeps the manager diagnostic', refused.message)
state.extra.pluginManager.updateBundle = async () => ({
  from: '9.9.9',
  to: '9.9.11',
  step: 'install',
  result: { changed: true, application: 'applied', stage: 'install', target: 'dsh.nudge' },
})
const applied = await api.update('9.9.11')
assert(applied.status === 'updated', 'an HMR-applied update reports updated')
assert(applied.restart === false, 'an HMR-applied update does not ask for a restart')

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
