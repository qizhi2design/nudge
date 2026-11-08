/**
 * Workspace versions end-to-end test.
 *
 * Drives the real `lib/index.js` plugin exactly the way the Client panel does,
 * against a real temporary git repository:
 *
 *   workspace → previewOpen → HTTP GET the served page → edit the file on disk
 *   → watchPoll sees a new revision (hot-reload signal) → GET serves the new
 *   bytes → gitCommit → gitLog/status confirm → branch switch (clean, dirty
 *   refusal, stash) → file version restore → read-only refusal → previewStop.
 *
 * This is the cross-half proof: the Host shapes are what `src/client/domains/
 * workspace/git-store.ts` sends, and the static server + watcher are the parts
 * the webview hot-reload loop depends on. Run: `node test/workspace-e2e.test.mjs`.
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { apply } from '../lib/index.js'

const execFileAsync = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)

const ORIGINAL_HTML = [
  '<!doctype html>',
  '<html lang="en">',
  '<head><meta charset="utf-8"><title>E2E Workspace</title></head>',
  '<body><main id="app"><h1 class="hero">E2E Original Hero</h1></main></body>',
  '</html>',
  '',
].join('\n')

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

async function gitText(args, cwd) {
  const result = await runGit(args, cwd)
  return String(result.stdout || '').trim()
}

async function writeAt(root, relPath, content) {
  const absolute = join(root, ...relPath.split('/'))
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, content, 'utf8')
}

async function readAt(root, relPath) {
  return readFile(join(root, ...relPath.split('/')), 'utf8')
}

/** Real HTTP GET; the page webview only ever loads HTTP(S), like this probe. */
function httpGet(url) {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = httpRequest(url, { headers: { connection: 'close' } }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () =>
        resolvePromise({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }),
      )
    })
    request.on('error', rejectPromise)
    request.setTimeout(5000, () => request.destroy(new Error('http timeout')))
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
    async writeText(target, content) {
      await mkdir(dirname(target.path), { recursive: true })
      await writeFile(target.path, content, 'utf8')
      return { operation: 'update', version: versionOf(await stat(target.path)), before: null, after: content }
    },
  }
}

// ----------------------------------------------------------------- fake ctx

function createCtx(fs, cwd, options = {}) {
  const services = new Map()
  const disposers = []
  const state = {
    provided: null,
    cwd,
    mode: options.mode || 'workspace-write',
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
      return services.get(name) ?? undefined
    },
    provide(name, service) {
      services.set(name, service)
      state.provided = { name, service }
    },
    inject(_names, callback) {
      callback({ typert: { register() {} }, effect: (fn) => fn() })
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

// ------------------------------------------------------------------- fixture

const workspace = await mkdtemp(join(ROOT, 'test', '.tmp-e2e-'))
const fs = createFs()
const { ctx, state } = createCtx(fs, workspace)
let defaultBranch = 'main'
let initialCommit = ''
let previewPort = 0
let api = null

try {
  // A committed static page plus a stylesheet, like a real prototype folder.
  await writeAt(workspace, 'demo/index.html', ORIGINAL_HTML)
  await writeAt(workspace, 'demo/app.css', '.hero { color: rgb(20, 24, 34); }\n')
  await writeAt(workspace, 'README.md', '# e2e\n')
  await runGit(['init', '-q'], workspace)
  await runGit(['config', 'user.name', 'E2E Test'], workspace)
  await runGit(['config', 'user.email', 'e2e@example.com'], workspace)
  await runGit(['config', 'commit.gpgsign', 'false'], workspace)
  await runGit(['add', '-A'], workspace)
  await runGit(['commit', '-q', '-m', 'chore: e2e initial page'], workspace)
  defaultBranch = await gitText(['rev-parse', '--abbrev-ref', 'HEAD'], workspace)
  initialCommit = await gitText(['rev-parse', 'HEAD'], workspace)

  apply(ctx, { sourceRoot: '', urlRoot: '', maxScanFiles: 100, maxFileBytes: 2000000 })
  api = state.provided.service
  assert(state.provided.name === 'nudge', 'host half provides the nudge service')

  // 1. The panel's first call: one snapshot drives the whole workspace tab.
  const snapshot = await api.workspace('session-1')
  assertEqual(snapshot.cwd, workspace, 'workspace snapshot resolves the session cwd')
  assertEqual(snapshot.sourceRoot, workspace, 'workspace snapshot resolves the source root')
  assertEqual(snapshot.writable, true, 'workspace-write sessions are writable')
  assert(snapshot.git && snapshot.git.available === true, 'git repository is detected')
  assertEqual(snapshot.git.branch, defaultBranch, 'current branch is reported')
  assertEqual(snapshot.git.clean, true, 'fresh repository is clean')
  assertEqual(snapshot.git.relativeRoot, '', 'default sourceRoot equals the repository root')
  assert(
    snapshot.htmlFiles.some((file) => file.path === 'demo/index.html' && file.name === 'index.html' && file.dir === 'demo'),
    'HTML scan lists the nested page with a sourceRoot-relative path',
  )
  assertEqual(snapshot.truncated, false, 'scan is not truncated for a tiny workspace')

  // 2. Open the page: the panel calls previewOpen and loads the returned URL.
  const preview = await api.previewOpen('session-1', 'demo/index.html')
  previewPort = preview.port
  assertEqual(preview.ok, true, 'previewOpen reports ok')
  assert(/^http:\/\/127\.0\.0\.1:\d+\/$/.test(preview.baseUrl), 'preview server binds 127.0.0.1 on an ephemeral port', preview.baseUrl)
  assertEqual(preview.url, preview.baseUrl + 'demo/index.html', 'preview URL points at the picked page')
  const firstGet = await httpGet(preview.url)
  assertEqual(firstGet.status, 200, 'preview server serves the HTML file')
  assert(/text\/html/.test(String(firstGet.headers['content-type'])), 'preview server sends a text/html content type')
  assert(firstGet.body.includes('E2E Original Hero'), 'served page is the original workspace HTML')
  assertEqual(String(firstGet.headers['cache-control']), 'no-store', 'preview responses are not cached')

  // 3. Hot reload: the webview watches revision; a disk edit must bump it and be served.
  const baseline = await api.watchPoll('session-1')
  assertEqual(baseline.watching, true, 'watchPoll starts a watcher for the source root')
  const baselineRevision = baseline.revision
  const hotHtml = ORIGINAL_HTML.replace('E2E Original Hero', 'E2E Hot Updated Hero')
  await writeAt(workspace, 'demo/index.html', hotHtml)
  let polled = baseline
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(100)
    polled = await api.watchPoll('session-1')
    if (polled.revision > baselineRevision) break
  }
  assert(polled.revision > baselineRevision, 'a workspace edit increments the watcher revision', JSON.stringify(polled))
  assert(
    Array.isArray(polled.changed) && polled.changed.some((entry) => String(entry.path).includes('demo/index.html')),
    'watcher reports the changed page path',
    JSON.stringify(polled.changed),
  )
  const secondGet = await httpGet(preview.url)
  assert(secondGet.body.includes('E2E Hot Updated Hero'), 'preview server serves the hot-updated bytes')

  // 4. Commit directly from the panel's commit tab.
  const commit = await api.gitCommit('session-1', 'feat: e2e hot update', ['demo/index.html'])
  assertEqual(commit.ok, true, 'gitCommit reports ok')
  assertEqual(commit.committed, true, 'gitCommit creates a commit')
  assert(commit.commit && /^[0-9a-f]{40}$/.test(commit.commit.hash), 'gitCommit returns the new hash', JSON.stringify(commit.commit))
  assertEqual(commit.commit.subject, 'feat: e2e hot update', 'gitCommit returns the committed subject')
  assertEqual(commit.git.clean, true, 'committed working tree is clean')
  assertEqual(await gitText(['log', '-1', '--format=%s'], workspace), 'feat: e2e hot update', 'real git history contains the commit')
  const nothing = await api.gitCommit('session-1', 'feat: nothing here')
  assertEqual(nothing.committed, false, 'a second commit with no changes stays uncommitted')
  assertEqual(nothing.reason, 'nothing-to-commit', 'nothing-to-commit is reported as a stable reason')

  // 5. The versions tab: per-file history (newest first).
  const log = await api.gitLog('session-1', 'demo/index.html')
  assertEqual(log.file, 'demo/index.html', 'gitLog echoes the sourceRoot-relative file')
  assert(log.commits.length >= 2, 'gitLog lists both commits that touched the page', String(log.commits.length))
  assertEqual(log.commits[0].subject, 'feat: e2e hot update', 'gitLog is newest-first')

  // 6. Branch switching: clean switch, dirty refusal, then explicit stash.
  await runGit(['branch', 'feat-e2e'], workspace)
  const switched = await api.gitSwitch('session-1', 'feat-e2e')
  assertEqual(switched.ok, true, 'gitSwitch moves to a clean branch')
  assertEqual(switched.branch, 'feat-e2e', 'gitSwitch reports the new branch')
  assertEqual(switched.stashed, false, 'a clean switch stashes nothing')
  assertEqual(await gitText(['rev-parse', '--abbrev-ref', 'HEAD'], workspace), 'feat-e2e', 'real git HEAD moved')

  // A page edit is pending; switching back without stash must refuse.
  await writeAt(workspace, 'demo/index.html', hotHtml.replace('E2E Hot Updated Hero', 'E2E Dirty Hero'))
  const stale = await api.gitSwitch('session-1', defaultBranch)
  assertEqual(stale.ok, false, 'dirty worktree refuses a branch switch')
  assertEqual(stale.reason, 'dirty', 'dirty refusal carries the stable reason')
  assert(stale.git.changes.length > 0, 'dirty refusal lists the pending changes')
  assertEqual(await gitText(['rev-parse', '--abbrev-ref', 'HEAD'], workspace), 'feat-e2e', 'refused switch leaves HEAD alone')

  const stashedSwitch = await api.gitSwitch('session-1', defaultBranch, { stash: true })
  assertEqual(stashedSwitch.ok, true, 'stash switch moves branches')
  assertEqual(stashedSwitch.stashed, true, 'stash switch reports the stash')
  assertEqual(stashedSwitch.git.clean, true, 'working tree is clean after the stash')
  assertEqual(await gitText(['rev-parse', '--abbrev-ref', 'HEAD'], workspace), defaultBranch, 'stash switch moved HEAD')
  assert((await gitText(['stash', 'list'], workspace)).includes('nudge'), 'the stash entry is labelled by the plugin')

  // 7. Restore one historical version of the page (worktree only, branch stays).
  const restored = await api.gitRestoreFile('session-1', 'demo/index.html', initialCommit)
  assertEqual(restored.ok, true, 'gitRestoreFile reports ok')
  assertEqual(restored.commit, initialCommit, 'gitRestoreFile echoes the requested commit')
  const restoredHtml = await readAt(workspace, 'demo/index.html')
  assert(restoredHtml.includes('E2E Original Hero'), 'restoring the first version rewrites the working tree file')
  assert(!restoredHtml.includes('E2E Hot Updated Hero'), 'restoring drops the later version content')
  assertEqual(await gitText(['rev-parse', '--abbrev-ref', 'HEAD'], workspace), defaultBranch, 'file restore leaves the branch pointer alone')

  // 7. Read-only sessions: preview and reads still work, writes are refused.
  state.mode = 'read-only'
  const facts = await api.session('session-1')
  assertEqual(facts.writable, false, 'read-only policy is reported to the panel')
  await assertThrows(() => api.gitCommit('session-1', 'feat: blocked'), /read-only/i, 'read-only policy refuses gitCommit')
  await assertThrows(() => api.gitRestoreFile('session-1', 'demo/index.html', initialCommit), /read-only/i, 'read-only policy refuses gitRestoreFile')
  await assertThrows(() => api.gitSwitch('session-1', 'feat-e2e'), /read-only/i, 'read-only policy refuses gitSwitch')
  const readOnlyGet = await httpGet(preview.url)
  assertEqual(readOnlyGet.status, 200, 'read-only policy still serves the preview page')

  // 8. Stopping preview closes the server; watch polling can keep working.
  const stopped = await api.previewStop('session-1')
  assertEqual(stopped.ok, true, 'previewStop reports ok')
  await assertThrows(() => httpGet(preview.url), undefined, 'previewStop closes the port')
  const afterStop = await api.workspace('session-1')
  assertEqual(afterStop.preview.active, false, 'workspace snapshot reports the preview as inactive')
} finally {
  try {
    if (api) await api.previewStop('session-1')
  } catch {
    /* ignore */
  }
  for (const dispose of state.disposers) {
    try {
      await dispose()
    } catch {
      /* ignore */
    }
  }
  await rm(workspace, { recursive: true, force: true })
}

if (failures > 0) {
  console.error('\n' + failures + ' workspace e2e failure(s)')
  process.exit(1)
}
console.log('\nworkspace e2e ok (' + previewPort + ')')
