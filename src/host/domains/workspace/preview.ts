// @ts-nocheck
/**
 * dsh.nudge — host workspace domain: static preview server + change watcher.
 *
 * Contract: docs/workspace-versions.md §2, §3.6–§3.8.
 *
 * Preview server (one per sourceRoot):
 *  - binds 127.0.0.1 with `listen(0)` (ephemeral port), GET/HEAD only;
 *  - `Cache-Control: no-store`, a small MIME map, directory -> index.html and
 *    `/` -> root index.html fallback;
 *  - refuses directory traversal, symlink escapes, dot segments,
 *    `node_modules` segments and `.git` segments.
 *
 * Watcher (one per sourceRoot):
 *  - `fs.watch(root, { recursive: true })` with a 120 ms debounce, monotonic
 *    revision and the last 8 changed paths (the list is not drained);
 *  - falls back to a bounded ~1000 ms stat snapshot poll when recursive
 *    watching is unavailable;
 *  - ignores `.git`, `node_modules`, `dist`, `.dsh`, dot entries and the other
 *    generated directories.
 *
 * No top-level side effects.
 */

import { watch } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'

import { isInsideOrEqual, isIgnoredName, normalizeRelativePath } from './paths.js'

const WATCH_DEBOUNCE_MS = 120
const WATCH_RECENT_LIMIT = 8
const POLL_INTERVAL_MS = 1000
const POLL_MAX_ENTRIES = 2000
const POLL_MAX_DEPTH = 10

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.cjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.eot', 'application/vnd.ms-fontobject'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.pdf', 'application/pdf'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
])

function mimeFor(absolutePath) {
  const extension = extname(absolutePath).toLowerCase()
  return MIME_TYPES.get(extension) ?? 'application/octet-stream'
}

function encodeRelativeUrlPath(relativePath) {
  return relativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function sendText(response, status, text, headOnly, extraHeaders) {
  const body = Buffer.from(String(text), 'utf8')
  const headers = {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...(extraHeaders || {}),
  }
  response.writeHead(status, headers)
  if (headOnly) response.end()
  else response.end(body)
}

function isForbiddenRequestSegment(segment) {
  if (segment === '..' || segment === '.') return true
  if (segment.startsWith('.')) return true
  return segment.toLowerCase() === 'node_modules'
}

async function statSafe(absolutePath) {
  try {
    return await stat(absolutePath)
  } catch {
    return undefined
  }
}

/** One static server bound to one real sourceRoot. */
function createPreviewServer(rootReal) {
  async function handle(request, response) {
    const headOnly = String(request.method || 'GET').toUpperCase() === 'HEAD'
    try {
      const method = String(request.method || 'GET').toUpperCase()
      if (method !== 'GET' && method !== 'HEAD') {
        sendText(response, 405, 'method not allowed', false, { allow: 'GET, HEAD' })
        return
      }
      let pathname
      try {
        // Parse the raw request path manually: `new URL()` would normalise
        // percent-encoded dot segments before the traversal check can see them.
        const rawUrl = String(request.url || '/')
        const queryIndex = rawUrl.indexOf('?')
        pathname = decodeURIComponent(queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl)
      } catch {
        sendText(response, 400, 'bad request', headOnly)
        return
      }
      if (pathname.includes('\u0000')) {
        sendText(response, 400, 'bad request', headOnly)
        return
      }
      const segments = pathname.split('/').filter((segment) => segment.length > 0)
      for (const segment of segments) {
        if (isForbiddenRequestSegment(segment)) {
          sendText(response, 403, 'forbidden', headOnly)
          return
        }
      }
      let absolutePath = segments.length === 0 ? join(rootReal, 'index.html') : join(rootReal, ...segments)
      let info = await statSafe(absolutePath)
      if (info !== undefined && info.isDirectory()) {
        absolutePath = join(absolutePath, 'index.html')
        info = await statSafe(absolutePath)
      }
      if (info === undefined || !info.isFile()) {
        sendText(response, 404, 'not found', headOnly)
        return
      }
      let resolved
      try {
        resolved = await realpath(absolutePath)
      } catch {
        sendText(response, 404, 'not found', headOnly)
        return
      }
      if (!isInsideOrEqual(rootReal, resolved)) {
        sendText(response, 403, 'forbidden', headOnly)
        return
      }
      const content = await readFile(resolved)
      response.writeHead(200, {
        'content-type': mimeFor(resolved),
        'content-length': String(content.length),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      if (headOnly) response.end()
      else response.end(content)
    } catch {
      if (!response.headersSent) sendText(response, 500, 'internal error', headOnly)
      else response.destroy()
    }
  }

  return createServer((request, response) => {
    void handle(request, response)
  })
}

function closeServer(entry) {
  return new Promise((resolve) => {
    const server = entry.server
    try {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    } catch {
      /* ignore */
    }
    try {
      server.close(() => resolve())
    } catch {
      resolve()
    }
  })
}

async function startServer(rootReal) {
  const server = createPreviewServer(rootReal)
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('error', onError)
      reject(error)
    }
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', onError)
      resolve(undefined)
    })
  })
  const address = server.address()
  const port = address !== null && typeof address === 'object' ? address.port : 0
  return { server, port, baseUrl: 'http://127.0.0.1:' + port + '/' }
}

/** Per-sourceRoot preview server registry. */
export function createPreviewService() {
  const entries = new Map()
  const pending = new Map()

  async function ensure(root) {
    const existing = entries.get(root)
    if (existing !== undefined) return existing
    const inflight = pending.get(root)
    if (inflight !== undefined) return inflight
    const promise = startServer(root)
      .then((entry) => {
        entries.set(root, entry)
        pending.delete(root)
        return entry
      })
      .catch((error) => {
        pending.delete(root)
        throw error
      })
    pending.set(root, promise)
    return promise
  }

  return {
    /** Synchronous snapshot for the `workspace()` payload. */
    peek(root) {
      const entry = entries.get(root)
      if (entry === undefined) return { active: false, port: 0, baseUrl: '' }
      return { active: true, port: entry.port, baseUrl: entry.baseUrl }
    },

    /** §3.6 — start or reuse the server and build a webview URL. */
    async open(root, file) {
      if (file !== undefined && file !== null && typeof file !== 'string') {
        throw new Error('file must be a string path')
      }
      let relativeFile = ''
      if (file !== undefined && file !== null && String(file).trim() !== '') {
        relativeFile = normalizeRelativePath(String(file), 'file')
        for (const segment of relativeFile.split('/')) {
          if (isForbiddenRequestSegment(segment)) {
            throw new Error('file ' + JSON.stringify(relativeFile) + ' cannot be served')
          }
        }
      }
      const entry = await ensure(root)
      const url = relativeFile ? entry.baseUrl + encodeRelativeUrlPath(relativeFile) : entry.baseUrl
      return {
        ok: true,
        port: entry.port,
        baseUrl: entry.baseUrl,
        url,
        file: relativeFile,
        root,
      }
    },

    /** §3.7 — close the server for one root (idempotent). */
    async stop(root) {
      const entry = entries.get(root)
      if (entry !== undefined) {
        entries.delete(root)
        await closeServer(entry)
      }
      const inflight = pending.get(root)
      if (inflight !== undefined) {
        pending.delete(root)
        try {
          await closeServer(await inflight)
        } catch {
          /* the in-flight start already failed */
        }
      }
      return { ok: true, root }
    },

    async dispose() {
      const roots = [...entries.keys()]
      for (const root of roots) {
        const entry = entries.get(root)
        entries.delete(root)
        if (entry !== undefined) await closeServer(entry)
      }
      for (const [, promise] of pending) {
        try {
          await closeServer(await promise)
        } catch {
          /* ignore */
        }
      }
      pending.clear()
    },
  }
}

async function boundedSnapshot(root) {
  const snapshot = new Map()
  let count = 0

  async function walk(absoluteDir, relativeDir, depth) {
    if (count >= POLL_MAX_ENTRIES) return
    let entries
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (count >= POLL_MAX_ENTRIES) return
      if (isIgnoredName(entry.name)) continue
      const relativePath = relativeDir ? relativeDir + '/' + entry.name : entry.name
      if (entry.isDirectory()) {
        if (depth < POLL_MAX_DEPTH) await walk(join(absoluteDir, entry.name), relativePath, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      count += 1
      try {
        const info = await stat(join(absoluteDir, entry.name))
        snapshot.set(relativePath, String(info.mtimeMs) + ':' + String(info.size))
      } catch {
        /* the file vanished mid-scan */
      }
    }
  }

  await walk(root, '', 0)
  return snapshot
}

function diffSnapshots(previous, next) {
  const changed = []
  for (const [path, version] of next) {
    if (previous.get(path) !== version) changed.push(path)
  }
  for (const path of previous.keys()) {
    if (!next.has(path)) changed.push(path)
  }
  return changed
}

/** Per-sourceRoot watcher registry. */
export function createWatcherService() {
  const states = new Map()

  function record(state, paths) {
    const names = Array.from(new Set(paths.filter((path) => typeof path === 'string' && path.length > 0)))
    if (names.length === 0 && !state.dirtyFlag) return
    state.dirtyFlag = false
    state.revision += 1
    const at = Date.now()
    for (const path of names) state.changed.push({ path, at })
    if (state.changed.length > WATCH_RECENT_LIMIT) {
      state.changed = state.changed.slice(state.changed.length - WATCH_RECENT_LIMIT)
    }
  }

  function scheduleFlush(state) {
    if (state.timer !== null) clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      state.timer = null
      const pending = Array.from(state.pending)
      state.pending.clear()
      record(state, pending)
    }, WATCH_DEBOUNCE_MS)
    if (typeof state.timer.unref === 'function') state.timer.unref()
  }

  function queueChange(state, relativePath) {
    const name = String(relativePath || '').split('\\').join('/')
    state.dirtyFlag = true
    if (name.length === 0) {
      scheduleFlush(state)
      return
    }
    if (isIgnoredName(name.split('/')[0])) return
    if (name.split('/').some((segment) => isIgnoredName(segment))) return
    state.pending.add(name)
    scheduleFlush(state)
  }

  function startPolling(state) {
    if (state.pollTimer !== null) return
    state.watching = true
    state.pollTimer = setInterval(() => {
      if (state.polling) return
      state.polling = true
      void boundedSnapshot(state.root)
        .then((snapshot) => {
          if (state.snapshot !== null) {
            const changed = diffSnapshots(state.snapshot, snapshot)
            if (changed.length > 0) record(state, changed)
          }
          state.snapshot = snapshot
        })
        .catch(() => {})
        .finally(() => {
          state.polling = false
        })
    }, POLL_INTERVAL_MS)
    if (typeof state.pollTimer.unref === 'function') state.pollTimer.unref()
    // Seed the baseline snapshot immediately so the first poll only reports
    // changes that happened after the watcher started.
    void boundedSnapshot(state.root)
      .then((snapshot) => {
        if (state.snapshot === null) state.snapshot = snapshot
      })
      .catch(() => {})
  }

  function startWatching(state) {
    try {
      const watcher = watch(state.root, { recursive: true }, (_eventType, filename) => {
        queueChange(state, typeof filename === 'string' ? filename : '')
      })
      watcher.on('error', () => {
        try {
          watcher.close()
        } catch {
          /* ignore */
        }
        if (state.watcher === watcher) state.watcher = null
        startPolling(state)
      })
      state.watcher = watcher
      state.watching = true
    } catch {
      state.watcher = null
      startPolling(state)
    }
  }

  function stopState(state) {
    if (state.timer !== null) {
      clearTimeout(state.timer)
      state.timer = null
    }
    if (state.pollTimer !== null) {
      clearInterval(state.pollTimer)
      state.pollTimer = null
    }
    if (state.watcher !== null) {
      try {
        state.watcher.close()
      } catch {
        /* ignore */
      }
      state.watcher = null
    }
    state.watching = false
    state.pending.clear()
  }

  function ensure(root) {
    const existing = states.get(root)
    if (existing !== undefined) return existing
    const state = {
      root,
      revision: 0,
      changed: [],
      pending: new Set(),
      dirtyFlag: false,
      timer: null,
      watcher: null,
      pollTimer: null,
      snapshot: null,
      polling: false,
      watching: false,
    }
    states.set(root, state)
    startWatching(state)
    return state
  }

  return {
    /** §3.8 — start (or reuse) the watcher and report its current state. */
    poll(root) {
      const state = ensure(root)
      return {
        revision: state.revision,
        root,
        watching: state.watching,
        changed: state.changed.map((entry) => ({ path: entry.path, at: entry.at })),
      }
    },

    stop(root) {
      const state = states.get(root)
      if (state === undefined) return
      states.delete(root)
      stopState(state)
    },

    dispose() {
      for (const state of states.values()) stopState(state)
      states.clear()
    },
  }
}
