/**
 * Workspace versions host-domain test.
 *
 * Mounts the real `lib/index.js` plugin (which imports the real
 * `lib/workspace.js` bundle) against a real temporary git repository and a
 * `fs` service adapter shaped like the Host `ctx.fs`. It exercises every
 * documented `nudge/*` workspace endpoint from docs/workspace-versions.md §3:
 * workspace scan, git log, branch switching (dirty refusal + stash), file
 * restore, commit (selected/all/nothing/hook failure), read-only gating, the
 * static preview server (MIME, HEAD, traversal/dotfile/node_modules/symlink
 * refusals) and the change watcher revision.
 *
 * Plain `node test/workspace-domain.test.mjs`. The fixture repository lives
 * under `test/.tmp-workspace-*` and is removed in `finally`; `previewStop` and
 * the registered `ctx.effect` disposers close every server/watcher so the
 * process terminates on its own.
 */
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { apply } from '../lib/index.js'

const execFileAsync = promisify(execFile)
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
function assertEqual(actual, expected, name) {
  assert(Object.is(actual, expected), name, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}
async function assertThrows(run, pattern, name) {
  try {
    await run()
  } catch (error) {
    const message = String((error && error.message) || error)
    assert(pattern === undefined || pattern.test(message), name, message)
    return
  }
  assert(false, name, 'expected a thrown error')
}

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

async function runGit(args, cwd) {
  return execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
}

async function writeAt(root, relPath, content) {
  const absolute = join(root, ...relPath.split('/'))
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, content, 'utf8')
}

async function readAt(root, relPath) {
  return readFile(join(root, ...relPath.split('/')), 'utf8')
}

/** GET/HEAD/POST probe that sends the raw request path (no client normalisation). */
function httpProbe(port, path, method = 'GET') {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path, method, headers: { connection: 'close' } },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () =>
          resolvePromise({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      },
    )
    request.on('error', rejectPromise)
    request.setTimeout(5000, () => request.destroy(new Error('probe timeout')))
    request.end()
  })
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
    async writeText(target, content, _expected, _signal, policy) {
      if (policy && policy.mode === 'read-only') {
        const error = new Error('read-only')
        error.code = 'EACCES'
        throw error
      }
      await mkdir(dirname(target.path), { recursive: true })
      await writeFile(target.path, content, 'utf8')
      const after = await stat(target.path)
      return { operation: 'update', version: versionOf(after), before: null, after: content }
    },
  }
}

// ----------------------------------------------------------------- fake ctx

function createCtx(fs, cwd, options = {}) {
  const services = new Map()
  const disposers = []
  const state = {
    provided: null,
    typert: null,
    cwd,
    mode: options.mode || 'workspace-write',
    extra: {},
    disposers,
  }
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
    inject(_names, callback) {
      const typert = { register(contribution) { state.typert = contribution } }
      callback({ typert, effect: (fn) => fn() })
    },
    effect(callback) {
      const dispose = typeof callback === 'function' ? callback() : undefined
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose || (() => {})
    },
    on() {
      return () => {}
    },
  }
  return { ctx, state }
}

// ------------------------------------------------------------------ fixture

const INITIAL_HTML = '<!doctype html>\n<html><body><p id="demo">One</p></body></html>\n'

async function makeFixture() {
  const base = await mkdtemp(join(HERE, '.tmp-workspace-'))
  const root = await realpath(base)
  await runGit(['init', '-b', 'main'], root)
  await runGit(['config', 'user.email', 'nudge@example.test'], root)
  await runGit(['config', 'user.name', 'Nudge Test'], root)
  await runGit(['config', 'commit.gpgsign', 'false'], root)
  await runGit(['config', 'core.hooksPath', join(root, '.git', 'hooks')], root)
  await writeAt(root, 'index.html', '<!doctype html>\n<html><body><h1 id="home">Home</h1></body></html>\n')
  await writeAt(root, 'demo/index.html', INITIAL_HTML)
  await writeAt(root, 'demo/pages/card.html', '<!doctype html>\n<html><body><article id="card">Card</article></body></html>\n')
  await writeAt(root, 'demo/app.css', '.demo { color: red; }\n')
  await writeAt(root, '.gitignore', 'node_modules/\ndist/\n.dsh/\n')
  await runGit(['add', '-A'], root)
  await runGit(['commit', '-m', 'feat: demo page'], root)
  await runGit(['branch', 'feat-a'], root)
  const commit1 = (await runGit(['rev-parse', 'HEAD'], root)).stdout.trim()
  // Ignored directories must never show up in the scan.
  await writeAt(root, 'node_modules/pkg/index.html', '<html><body>deps</body></html>')
  await writeAt(root, 'dist/index.html', '<html><body>built</body></html>')
  await writeAt(root, '.dsh/notes.html', '<html><body>hidden</body></html>')
  // Leave one tracked file dirty so the dirty-switch path is exercised.
  await writeAt(root, 'demo/index.html', INITIAL_HTML + '<!-- local edit -->\n')
  return { root, commit1 }
}

// -------------------------------------------------------------------- tests

let fixtureRoot = null
let mounted = null
let secondMounted = null
let api = null

try {
  const fixture = await makeFixture()
  fixtureRoot = fixture.root
  const { root, commit1 } = fixture

  const fs = createFs()
  mounted = createCtx(fs, root)
  apply(mounted.ctx, {
    sourceRoot: '',
    urlRoot: 'http://127.0.0.1:4173',
    maxScanFiles: 100,
    maxFileBytes: 2_000_000,
  })
  api = mounted.state.provided && mounted.state.provided.service
  assert(api !== null && typeof api === 'object', 'apply provides the nudge service')
  assert(mounted.state.provided.name === 'nudge', 'service namespace is nudge')
  assert(mounted.state.typert !== null, 'typert contribution registered')
  assertEqual(mounted.state.typert.invocations.length, 14, 'fourteen remote invocations registered')
  const registeredMethods = mounted.state.typert.invocations.map((entry) => entry.method)
  for (const method of ['workspace', 'gitLog', 'gitSwitch', 'gitRestoreFile', 'gitCommit', 'previewOpen', 'previewStop', 'watchPoll']) {
    assert(registeredMethods.includes(method), 'typert registers workspace method ' + method)
  }

  await assertThrows(() => api.workspace('missing-session'), /not live/, 'unknown session is rejected')

  // A workspace without git reports the documented empty shape.
  const plainRoot = await realpath(await mkdtemp(join(tmpdir(), 'dsh-nudge-plain-')))
  try {
    const plainMounted = createCtx(createFs(), plainRoot)
    apply(plainMounted.ctx, { sourceRoot: '', maxScanFiles: 100, maxFileBytes: 2_000_000 })
    const plain = await plainMounted.state.provided.service.workspace('session-1')
    assertEqual(plain.git.available, false, 'workspace: no repository reports available=false')
    assertEqual(plain.git.error, 'not-a-repository', 'workspace: no repository reports a stable reason')
    assertEqual(plain.git.repoRoot, '', 'workspace: no repository reports an empty repoRoot')
    assertEqual(plain.git.relativeRoot, '', 'workspace: no repository reports an empty relativeRoot')
    assertEqual(plain.git.sourceSubdir, '', 'workspace: no repository reports an empty sourceSubdir')
    assertEqual(plain.git.branch, '', 'workspace: no repository reports an empty branch')
    assertEqual(plain.git.branches.length, 0, 'workspace: no repository reports no branches')
    assertEqual(plain.git.changes.length, 0, 'workspace: no repository reports no changes')
    assertEqual(plain.git.clean, true, 'workspace: no repository reports clean')
    assertEqual(plain.htmlFiles.length, 0, 'workspace: empty directory scans zero html files')
    for (const dispose of plainMounted.state.disposers) await dispose()
  } finally {
    await rm(plainRoot, { recursive: true, force: true }).catch(() => {})
  }

  // A repository whose root is above the session cwd must be treated as
  // unavailable rather than silently widening the working tree.
  let enclosingRepo = false
  try {
    const probe = await runGit(['rev-parse', '--show-toplevel'], HERE)
    enclosingRepo = probe.stdout.trim() !== ''
  } catch {
    enclosingRepo = false
  }
  if (enclosingRepo) {
    const outsideRoot = await realpath(await mkdtemp(join(HERE, '.tmp-outside-')))
    try {
      const outsideMounted = createCtx(createFs(), outsideRoot)
      apply(outsideMounted.ctx, { sourceRoot: '', maxScanFiles: 100, maxFileBytes: 2_000_000 })
      const outside = await outsideMounted.state.provided.service.workspace('session-1')
      assertEqual(outside.git.available, false, 'workspace: a repository above cwd is unavailable')
      assertEqual(outside.git.error, 'outside-workspace', 'workspace: outside repository reason is stable')
      assertEqual(outside.git.sourceSubdir, '', 'workspace: unavailable git reports an empty sourceSubdir')
      for (const dispose of outsideMounted.state.disposers) await dispose()
    } finally {
      await rm(outsideRoot, { recursive: true, force: true }).catch(() => {})
    }
  } else {
    ok('workspace: enclosing-repository case skipped (test checkout is not a git worktree)')
  }

  // ---------------------------------------------------------- 1. workspace

  const snapshot = await api.workspace('session-1')
  assertEqual(snapshot.sessionId, 'session-1', 'workspace: sessionId echoed')
  assertEqual(snapshot.cwd, root, 'workspace: cwd is the session working directory')
  assertEqual(snapshot.sourceRoot, root, 'workspace: sourceRoot defaults to cwd')
  assertEqual(snapshot.writable, true, 'workspace: workspace-write is writable')
  assertEqual(snapshot.truncated, false, 'workspace: scan not truncated under the budget')
  assertEqual(snapshot.git.available, true, 'workspace: real git repository detected')
  assertEqual(snapshot.git.repoRoot, root, 'workspace: repoRoot reported')
  assertEqual(snapshot.git.relativeRoot, '', 'workspace: relativeRoot is empty when repo == sourceRoot')
  assertEqual(snapshot.git.sourceSubdir, '', 'workspace: sourceSubdir is empty when repo == sourceRoot')
  assertEqual(snapshot.git.branch, 'main', 'workspace: current branch reported')
  assertEqual(snapshot.git.detached, false, 'workspace: HEAD is attached')
  assertEqual(snapshot.git.error, null, 'workspace: available git has a null error')
  assertEqual(snapshot.git.clean, false, 'workspace: dirty tree detected')
  const mainBranch = snapshot.git.branches.find((branch) => branch.name === 'main')
  const featureBranch = snapshot.git.branches.find((branch) => branch.name === 'feat-a')
  assert(mainBranch !== undefined && mainBranch.current === true, 'workspace: main is current')
  assert(featureBranch !== undefined && featureBranch.current === false, 'workspace: feat-a is listed as non-current')
  assertEqual(snapshot.git.branches.length, 2, 'workspace: only local branches are listed')
  const dirtyChange = snapshot.git.changes.find((change) => change.path === 'demo/index.html')
  assert(dirtyChange !== undefined, 'workspace: dirty file appears in changes')
  assertEqual(dirtyChange.label, 'modified', 'workspace: dirty file label is modified')
  assertEqual(dirtyChange.index, ' ', 'workspace: unstaged change has an empty index code')
  assertEqual(dirtyChange.worktree, 'M', 'workspace: unstaged change has worktree code M')
  const htmlPaths = snapshot.htmlFiles.map((file) => file.path)
  assertEqual(
    JSON.stringify(htmlPaths),
    JSON.stringify(['demo/index.html', 'demo/pages/card.html', 'index.html']),
    'workspace: htmlFiles are sourceRoot-relative, sorted and skip ignored directories',
  )
  const demoHtml = snapshot.htmlFiles.find((file) => file.path === 'demo/index.html')
  assertEqual(demoHtml.name, 'index.html', 'workspace: htmlFiles[].name')
  assertEqual(demoHtml.dir, 'demo', 'workspace: htmlFiles[].dir')
  assertEqual(demoHtml.change, 'modified', 'workspace: htmlFiles[].change comes from git changes')
  assert(typeof demoHtml.size === 'number' && demoHtml.size > 0, 'workspace: htmlFiles[].size')
  assert(typeof demoHtml.mtime === 'number' && demoHtml.mtime > 0, 'workspace: htmlFiles[].mtime')
  const cleanHtml = snapshot.htmlFiles.find((file) => file.path === 'index.html')
  assertEqual(cleanHtml.change, null, 'workspace: unchanged html file has a null change')
  assertEqual(
    JSON.stringify(snapshot.preview),
    JSON.stringify({ active: false, port: 0, baseUrl: '' }),
    'workspace: preview is inactive before previewOpen',
  )

  // A smaller scan budget must report truncation. The row config clamps
  // maxScanFiles to its documented minimum of 20, so exceed that budget.
  const extraDir = join(root, 'extra')
  await mkdir(extraDir, { recursive: true })
  for (let index = 0; index < 25; index += 1) {
    await writeFile(join(extraDir, 'page-' + String(index).padStart(2, '0') + '.html'), '<html></html>', 'utf8')
  }
  secondMounted = createCtx(createFs(), root)
  apply(secondMounted.ctx, { sourceRoot: '', maxScanFiles: 20, maxFileBytes: 2_000_000 })
  const truncatedSnapshot = await secondMounted.state.provided.service.workspace('session-1')
  assertEqual(truncatedSnapshot.truncated, true, 'workspace: maxScanFiles budget truncates the scan')
  assertEqual(truncatedSnapshot.htmlFiles.length, 20, 'workspace: truncated scan returns the budgeted file count')
  await rm(extraDir, { recursive: true, force: true })

  // -------------------------------------------------------------- 2. gitLog

  const log = await api.gitLog('session-1')
  assertEqual(log.file, '', 'gitLog: omitted file reports an empty file field')
  assertEqual(log.commits.length, 1, 'gitLog: initial commit listed')
  const firstCommit = log.commits[0]
  assert(/^[0-9a-f]{40}$/.test(firstCommit.hash), 'gitLog: full commit hash')
  assert(firstCommit.hash.startsWith(firstCommit.short), 'gitLog: short hash is a prefix')
  assertEqual(firstCommit.author, 'Nudge Test', 'gitLog: author reported')
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)$/.test(firstCommit.date), 'gitLog: ISO-8601 author date', firstCommit.date)
  assertEqual(firstCommit.subject, 'feat: demo page', 'gitLog: subject reported')
  const fileLog = await api.gitLog('session-1', 'demo/index.html')
  assertEqual(fileLog.file, 'demo/index.html', 'gitLog: file echoed')
  assertEqual(fileLog.commits.length, 1, 'gitLog: file history is scoped to the file')
  assertEqual(fileLog.commits[0].hash, firstCommit.hash, 'gitLog: file history returns the same commit')
  await writeAt(root, 'demo/untracked.html', '<html></html>')
  const untrackedLog = await api.gitLog('session-1', 'demo/untracked.html')
  assertEqual(untrackedLog.commits.length, 0, 'gitLog: untracked file has an empty history')
  await rm(join(root, 'demo/untracked.html'), { force: true })
  await assertThrows(() => api.gitLog('session-1', '/etc/passwd'), /relative/, 'gitLog: absolute path is rejected')
  await assertThrows(() => api.gitLog('session-1', '../secret'), /normalised relative/, 'gitLog: traversal path is rejected')

  // ----------------------------------------------------------- 3. gitSwitch

  const dirtySwitch = await api.gitSwitch('session-1', 'feat-a')
  assertEqual(dirtySwitch.ok, false, 'gitSwitch: dirty tree refuses the switch')
  assertEqual(dirtySwitch.reason, 'dirty', 'gitSwitch: dirty refusal reason is stable')
  assertEqual(dirtySwitch.git.branch, 'main', 'gitSwitch: dirty refusal keeps the branch')
  await assertThrows(() => api.gitSwitch('session-1', 'no-such-branch'), /unknown local branch/, 'gitSwitch: branch must be in the local whitelist')

  const stashedSwitch = await api.gitSwitch('session-1', 'feat-a', { stash: true })
  assertEqual(stashedSwitch.ok, true, 'gitSwitch: stash mode switches successfully')
  assertEqual(stashedSwitch.branch, 'feat-a', 'gitSwitch: stash mode reports the target branch')
  assertEqual(stashedSwitch.stashed, true, 'gitSwitch: stash mode reports the stash')
  assertEqual(stashedSwitch.clean, true, 'gitSwitch: stash mode leaves a clean tree')
  assertEqual(stashedSwitch.git.branch, 'feat-a', 'gitSwitch: returned git state is on the target branch')
  assertEqual(await readAt(root, 'demo/index.html'), INITIAL_HTML, 'gitSwitch: stash removed the local edit from the tree')
  const stashList = (await runGit(['stash', 'list'], root)).stdout
  assert(stashList.includes('dsh-nudge: switch to feat-a'), 'gitSwitch: stash entry is named for the switch')

  const backSwitch = await api.gitSwitch('session-1', 'main')
  assertEqual(backSwitch.ok, true, 'gitSwitch: switching back to a clean branch succeeds')
  assertEqual(backSwitch.branch, 'main', 'gitSwitch: back on main')
  assertEqual(backSwitch.stashed, false, 'gitSwitch: clean switch does not stash')
  const sameBranch = await api.gitSwitch('session-1', 'main')
  assertEqual(sameBranch.ok, true, 'gitSwitch: already on the target branch is a success')
  assertEqual(sameBranch.stashed, false, 'gitSwitch: already on the target branch does not stash')
  assertEqual(sameBranch.clean, true, 'gitSwitch: already on the target branch reports the tree state')

  // ------------------------------------------------------ 4. gitRestoreFile

  await writeAt(root, 'demo/index.html', INITIAL_HTML + '<!-- chaos -->\n')
  const restored = await api.gitRestoreFile('session-1', 'demo/index.html', commit1)
  assertEqual(restored.ok, true, 'gitRestoreFile: restore succeeds')
  assertEqual(restored.file, 'demo/index.html', 'gitRestoreFile: file echoed')
  assertEqual(restored.commit, commit1, 'gitRestoreFile: commit echoed')
  assertEqual(restored.status, 'restored', 'gitRestoreFile: status is restored')
  assertEqual(await readAt(root, 'demo/index.html'), INITIAL_HTML, 'gitRestoreFile: working tree file content matches the commit')
  const restoredSnapshot = await api.workspace('session-1')
  assertEqual(restoredSnapshot.git.clean, true, 'gitRestoreFile: tree is clean after restoring HEAD content')
  await assertThrows(() => api.gitRestoreFile('session-1', 'demo/index.html', 'not-a-commit'), /hexadecimal/, 'gitRestoreFile: commit format is validated')
  await assertThrows(() => api.gitRestoreFile('session-1', '../etc/passwd', commit1), /normalised relative/, 'gitRestoreFile: traversal path is rejected')
  await assertThrows(() => api.gitRestoreFile('session-1', '/etc/passwd', commit1), /relative/, 'gitRestoreFile: absolute path is rejected')

  const toFeature = await api.gitSwitch('session-1', 'feat-a')
  assertEqual(toFeature.ok, true, 'gitSwitch: clean switch to feat-a succeeds')
  assertEqual(toFeature.stashed, false, 'gitSwitch: clean switch reports no stash')
  await runGit(['rm', 'demo/app.css'], root)
  await runGit(['commit', '-m', 'chore: drop css'], root)
  const dropCommit = (await runGit(['rev-parse', 'HEAD'], root)).stdout.trim()
  await assertThrows(
    () => api.gitRestoreFile('session-1', 'demo/app.css', dropCommit),
    /does not exist in commit/,
    'gitRestoreFile: missing file in the target commit is rejected',
  )
  const cssRestored = await api.gitRestoreFile('session-1', 'demo/app.css', commit1)
  assertEqual(cssRestored.ok, true, 'gitRestoreFile: restores a file deleted by a later commit')
  assertEqual(await readAt(root, 'demo/app.css'), '.demo { color: red; }\n', 'gitRestoreFile: restored stylesheet content')
  const afterRestoreSnapshot = await api.workspace('session-1')
  assertEqual(afterRestoreSnapshot.git.branch, 'feat-a', 'gitRestoreFile: branch pointer is unchanged')
  const branchTip = (await runGit(['rev-parse', 'feat-a'], root)).stdout.trim()
  assertEqual(branchTip, dropCommit, 'gitRestoreFile: does not move the branch pointer')
  const cssChange = afterRestoreSnapshot.git.changes.find((change) => change.path === 'demo/app.css')
  assert(cssChange !== undefined && cssChange.label === 'added', 'gitRestoreFile: restored file shows as an added change')

  // ----------------------------------------------------------- 5. gitCommit

  const restoredCommit = await api.gitCommit('session-1', 'chore: restore stylesheet')
  assertEqual(restoredCommit.ok, true, 'gitCommit: commits the restored stylesheet')
  assertEqual(restoredCommit.committed, true, 'gitCommit: restored stylesheet committed')
  assertEqual(restoredCommit.git.clean, true, 'gitCommit: tree is clean after the restore commit')

  await assertThrows(() => api.gitCommit('session-1', '   '), /commit message/, 'gitCommit: blank message is rejected')
  const nothing = await api.gitCommit('session-1', 'nothing here')
  assertEqual(nothing.ok, true, 'gitCommit: nothing-to-commit is a state, not an error')
  assertEqual(nothing.committed, false, 'gitCommit: nothing committed')
  assertEqual(nothing.reason, 'nothing-to-commit', 'gitCommit: nothing-to-commit reason')

  await writeAt(root, 'demo/index.html', INITIAL_HTML + '<!-- selected -->\n')
  await writeAt(root, 'demo/new.html', '<!doctype html>\n<html><body><p id="new">New</p></body></html>\n')
  await assertThrows(
    () => api.gitCommit('session-1', 'bad selection', ['demo/nope.html']),
    /no pending change/,
    'gitCommit: unknown selected path is rejected',
  )
  const selected = await api.gitCommit('session-1', 'feat: selected file', ['demo/index.html'])
  assertEqual(selected.ok, true, 'gitCommit: selected-file commit succeeds')
  assertEqual(selected.committed, true, 'gitCommit: selected-file commit committed')
  assert(/^[0-9a-f]{40}$/.test(selected.commit.hash), 'gitCommit: commit hash returned')
  assert(selected.commit.hash.startsWith(selected.commit.short), 'gitCommit: commit short hash returned')
  assertEqual(selected.commit.subject, 'feat: selected file', 'gitCommit: commit subject returned')
  assertEqual(selected.git.clean, false, 'gitCommit: unselected untracked file keeps the tree dirty')
  const selectedFiles = (await runGit(['show', '--pretty=format:', '--name-only', 'HEAD'], root)).stdout
  assert(selectedFiles.includes('demo/index.html'), 'gitCommit: selected file is in the commit')
  assert(!selectedFiles.includes('demo/new.html'), 'gitCommit: unselected file is not in the commit')
  const selectedLog = await api.gitLog('session-1')
  assertEqual(selectedLog.commits[0].subject, 'feat: selected file', 'gitCommit: git log confirms the selected commit')

  const newFileCommit = await api.gitCommit('session-1', 'feat: add new page', ['demo/new.html'])
  assertEqual(newFileCommit.ok, true, 'gitCommit: second selected-file commit succeeds')
  assertEqual(newFileCommit.git.clean, true, 'gitCommit: tree is clean after committing the untracked file')

  await writeAt(root, 'demo/index.html', INITIAL_HTML + '<!-- all -->\n')
  await writeAt(root, 'demo/new.html', '<!doctype html>\n<html><body><p id="new">New v2</p></body></html>\n')
  const allCommit = await api.gitCommit('session-1', 'chore: commit everything')
  assertEqual(allCommit.ok, true, 'gitCommit: all-changes commit succeeds')
  assertEqual(allCommit.committed, true, 'gitCommit: all-changes commit committed')
  assertEqual(allCommit.git.clean, true, 'gitCommit: tree is clean after add -A commit')
  assertEqual(allCommit.commit.subject, 'chore: commit everything', 'gitCommit: all-changes subject')
  const everythingLog = await api.gitLog('session-1')
  assert(everythingLog.commits.length >= 6, 'gitCommit: git log shows the full commit history')

  await writeAt(root, 'demo/index.html', INITIAL_HTML + '<!-- long message -->\n')
  const longMessage = await api.gitCommit('session-1', 'x'.repeat(4100))
  assertEqual(longMessage.committed, true, 'gitCommit: oversized message is still committed')
  assertEqual(longMessage.commit.subject.length, 4000, 'gitCommit: oversized message is truncated to 4000 characters')

  // Hook failure: the hook runs (no --no-verify) and its stderr is surfaced.
  const hookPath = join(root, '.git', 'hooks', 'pre-commit')
  await writeFile(hookPath, '#!/bin/sh\necho "hook says no" 1>&2\nexit 1\n', 'utf8')
  await chmod(hookPath, 0o755)
  await writeAt(root, 'demo/index.html', INITIAL_HTML + '<!-- hooked -->\n')
  await assertThrows(() => api.gitCommit('session-1', 'feat: hooked'), /hook says no/, 'gitCommit: failing hook surfaces its stderr')
  await rm(hookPath, { force: true })
  const afterHook = await api.gitCommit('session-1', 'chore: after hook')
  assertEqual(afterHook.committed, true, 'gitCommit: commit succeeds once the hook is removed')

  // ------------------------------------------------------------ 6. read-only

  mounted.state.mode = 'read-only'
  const readOnlySnapshot = await api.workspace('session-1')
  assertEqual(readOnlySnapshot.writable, false, 'read-only: workspace reports not writable')
  assertEqual(readOnlySnapshot.git.available, true, 'read-only: git facts stay readable')
  assert((await api.gitLog('session-1')).commits.length > 0, 'read-only: gitLog is allowed')
  await assertThrows(() => api.gitSwitch('session-1', 'main'), /read-only/, 'read-only: gitSwitch is refused')
  await assertThrows(() => api.gitRestoreFile('session-1', 'demo/index.html', commit1), /read-only/, 'read-only: gitRestoreFile is refused')
  await assertThrows(() => api.gitCommit('session-1', 'read-only commit'), /read-only/, 'read-only: gitCommit is refused')
  const readOnlyPreview = await api.previewOpen('session-1', 'index.html')
  assertEqual(readOnlyPreview.ok, true, 'read-only: previewOpen is allowed')
  const readOnlyPoll = await api.watchPoll('session-1')
  assertEqual(readOnlyPoll.watching, true, 'read-only: watchPoll is allowed')
  await api.previewStop('session-1')
  mounted.state.mode = 'workspace-write'

  // ------------------------------------------------------------- 7. watcher

  const pollBaseline = await api.watchPoll('session-1')
  assertEqual(pollBaseline.revision, 0, 'watchPoll: a fresh watcher starts at revision 0')
  assertEqual(pollBaseline.root, root, 'watchPoll: root reported')
  assertEqual(pollBaseline.watching, true, 'watchPoll: watcher is running')
  assertEqual(pollBaseline.changed.length, 0, 'watchPoll: no changes before any write')

  await writeAt(root, 'demo/index.html', INITIAL_HTML + '<!-- watched -->\n')
  await sleep(450)
  const pollAfterWrite = await api.watchPoll('session-1')
  assert(pollAfterWrite.revision >= 1, 'watchPoll: revision increments after a file change', String(pollAfterWrite.revision))
  assert(
    pollAfterWrite.changed.some((entry) => entry.path === 'demo/index.html'),
    'watchPoll: changed list names the modified file',
    JSON.stringify(pollAfterWrite.changed),
  )
  assert(typeof pollAfterWrite.changed[0].at === 'number', 'watchPoll: changed entries carry a timestamp')

  const pollAgain = await api.watchPoll('session-1')
  assertEqual(pollAgain.revision, pollAfterWrite.revision, 'watchPoll: polling does not reset the revision')
  assertEqual(pollAgain.changed.length, pollAfterWrite.changed.length, 'watchPoll: changed list is not drained by polling')

  await Promise.all(
    Array.from({ length: 10 }, (_value, index) =>
      writeAt(root, 'demo/watch-' + index + '.html', '<html><body>w' + index + '</body></html>'),
    ),
  )
  await sleep(550)
  const pollAfterBatch = await api.watchPoll('session-1')
  assert(pollAfterBatch.revision > pollAfterWrite.revision, 'watchPoll: debounced batch increments the revision')
  assert(pollAfterBatch.changed.length <= 8, 'watchPoll: changed list keeps at most 8 entries')
  assert(pollAfterBatch.changed.length > 0, 'watchPoll: batch records changed paths')

  const revisionBeforeIgnored = pollAfterBatch.revision
  await writeAt(root, '.dsh/probe.txt', 'ignored')
  await sleep(350)
  const pollAfterIgnored = await api.watchPoll('session-1')
  assertEqual(pollAfterIgnored.revision, revisionBeforeIgnored, 'watchPoll: ignored directories do not bump the revision')

  const stoppedWatcher = await api.previewStop('session-1')
  assertEqual(stoppedWatcher.ok, true, 'previewStop: stops the watcher (and keeps the shape)')
  assertEqual(stoppedWatcher.root, root, 'previewStop: root echoed')

  // ------------------------------------------------------------- 8. preview

  const preview = await api.previewOpen('session-1', 'demo/index.html')
  assertEqual(preview.ok, true, 'previewOpen: starts a server')
  assert(typeof preview.port === 'number' && preview.port > 0, 'previewOpen: ephemeral port assigned')
  assertEqual(preview.baseUrl, 'http://127.0.0.1:' + preview.port + '/', 'previewOpen: baseUrl shape')
  assertEqual(preview.url, preview.baseUrl + 'demo/index.html', 'previewOpen: file URL shape')
  assertEqual(preview.file, 'demo/index.html', 'previewOpen: file echoed')
  assertEqual(preview.root, root, 'previewOpen: root echoed')

  const previewReuse = await api.previewOpen('session-1')
  assertEqual(previewReuse.port, preview.port, 'previewOpen: the same root reuses the same server')
  assertEqual(previewReuse.url, preview.baseUrl, 'previewOpen: omitted file returns the base URL')
  assertEqual(previewReuse.file, '', 'previewOpen: omitted file reports an empty file field')

  const previewSnapshot = await api.workspace('session-1')
  assertEqual(previewSnapshot.preview.active, true, 'workspace: preview reports active after previewOpen')
  assertEqual(previewSnapshot.preview.port, preview.port, 'workspace: preview reports the port')
  assertEqual(previewSnapshot.preview.baseUrl, preview.baseUrl, 'workspace: preview reports the base URL')

  const pageResponse = await httpProbe(preview.port, '/demo/index.html')
  assertEqual(pageResponse.status, 200, 'preview: serves an HTML page')
  assert(String(pageResponse.headers['content-type']).startsWith('text/html'), 'preview: HTML content type', pageResponse.headers['content-type'])
  assertEqual(pageResponse.headers['cache-control'], 'no-store', 'preview: Cache-Control is no-store')
  assert(pageResponse.body.includes('id="demo"'), 'preview: serves the real file content')

  const headResponse = await httpProbe(preview.port, '/demo/index.html', 'HEAD')
  assertEqual(headResponse.status, 200, 'preview: HEAD is allowed')
  assertEqual(headResponse.body, '', 'preview: HEAD returns no body')
  assert(Number(headResponse.headers['content-length']) > 0, 'preview: HEAD keeps the content length')

  const rootResponse = await httpProbe(preview.port, '/')
  assertEqual(rootResponse.status, 200, 'preview: / falls back to the root index.html')
  assert(rootResponse.body.includes('id="home"'), 'preview: / serves the root index.html content')

  const directoryResponse = await httpProbe(preview.port, '/demo/')
  assertEqual(directoryResponse.status, 200, 'preview: directory requests fall back to index.html')
  assert(directoryResponse.body.includes('id="demo"'), 'preview: directory index content served')

  const cssResponse = await httpProbe(preview.port, '/demo/app.css')
  assertEqual(cssResponse.status, 200, 'preview: serves stylesheets')
  assert(String(cssResponse.headers['content-type']).startsWith('text/css'), 'preview: CSS content type')
  assert(cssResponse.body.includes('.demo'), 'preview: stylesheet content served')

  assertEqual((await httpProbe(preview.port, '/missing.html')).status, 404, 'preview: missing file returns 404')
  assertEqual(
    (await httpProbe(preview.port, '/%2e%2e/%2e%2e/etc/passwd')).status,
    403,
    'preview: encoded directory traversal is refused',
  )
  assertEqual((await httpProbe(preview.port, '/.git/config')).status, 403, 'preview: .git segments are refused')
  assertEqual((await httpProbe(preview.port, '/node_modules/pkg/index.html')).status, 403, 'preview: node_modules segments are refused')
  assertEqual((await httpProbe(preview.port, '/.dsh/notes.html')).status, 403, 'preview: dotfile segments are refused')
  assertEqual((await httpProbe(preview.port, '/demo/index.html', 'POST')).status, 405, 'preview: only GET/HEAD are allowed')

  await symlink('/etc/passwd', join(root, 'escape-link'))
  assertEqual((await httpProbe(preview.port, '/escape-link')).status, 403, 'preview: symlink escape is refused')

  const previewStopped = await api.previewStop('session-1')
  assertEqual(previewStopped.ok, true, 'previewStop: stops the preview server')
  assertEqual(previewStopped.root, root, 'previewStop: root echoed')
  const previewSnapshotStopped = await api.workspace('session-1')
  assertEqual(previewSnapshotStopped.preview.active, false, 'workspace: preview reports inactive after previewStop')
  let connectionRefused = false
  try {
    await httpProbe(preview.port, '/demo/index.html')
  } catch {
    connectionRefused = true
  }
  assert(connectionRefused, 'previewStop: the old port no longer answers')
  const stopAgain = await api.previewStop('session-1')
  assertEqual(stopAgain.ok, true, 'previewStop: is idempotent')

  // ------------------------------------------------------- 9. rename labels

  await runGit(['mv', 'demo/app.css', 'demo/renamed.css'], root)
  const renamedSnapshot = await api.workspace('session-1')
  const renamedChange = renamedSnapshot.git.changes.find((change) => change.label === 'renamed')
  assert(renamedChange !== undefined, 'workspace: renamed files are labelled renamed')
  assertEqual(renamedChange.path, 'demo/renamed.css', 'workspace: rename reports the new path')
  assertEqual(renamedChange.from, 'demo/app.css', 'workspace: rename reports the original path')

  // -------------------------------------- 10. sourceRoot inside the repository
  //
  // The common HTML-prototype setup: cwd is the repository root, but the
  // configured sourceRoot points at a subdirectory (here `demo`). All API paths
  // stay sourceRoot-relative, changes outside sourceRoot are filtered out, and
  // git operations map back to repository paths through `sourceSubdir`.

  const subBase = await realpath(await mkdtemp(join(HERE, '.tmp-subroot-')))
  let subMounted = null
  let subApi = null
  try {
    await runGit(['init', '-b', 'main'], subBase)
    await runGit(['config', 'user.email', 'nudge@example.test'], subBase)
    await runGit(['config', 'user.name', 'Nudge Test'], subBase)
    await runGit(['config', 'commit.gpgsign', 'false'], subBase)
    await runGit(['config', 'core.hooksPath', join(subBase, '.git', 'hooks')], subBase)
    const subInitial = '<!doctype html>\n<html><body><p id="sub">Sub</p></body></html>\n'
    const subDirty = '<!doctype html>\n<html><body><p id="sub">Sub dirty</p></body></html>\n'
    const subBroken = '<!doctype html>\n<html><body><p id="sub">Sub broken</p></body></html>\n'
    await writeAt(subBase, 'demo/index.html', subInitial)
    await writeAt(subBase, 'demo/pages/card.html', '<!doctype html>\n<html><body><article id="card">Card</article></body></html>\n')
    await writeAt(subBase, 'demo/app.css', '.sub { color: blue; }\n')
    await writeAt(subBase, 'README.md', '# Outside sourceRoot\n')
    await runGit(['add', '-A'], subBase)
    await runGit(['commit', '-m', 'feat: subroot demo'], subBase)
    await runGit(['branch', 'feat-a'], subBase)
    const subInitialCommit = (await runGit(['rev-parse', 'HEAD'], subBase)).stdout.trim()
    // One dirty file inside sourceRoot and one outside it: the outside change
    // must be filtered out of the panel.
    await writeAt(subBase, 'demo/index.html', subDirty)
    await writeAt(subBase, 'README.md', '# Outside sourceRoot (dirty)\n')

    subMounted = createCtx(createFs(), subBase)
    apply(subMounted.ctx, { sourceRoot: 'demo', urlRoot: '', maxScanFiles: 100, maxFileBytes: 2_000_000 })
    subApi = subMounted.state.provided.service

    const subSnapshot = await subApi.workspace('session-1')
    assertEqual(subSnapshot.cwd, subBase, 'subroot: cwd is the repository root')
    assertEqual(subSnapshot.sourceRoot, join(subBase, 'demo'), 'subroot: sourceRoot is the configured subdirectory')
    assertEqual(subSnapshot.git.available, true, 'subroot: git stays available for a repo subdirectory sourceRoot')
    assertEqual(subSnapshot.git.repoRoot, subBase, 'subroot: repoRoot is the enclosing repository')
    assertEqual(subSnapshot.git.relativeRoot, '', 'subroot: relativeRoot is empty for the ancestor case')
    assertEqual(subSnapshot.git.sourceSubdir, 'demo', 'subroot: sourceSubdir reports sourceRoot inside repoRoot')
    assertEqual(subSnapshot.git.branch, 'main', 'subroot: branches work')
    assertEqual(subSnapshot.git.branches.length, 2, 'subroot: local branches are listed')
    assertEqual(subSnapshot.git.clean, false, 'subroot: dirty file inside sourceRoot is reported')
    assertEqual(subSnapshot.git.changes.length, 1, 'subroot: changes outside sourceRoot are filtered out')
    const subChange = subSnapshot.git.changes[0]
    assertEqual(subChange.path, 'index.html', 'subroot: changes paths are sourceRoot-relative (no demo/ prefix)')
    assertEqual(subChange.label, 'modified', 'subroot: change label is modified')
    assertEqual(
      JSON.stringify(subSnapshot.htmlFiles.map((file) => file.path)),
      JSON.stringify(['index.html', 'pages/card.html']),
      'subroot: HTML scan lists sourceRoot files relative to sourceRoot',
    )
    assertEqual(subSnapshot.htmlFiles[0].change, 'modified', 'subroot: htmlFiles change label comes from the filtered changes')

    const subLog = await subApi.gitLog('session-1', 'index.html')
    assertEqual(subLog.file, 'index.html', 'subroot: gitLog echoes the sourceRoot-relative file')
    assertEqual(subLog.commits.length, 1, 'subroot: gitLog maps the file into the repository')
    assertEqual(subLog.commits[0].hash, subInitialCommit, 'subroot: gitLog returns the mapped file history')
    assertEqual((await subApi.gitLog('session-1')).commits.length, 1, 'subroot: repo-wide gitLog works')

    await assertThrows(
      () => subApi.gitCommit('session-1', 'bad selection', ['README.md']),
      /no pending change/,
      'subroot: paths outside sourceRoot cannot be committed individually',
    )
    const subCommit = await subApi.gitCommit('session-1', 'feat: sub index', ['index.html'])
    assertEqual(subCommit.ok, true, 'subroot: selected-file commit succeeds')
    assertEqual(subCommit.committed, true, 'subroot: selected-file commit committed')
    assertEqual(subCommit.commit.subject, 'feat: sub index', 'subroot: selected-file commit subject')
    assertEqual(subCommit.git.sourceSubdir, 'demo', 'subroot: commit response keeps sourceSubdir')
    assertEqual(subCommit.git.clean, true, 'subroot: outside-sourceRoot dirt is filtered from the clean flag')
    assertEqual(subCommit.git.changes.length, 0, 'subroot: no changes remain inside sourceRoot')
    const subShow = (await runGit(['show', '--pretty=format:', '--name-only', 'HEAD'], subBase)).stdout
    assert(subShow.includes('demo/index.html'), 'subroot: commit stages the mapped repository path')
    assert(!subShow.includes('README.md'), 'subroot: selected commit leaves outside-sourceRoot files unstaged')

    const subSwitch = await subApi.gitSwitch('session-1', 'feat-a')
    assertEqual(subSwitch.ok, true, 'subroot: branch switching works (outside dirt does not block)')
    assertEqual(subSwitch.git.sourceSubdir, 'demo', 'subroot: gitSwitch response keeps sourceSubdir')
    const subBack = await subApi.gitSwitch('session-1', 'main')
    assertEqual(subBack.ok, true, 'subroot: switching back works')

    await writeAt(subBase, 'demo/index.html', subBroken)
    const subRestored = await subApi.gitRestoreFile('session-1', 'index.html', subInitialCommit)
    assertEqual(subRestored.ok, true, 'subroot: file restore succeeds through the mapping')
    assertEqual(subRestored.file, 'index.html', 'subroot: restore echoes the sourceRoot-relative file')
    assertEqual(await readAt(subBase, 'demo/index.html'), subInitial, 'subroot: restore writes the mapped repository file')

    // Omitted `files` stays repository-wide `git add -A` per the contract.
    const subAll = await subApi.gitCommit('session-1', 'chore: subroot everything')
    assertEqual(subAll.committed, true, 'subroot: repo-wide add -A commit succeeds')
    const subAllShow = (await runGit(['show', '--pretty=format:', '--name-only', 'HEAD'], subBase)).stdout
    assert(subAllShow.includes('README.md'), 'subroot: omitted files commits repository-wide changes')
    assertEqual(subAll.git.clean, true, 'subroot: sourceRoot view is clean after the repo-wide commit')

    const subPreview = await subApi.previewOpen('session-1', 'index.html')
    assertEqual(subPreview.root, join(subBase, 'demo'), 'subroot: preview root is sourceRoot, not the repo root')
    assertEqual(subPreview.url, subPreview.baseUrl + 'index.html', 'subroot: preview URL is sourceRoot-relative')
    const subPage = await httpProbe(subPreview.port, '/index.html')
    assertEqual(subPage.status, 200, 'subroot: preview serves the mapped page')
    assert(subPage.body.includes('id="sub"'), 'subroot: preview serves the restored content')
    await subApi.previewStop('session-1')
  } finally {
    if (subApi !== null) {
      try {
        await subApi.previewStop('session-1')
      } catch {
        /* already stopped or torn down */
      }
    }
    if (subMounted !== null) {
      for (const dispose of subMounted.state.disposers) {
        try {
          await dispose()
        } catch {
          /* best effort teardown */
        }
      }
    }
    await rm(subBase, { recursive: true, force: true }).catch(() => {})
  }
} catch (error) {
  failures += 1
  console.error('FAIL - unexpected error — ' + ((error && error.stack) || error))
} finally {
  if (api !== null) {
    try {
      await api.previewStop('session-1')
    } catch {
      /* the fixture may already be torn down */
    }
  }
  for (const mountedState of [mounted, secondMounted]) {
    if (mountedState === null || mountedState === undefined) continue
    for (const dispose of mountedState.state.disposers) {
      try {
        await dispose()
      } catch {
        /* best effort teardown */
      }
    }
  }
  if (fixtureRoot !== null) await rm(fixtureRoot, { recursive: true, force: true }).catch(() => {})
}

if (failures > 0) {
  console.error('\n' + failures + ' workspace domain failure(s)')
  process.exit(1)
}
console.log('\nworkspace domain ok')
