/**
 * Source-sync tests: real temporary workspaces + a `fs` service adapter built
 * on `node:fs/promises` that mirrors the Host `ctx.fs` shape (realpath-based
 * targets, mtime+size versions, FS_STALE_VERSION races).
 *
 * Plain `node test/source-sync.test.mjs` — prints `ok - ...` lines and exits
 * non-zero on the first failing case set.
 */

import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { syncEdits } from '../lib/source-sync.js'

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

function countOccurrences(haystack, needle) {
  let count = 0
  let index = haystack.indexOf(needle)
  while (index >= 0) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

// ------------------------------------------------------------ fs adapter

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

/**
 * A workspace-local implementation of the Host `fs` service.
 * @param {{writeInterceptor?: Function}} [options]
 */
function createAdapter(options = {}) {
  const state = { writeAttempts: 0, writes: [], reads: 0, listDirs: 0 }
  const targetCache = new Map()
  function makeTarget(canonicalPath) {
    let target = targetCache.get(canonicalPath)
    if (!target) {
      target = { path: canonicalPath }
      targetCache.set(canonicalPath, target)
    }
    return target
  }
  const adapter = {
    state,
    async resolve(path) {
      if (typeof path !== 'string' || path === '') throw new TypeError('a non-empty path is required')
      return makeTarget(await realpathOf(path))
    },
    processPath(target) {
      return target && typeof target.path === 'string' ? target.path : String(target)
    },
    contains(parent, child) {
      const rel = relative(this.processPath(parent), this.processPath(child))
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    },
    async stat(target) {
      try {
        const info = await stat(this.processPath(target))
        return {
          version: versionOf(info),
          type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
          size: info.size,
        }
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined
        throw error
      }
    },
    async readText(target) {
      state.reads += 1
      return readFile(this.processPath(target), 'utf8')
    },
    async listDir(target) {
      state.listDirs += 1
      const dirPath = this.processPath(target)
      const entries = await readdir(dirPath, { withFileTypes: true })
      const output = []
      for (const entry of entries) {
        const absolute = join(dirPath, entry.name)
        let size
        if (entry.isFile()) {
          try {
            size = (await stat(absolute)).size
          } catch {
            size = undefined
          }
        }
        output.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
          target: makeTarget(await realpathOf(absolute)),
          size,
        })
      }
      return output
    },
    async writeText(target, content, expected, signal, policy) {
      state.writeAttempts += 1
      const filePath = this.processPath(target)
      if (policy && policy.mode === 'read-only') {
        const error = new Error('the session policy is read-only')
        error.code = 'FS_READ_ONLY'
        throw error
      }
      if (typeof options.writeInterceptor === 'function') {
        await options.writeInterceptor({ adapter, target, content, expected, attempt: state.writeAttempts, state })
      }
      let current
      try {
        const info = await stat(filePath)
        current = { version: versionOf(info), size: info.size }
      } catch {
        current = undefined
      }
      if (expected && expected.kind === 'replaceIfVersion') {
        if (!current) {
          const error = new Error('the file disappeared before the write')
          error.code = 'FS_STALE_VERSION'
          throw error
        }
        if (current.version !== expected.version) {
          const error = new Error('the file changed before the write')
          error.code = 'FS_STALE_VERSION'
          throw error
        }
      } else if (expected && expected.kind === 'createIfAbsent') {
        if (current) {
          const error = new Error('the file already exists')
          error.code = 'FS_EXISTS'
          throw error
        }
      }
      let before = null
      try {
        before = await readFile(filePath, 'utf8')
      } catch {
        before = null
      }
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, content, 'utf8')
      const after = await stat(filePath)
      state.writes.push({ path: filePath, content })
      return { operation: 'write', version: versionOf(after), before, after: content }
    },
  }
  return adapter
}

// ------------------------------------------------------------ test helpers

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const TEMP_ROOT = join(TEST_DIRECTORY, '.tmp-source-sync')

async function withWorkspace(run) {
  await mkdir(TEMP_ROOT, { recursive: true })
  const base = await mkdtemp(join(TEMP_ROOT, 'workspace-'))
  const root = await realpath(base)
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function writeAt(root, relPath, content) {
  const absolute = join(root, ...relPath.split('/'))
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, content, 'utf8')
}

async function readAt(root, relPath) {
  return readFile(join(root, ...relPath.split('/')), 'utf8')
}

function makeDeps(root, adapter, edits, extra = {}) {
  return {
    fs: adapter,
    cwd: root,
    sourceRoot: extra.sourceRoot || root,
    urlRoot: extra.urlRoot || '',
    page: extra.page || { url: 'http://127.0.0.1:5173/index.html', title: 'test' },
    edits,
    policy: extra.policy || { mode: 'workspace-write', workspaceRoot: root },
    maxScanFiles: extra.maxScanFiles || 100,
    maxFileBytes: extra.maxFileBytes || 1_000_000,
  }
}

function styleEdit(id, extra) {
  return { id, kind: 'style', property: 'color', value: 'rgb(255, 0, 0)', ...extra }
}

// ----------------------------------------------------------------- tests

async function testHtmlUrlMappingAndOverrideBlock() {
  await withWorkspace(async (root) => {
    await writeAt(
      root,
      'public/index.html',
      '<!doctype html>\n<html>\n  <head>\n    <title>Demo</title>\n  </head>\n  <body>\n    <div id="picker" class="pk">Pick me</div>\n  </body>\n</html>\n',
    )
    const adapter = createAdapter()
    const edits = [
      styleEdit('style-1', { selector: '#picker' }),
      styleEdit('style-2', { selector: '.pk', property: 'background-color', value: 'blue' }),
    ]
    const first = await syncEdits(makeDeps(root, adapter, edits, { sourceRoot: join(root, 'public'), page: { url: 'http://127.0.0.1:5173/index.html' } }))

    assertEqual(first.results.length, 2, 'html: one result per edit')
    assertEqual(first.results[0].status, 'synced', 'html: first style edit synced')
    assertEqual(first.results[0].file, 'public/index.html', 'html: result file is workspace-relative')
    assertEqual(first.results[1].status, 'synced', 'html: second style edit synced')
    assertEqual(adapter.state.writes.length, 1, 'html: two edits against one file produce one write')
    assertEqual(first.files.length, 1, 'html: files lists the written file once')

    const content = await readAt(root, 'public/index.html')
    assert(content.includes('<style id="dsh-nudge-overrides">'), 'html: override style block created')
    assert(content.includes('#picker { color: rgb(255, 0, 0); }'), 'html: first rule written')
    assert(content.includes('.pk { background-color: blue; }'), 'html: second rule merged into the block')
    assert(
      content.indexOf('<style id=') > content.indexOf('<head>') && content.indexOf('<style id=') < content.indexOf('</head>'),
      'html: override block inserted inside <head>',
    )
    assertEqual(countOccurrences(content, 'dsh-nudge-overrides'), 1, 'html: exactly one override block')

    const second = await syncEdits(
      makeDeps(root, adapter, [styleEdit('style-3', { selector: '#picker', value: 'rgb(0, 0, 255)' })], {
        sourceRoot: join(root, 'public'),
        page: { url: 'http://127.0.0.1:5173/index.html' },
      }),
    )
    assertEqual(second.results[0].status, 'synced', 'html: override update synced')
    assertEqual(adapter.state.writes.length, 2, 'html: update performed one additional write')
    const updated = await readAt(root, 'public/index.html')
    assert(updated.includes('#picker { color: rgb(0, 0, 255); }'), 'html: declaration value updated in place')
    assertEqual(countOccurrences(updated, '#picker {'), 1, 'html: no duplicate rule for the same selector')
    assertEqual(countOccurrences(updated, 'dsh-nudge-overrides'), 1, 'html: still exactly one override block')

    const third = await syncEdits(
      makeDeps(root, adapter, [styleEdit('style-4', { selector: '#picker', value: 'rgb(0, 0, 255)' })], {
        sourceRoot: join(root, 'public'),
        page: { url: 'http://127.0.0.1:5173/index.html' },
      }),
    )
    assertEqual(third.results[0].status, 'synced', 'html: already-correct edit reports synced')
    assertEqual(third.results[0].strategy, 'no-op', "html: already-correct edit uses strategy:'no-op'")
    assertEqual(adapter.state.writes.length, 2, 'html: already-correct edit performs no write')
  })
}

async function testHtmlTextAndAttributeEdits() {
  await withWorkspace(async (root) => {
    await writeAt(
      root,
      'index.html',
      '<!doctype html>\n<html>\n  <body>\n    <p id="pick">Peak <em>very</em> performance mode</p>\n    <a id="cta" class="btn" href="/old" data-role="cta">Go</a>\n  </body>\n</html>\n',
    )
    const adapter = createAdapter()
    const edits = [
      { id: 'text-1', kind: 'text', selector: '#pick', textBefore: 'Peak very performance mode', textAfter: 'Peak very speed mode', textSnippet: 'Peak very performance mode' },
      { id: 'attr-1', kind: 'attr', selector: '#cta', attrName: 'href', attrBefore: '/old', attrAfter: '/new' },
      { id: 'attr-2', kind: 'attr', selector: '#cta', attrName: 'data-state', attrAfter: 'active' },
    ]
    const out = await syncEdits(makeDeps(root, adapter, edits, { page: { url: 'http://localhost:3000/index.html' } }))

    assertEqual(out.results[0].status, 'synced', 'text: text edit synced')
    assertEqual(out.results[1].status, 'synced', 'attr: attribute replacement synced')
    assertEqual(out.results[2].status, 'synced', 'attr: attribute insertion synced')
    assertEqual(adapter.state.writes.length, 1, 'text/attr: all edits against one file produce one write')

    const content = await readAt(root, 'index.html')
    assert(content.includes('Peak <em>very</em> speed mode'), 'text: only the text node changed, child tags preserved')
    assertEqual(countOccurrences(content, '<em>very</em>'), 1, 'text: child element left intact')
    assert(content.includes('href="/new"'), 'attr: existing attribute value replaced')
    assert(content.includes('class="btn"'), 'attr: unrelated attributes preserved')
    assert(content.includes('data-role="cta"'), 'attr: other data attributes preserved')
    assert(content.includes('data-state="active"'), 'attr: missing attribute inserted into the opening tag')
    assertEqual(out.results[0].line, 4, 'text: line number points at the edited element line')
  })
}

async function testCssHintUpdateAndAppend() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'styles/main.css', '.pk {\n  color: red;\n}\n')
    await writeAt(root, 'index.html', '<!doctype html>\n<html><body><div id="picker" class="pk">x</div></body></html>\n')
    const adapter = createAdapter()
    const edits = [
      styleEdit('css-1', { selector: 'body > #picker > .pk', value: 'blue', sourceHints: { styleHref: '/styles/main.css' } }),
      styleEdit('css-2', { selector: '.missing-card', property: 'background', value: '#ffffff', sourceHints: { styleHref: '/styles/main.css' } }),
      styleEdit('css-3', { selector: '.pk', property: 'padding', value: '4px', sourceHints: { styleHref: '/styles/main.css' } }),
    ]
    const out = await syncEdits(makeDeps(root, adapter, edits, { page: { url: 'http://localhost:5173/index.html' } }))

    assertEqual(out.results[0].status, 'synced', 'css: existing rule updated')
    assertEqual(out.results[0].file, 'styles/main.css', 'css: hint resolves the stylesheet')
    assertEqual(out.results[0].line, 2, 'css: line number points at the updated declaration')
    assertEqual(out.results[1].status, 'synced', 'css: missing rule appended')
    assertEqual(out.results[2].status, 'synced', 'css: declaration inserted into an existing rule')
    assertEqual(adapter.state.writes.length, 1, 'css: all edits produce one stylesheet write')

    const content = await readAt(root, 'styles/main.css')
    assert(content.includes('.pk {\n  color: blue;\n  padding: 4px;\n}'), 'css: inserted declaration keeps multi-line formatting')
    assertEqual(countOccurrences(content, '.pk {'), 1, 'css: existing rule reused instead of duplicated')
    assert(content.includes('/* dsh-nudge: added rule */'), 'css: appended rule carries a short comment')
    assert(content.includes('.missing-card {'), 'css: new rule appended at the end')
    assert(content.includes('background: #ffffff;'), 'css: appended declaration written')
  })
}

async function testOutsideWorkspaceIsPreview() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', '<!doctype html>\n<html><body><div id="picker">x</div></body></html>\n')
    const adapter = createAdapter()
    const external = await syncEdits(
      makeDeps(root, adapter, [styleEdit('outside-1', { selector: '#picker' })], { page: { url: 'https://example.com/index.html' } }),
    )
    assertEqual(external.results[0].status, 'preview', 'mapping: external origin is preview-only')
    assertEqual(external.results[0].reason, 'no-source-mapping', 'mapping: external origin reason is no-source-mapping')
    assertEqual(adapter.state.writes.length, 0, 'mapping: external origin writes nothing')

    const traversal = await syncEdits(
      makeDeps(root, adapter, [styleEdit('outside-2', { selector: '#picker' })], { page: { url: 'http://localhost:5173/..%2f..%2fetc/passwd' } }),
    )
    assertEqual(traversal.results[0].status, 'preview', 'mapping: path traversal is preview-only')
    assertEqual(traversal.results[0].reason, 'no-source-mapping', 'mapping: path traversal reason is no-source-mapping')
    assertEqual(adapter.state.writes.length, 0, 'mapping: path traversal writes nothing')
  })
}

async function testReadOnlyPolicyNeverWrites() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', '<!doctype html>\n<html><body><div id="picker">x</div></body></html>\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [styleEdit('ro-1', { selector: '#picker' })], {
        policy: { mode: 'read-only', workspaceRoot: root },
      }),
    )
    assertEqual(out.results[0].status, 'preview', 'read-only: defensive policy check returns preview')
    assertEqual(out.results[0].reason, 'read-only-policy', 'read-only: reason is read-only-policy')
    assertEqual(adapter.state.writeAttempts, 0, 'read-only: no write attempt reaches the fs service')
    assertEqual(adapter.state.reads, 0, 'read-only: no source read happens')
  })
}

async function testStaleVersionRetriedOnce() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', '<!doctype html>\n<html>\n  <head></head>\n  <body><div id="picker">x</div></body>\n</html>\n')
    const adapter = createAdapter({
      writeInterceptor: async ({ attempt, target }) => {
        if (attempt !== 1) return
        const filePath = typeof target === 'string' ? target : target.path
        const current = await readFile(filePath, 'utf8')
        await writeFile(filePath, current + '<!-- external change -->\n', 'utf8')
      },
    })
    const out = await syncEdits(makeDeps(root, adapter, [styleEdit('stale-1', { selector: '#picker' })]))

    assertEqual(out.results[0].status, 'synced', 'stale: edit synced after one retry')
    assertEqual(adapter.state.writeAttempts, 2, 'stale: exactly two write attempts (initial + one retry)')
    assertEqual(adapter.state.writes.length, 1, 'stale: exactly one successful write')
    const content = await readAt(root, 'index.html')
    assert(content.includes('<!-- external change -->'), 'stale: retry re-read and preserved the concurrent change')
    assert(content.includes('dsh-nudge-overrides'), 'stale: retry still applied the edit')
  })
}

async function testUnresolvedElementIsPreview() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', '<!doctype html>\n<html><body><div id="other">x</div></body></html>\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        { id: 'unresolved-1', kind: 'text', selector: '#missing', textBefore: 'needs update', textAfter: 'done' },
      ]),
    )
    assertEqual(out.results[0].status, 'preview', 'unresolved: unknown target stays preview-only')
    assertEqual(out.results[0].reason, 'unresolved-element', 'unresolved: reason is unresolved-element')
    assertEqual(out.results[0].file, 'index.html', 'unresolved: mapped file is reported')
    assertEqual(adapter.state.writes.length, 0, 'unresolved: nothing is written')
  })
}

async function testFallbackSearchByClassToken() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'pages/card.html', '<section class="profile-card">\n  <h2 class="profile-name">Hello</h2>\n</section>\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(
        root,
        adapter,
        [{ id: 'search-1', kind: 'text', selector: '.profile-name', textBefore: 'Hello', textAfter: 'Hi there', textSnippet: 'Hello' }],
        { page: { url: 'http://127.0.0.1:5173/preview/missing-page' } },
      ),
    )
    assertEqual(out.results[0].status, 'synced', 'search: fallback search found and patched a file')
    assertEqual(out.results[0].strategy, 'search', "search: result reports strategy 'search'")
    assertEqual(out.results[0].file, 'pages/card.html', 'search: found file reported workspace-relative')
    assertEqual(out.files.length, 1, 'search: files lists the searched file')
    const content = await readAt(root, 'pages/card.html')
    assert(content.includes('<h2 class="profile-name">Hi there</h2>'), 'search: text node patched inside the found file')
  })
}

async function testFileTooLargeFails() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'huge.html', '<html><body>' + 'x'.repeat(1_100_000) + '</body></html>')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [styleEdit('huge-1', { selector: '#picker' })], { page: { url: 'http://localhost:5173/huge.html' } }),
    )
    assertEqual(out.results[0].status, 'failed', 'too-large: oversized mapped file fails')
    assertEqual(out.results[0].reason, 'file-too-large', 'too-large: reason is file-too-large')
    assertEqual(adapter.state.writes.length, 0, 'too-large: nothing is written')
  })
}

async function testBomAndCrlfPreserved() {
  await withWorkspace(async (root) => {
    const original = '\uFEFF<!doctype html>\r\n<html>\r\n  <head></head>\r\n  <body><div id="target">x</div></body>\r\n</html>\r\n'
    await writeAt(root, 'index.html', original)
    const adapter = createAdapter()
    const out = await syncEdits(makeDeps(root, adapter, [styleEdit('bom-1', { selector: '#target', property: 'font-weight', value: '700' })]))
    assertEqual(out.results[0].status, 'synced', 'bom: edit synced on BOM+CRLF file')
    const content = await readAt(root, 'index.html')
    assert(content.startsWith('\uFEFF'), 'bom: leading BOM preserved')
    assert(content.includes('\r\n'), 'bom: CRLF newlines preserved')
    assert(!/(^|[^\r])\n/.test(content), 'bom: no bare LF introduced')
    assert(content.includes('dsh-nudge-overrides'), 'bom: override block written')
  })
}

async function testUnsafeAttributesStayPreview() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', '<!doctype html>\n<html><body><button id="go" onclick="doIt()">Go</button></body></html>\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        { id: 'unsafe-1', kind: 'attr', selector: '#go', attrName: 'onclick', attrAfter: 'evil()' },
        { id: 'unsafe-2', kind: 'attr', selector: '#go', attrName: 'style', attrAfter: 'color:red' },
      ]),
    )
    assertEqual(out.results[0].status, 'preview', 'unsafe: event handler attribute is refused')
    assertEqual(out.results[0].reason, 'unsafe-attribute', 'unsafe: reason is unsafe-attribute')
    assertEqual(out.results[1].status, 'preview', 'unsafe: style attribute is refused (style edits are CSS)')
    assertEqual(out.results[1].reason, 'unsupported-attribute', 'unsafe: reason is unsupported-attribute')
    assertEqual(adapter.state.writes.length, 0, 'unsafe: nothing is written')
  })
}

async function testUrlRootMappingAndDirectoryIndex() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'public/index.html', '<!doctype html>\n<html><head></head><body><div id="home">home</div></body></html>\n')
    await writeAt(root, 'public/docs/index.html', '<!doctype html>\n<html><head></head><body><p id="doc">Old</p></body></html>\n')
    const adapter = createAdapter()
    const base = { sourceRoot: join(root, 'public'), urlRoot: 'http://localhost:5173/app' }

    const byFile = await syncEdits(
      makeDeps(root, adapter, [styleEdit('urlroot-1', { selector: '#home' })], {
        ...base,
        page: { url: 'http://localhost:5173/app/index.html' },
      }),
    )
    assertEqual(byFile.results[0].status, 'synced', 'urlRoot: configured prefix maps to sourceRoot')
    assertEqual(byFile.results[0].file, 'public/index.html', 'urlRoot: mapped file is workspace-relative')

    const byDirectory = await syncEdits(
      makeDeps(root, adapter, [{ id: 'urlroot-2', kind: 'text', selector: '#doc', textBefore: 'Old', textAfter: 'New' }], {
        ...base,
        page: { url: 'http://localhost:5173/app/docs' },
      }),
    )
    assertEqual(byDirectory.results[0].status, 'synced', 'urlRoot: directory URL maps to index.html')
    assertEqual(byDirectory.results[0].file, 'public/docs/index.html', 'urlRoot: directory index resolved')
    assert((await readAt(root, 'public/docs/index.html')).includes('>New<'), 'urlRoot: directory index patched')

    const mismatch = await syncEdits(
      makeDeps(root, adapter, [styleEdit('urlroot-3', { selector: '#home' })], {
        ...base,
        page: { url: 'http://localhost:9999/app/index.html' },
      }),
    )
    assertEqual(mismatch.results[0].status, 'preview', 'urlRoot: different origin is preview-only')
    assertEqual(mismatch.results[0].reason, 'no-source-mapping', 'urlRoot: origin mismatch reason')
  })
}

async function testHintsTakePriorityOverUrl() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'page.html', '<!doctype html>\n<html><body><div id="picker">page source</div></body></html>\n')
    await writeAt(root, 'card.html', '<!doctype html>\n<html><body><div id="picker">card source</div></body></html>\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [styleEdit('hint-1', { selector: '#picker', sourceHints: { file: '/card.html' } })], {
        page: { url: 'http://localhost:5173/page.html' },
      }),
    )
    assertEqual(out.results[0].status, 'synced', 'hints: explicit source hint is synced')
    assertEqual(out.results[0].file, 'card.html', 'hints: explicit hint wins over URL mapping')
    assert((await readAt(root, 'card.html')).includes('dsh-nudge-overrides'), 'hints: hinted file patched')
    assert(!(await readAt(root, 'page.html')).includes('dsh-nudge-overrides'), 'hints: URL-mapped file untouched')
  })
}

async function testOuterHtmlAndTextBeforeLocation() {
  await withWorkspace(async (root) => {
    await writeAt(
      root,
      'index.html',
      '<!doctype html>\n<html>\n  <body>\n    <p class="greeting">Hello</p>\n    <span class="badge">New</span>\n  </body>\n</html>\n',
    )
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'outer-1',
          kind: 'text',
          selector: '.greeting',
          outerHTML: '<p class="greeting">Hello</p>',
          textBefore: 'Hello',
          textAfter: 'Hi',
        },
        { id: 'textbefore-1', kind: 'attr', selector: 'body > .badge', textBefore: 'New', attrName: 'title', attrAfter: 'badge' },
      ]),
    )
    assertEqual(out.results[0].status, 'synced', 'locate: element found by normalized outerHTML')
    assertEqual(out.results[1].status, 'synced', 'locate: element found by exact textBefore + tokens')
    const content = await readAt(root, 'index.html')
    assert(content.includes('<p class="greeting">Hi</p>'), 'locate: outerHTML-located text patched')
    assert(content.includes('<span class="badge" title="badge">New</span>'), 'locate: textBefore-located attribute inserted')
  })
}

async function testMultipleFilesOneWriteEach() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', '<!doctype html>\n<html><head></head><body><div id="picker">x</div></body></html>\n')
    await writeAt(root, 'styles/site.css', '.picker {\n  color: red;\n}\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        styleEdit('multi-1', { selector: '#picker' }),
        styleEdit('multi-2', { selector: '.picker', value: 'green', sourceHints: { styleHref: '/styles/site.css' } }),
      ]),
    )
    assertEqual(out.results[0].status, 'synced', 'multi: first file edit synced')
    assertEqual(out.results[1].status, 'synced', 'multi: second file edit synced')
    assertEqual(adapter.state.writes.length, 2, 'multi: one write per distinct file')
    assertEqual(out.files.length, 2, 'multi: files lists both written files')
    assert(out.files.includes('index.html') && out.files.includes('styles/site.css'), 'multi: both files reported')
  })
}

async function testMissingCssHintCreatesFile() {
  await withWorkspace(async (root) => {
    await mkdir(join(root, 'styles'), { recursive: true })
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        styleEdit('create-1', { selector: '.new-rule', value: 'teal', sourceHints: { styleHref: '/styles/created.css' } }),
      ]),
    )
    assertEqual(out.results[0].status, 'synced', 'create: missing hinted stylesheet is created')
    assertEqual(out.results[0].file, 'styles/created.css', 'create: created file reported')
    assertEqual(adapter.state.writes.length, 1, 'create: exactly one createIfAbsent write')
    const content = await readAt(root, 'styles/created.css')
    assert(content.includes('/* dsh-nudge: added rule */'), 'create: new stylesheet carries the rule comment')
    assert(content.includes('.new-rule {') && content.includes('color: teal;'), 'create: rule written into the new file')
  })
}

async function testAttributeRemoval() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', '<!doctype html>\n<html><body><a id="cta" href="/x" title="tip">Go</a></body></html>\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [{ id: 'remove-1', kind: 'attr', selector: '#cta', attrName: 'title', attrAfter: null }]),
    )
    assertEqual(out.results[0].status, 'synced', 'attr: removal edit synced')
    const content = await readAt(root, 'index.html')
    assert(!content.includes('title='), 'attr: attribute removed')
    assert(content.includes('href="/x"'), 'attr: siblings preserved after removal')
  })
}

async function testStyleSearchFindsStylesheet() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'styles/site.css', '.card {\n  color: red;\n}\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [styleEdit('search-css-1', { selector: '.card', value: 'green' })], {
        page: { url: 'http://127.0.0.1:5173/does-not-exist' },
      }),
    )
    assertEqual(out.results[0].status, 'synced', 'search: style edit found a stylesheet by class token')
    assertEqual(out.results[0].strategy, 'search', 'search: stylesheet search strategy reported')
    assertEqual(out.results[0].file, 'styles/site.css', 'search: stylesheet file reported')
    const content = await readAt(root, 'styles/site.css')
    assert(content.includes('.card {\n  color: green;\n}'), 'search: existing rule updated in the found stylesheet')
  })
}

async function testEntitySafeTextReplacement() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', '<!doctype html>\n<html><body><p id="ent">A &amp; B <em>x</em></p></body></html>\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        { id: 'entity-1', kind: 'text', selector: '#ent', textBefore: 'A & B x', textAfter: 'A C x' },
      ]),
    )
    assertEqual(out.results[0].status, 'synced', 'entity: text edit spanning an HTML entity synced')
    const content = await readAt(root, 'index.html')
    assert(content.includes('A C <em>x</em>'), 'entity: entity span replaced without cutting the entity')
    assert(!content.includes('amp;'), 'entity: no broken entity remnant left behind')
  })
}

async function testHintWorkspaceFallbackWhenSourceRootIsSubdir() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'demo/index.html', '<!doctype html>\n<html><head></head><body><div id="home">home</div></body></html>\n')
    await writeAt(root, 'demo/other.html', '<!doctype html>\n<html><head></head><body><div id="card">card</div></body></html>\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [styleEdit('hint-fallback-1', { selector: '#card', sourceHints: { file: 'demo/other.html' } })], {
        sourceRoot: join(root, 'demo'),
        page: { url: 'http://127.0.0.1:4173/index.html' },
      }),
    )
    assertEqual(out.results[0].status, 'synced', 'hint fallback: repo-relative hint resolved from workspace root')
    assertEqual(out.results[0].file, 'demo/other.html', 'hint fallback: hinted repo-relative file patched')
    assert((await readAt(root, 'demo/other.html')).includes('dsh-nudge-overrides'), 'hint fallback: hinted file gets the override block')
    assert(!(await readAt(root, 'demo/index.html')).includes('dsh-nudge-overrides'), 'hint fallback: URL-mapped file untouched')
  })
}

async function testServedAssetResolvedByUniqueBasename() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'demo/index.html', '<!doctype html>\n<html><head></head><body><div class="brand">x</div></body></html>\n')
    await writeAt(root, 'demo/app.css', '.brand {\n  color: red;\n}\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        styleEdit('basename-1', {
          selector: '.brand',
          value: 'navy',
          // The page is served from demo/, so the asset URL is /app.css while the
          // real source file lives in demo/app.css under the workspace root.
          sourceHints: { styleHref: 'http://127.0.0.1:4173/app.css' },
        }),
      ]),
    )
    assertEqual(out.results[0].status, 'synced', 'basename: served asset resolved by unique basename')
    assertEqual(out.results[0].file, 'demo/app.css', 'basename: real source stylesheet reported')
    const content = await readAt(root, 'demo/app.css')
    assert(content.includes('.brand {\n  color: navy;\n}'), 'basename: existing rule updated in the found stylesheet')
    let createdAtRoot = true
    try {
      await readAt(root, 'app.css')
    } catch {
      createdAtRoot = false
    }
    assert(createdAtRoot === false, 'basename: no duplicate stylesheet invented at the URL root')
  })
}

async function testPureInsertionTextEdit() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', '<!doctype html>\n<html><body><p id="ins">Hello <em>world</em> now</p></body></html>\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        { id: 'insert-1', kind: 'text', selector: '#ins', textBefore: 'Hello world now', textAfter: 'Hello brave world now' },
      ]),
    )
    assertEqual(out.results[0].status, 'synced', 'insertion: pure text insertion synced')
    const content = await readAt(root, 'index.html')
    assert(content.includes('Hello brave <em>world</em> now'), 'insertion: inserted text placed at the right text node, child tags preserved')
  })
}

async function testTextSpanAcrossSourceLineBreak() {
  await withWorkspace(async (root) => {
    await writeAt(
      root,
      'index.html',
      '<!doctype html>\n<html><body><p id="multi">First line\n  second line</p></body></html>\n',
    )
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        { id: 'multiline-1', kind: 'text', selector: '#multi', textBefore: 'First line second line', textAfter: 'First line' },
      ]),
    )
    assertEqual(out.results[0].status, 'synced', 'line-break: changed span crossing a source line break synced')
    const content = await readAt(root, 'index.html')
    assert(content.includes('<p id="multi">First line</p>'), 'line-break: whole span removed, formatting left valid')
  })
}


async function testRemoveElementFromMarkup() {
  await withWorkspace(async (root) => {
    await writeAt(
      root,
      'index.html',
      '<!doctype html>\n<html>\n  <body>\n    <div id="list">\n      <span id="a" class="item">A</span>\n      <span id="b" class="item">B</span>\n      <span id="c" class="item">C</span>\n    </div>\n  </body>\n</html>\n',
    )
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        { id: 'remove-1', kind: 'remove', selector: '#b', outerHTML: '<span id="b" class="item">B</span>', textSnippet: 'B' },
      ]),
    )
    assertEqual(out.results[0].status, 'synced', 'remove: element removal synced')
    assertEqual(out.results[0].strategy, 'html-remove', 'remove: strategy is html-remove')
    assertEqual(out.results[0].file, 'index.html', 'remove: edited file reported')
    assertEqual(out.results[0].line, 6, 'remove: line points at the removed element')
    assertEqual(adapter.state.writes.length, 1, 'remove: one write')
    const content = await readAt(root, 'index.html')
    assert(!content.includes('id="b"'), 'remove: element and subtree removed')
    assert(content.includes('<span id="a" class="item">A</span>'), 'remove: previous sibling kept')
    assert(content.includes('<span id="c" class="item">C</span>'), 'remove: next sibling kept')
    assertEqual(content.split('\n').length, 10, 'remove: the emptied line is gone, no blank gap left')

    const protectedOut = await syncEdits(
      makeDeps(root, adapter, [{ id: 'remove-2', kind: 'remove', selector: 'body', outerHTML: '<body></body>' }]),
    )
    assertEqual(protectedOut.results[0].status, 'preview', 'remove: protected element stays preview-only')
    assertEqual(protectedOut.results[0].reason, 'protected-element', 'remove: reason is protected-element')
    assertEqual(adapter.state.writes.length, 1, 'remove: protected edit writes nothing')

    const missingOut = await syncEdits(
      makeDeps(root, adapter, [{ id: 'remove-3', kind: 'remove', selector: '#missing', outerHTML: '' }]),
    )
    assertEqual(missingOut.results[0].status, 'preview', 'remove: unresolved element stays preview-only')
    assertEqual(missingOut.results[0].reason, 'unresolved-element', 'remove: reason is unresolved-element')
  })
}

async function testMoveElementInMarkup() {
  const page =
    '<!doctype html>\n<html>\n  <body>\n    <div id="list">\n      <span id="a" class="item">A</span>\n      <span id="b" class="item">B</span>\n      <span id="c" class="item">C</span>\n    </div>\n    <div id="panel">\n      <p id="p1">Panel</p>\n    </div>\n  </body>\n</html>\n'
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', page)
    const adapter = createAdapter()

    const reorder = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'move-1',
          kind: 'move',
          selector: '#c',
          outerHTML: '<span id="c" class="item">C</span>',
          textSnippet: 'C',
          targetParentSelector: '#list',
          targetParentOuterHTML: '<div id="list"></div>',
          beforeSelector: '#a',
          beforeOuterHTML: '<span id="a" class="item">A</span>',
        },
      ]),
    )
    assertEqual(reorder.results[0].status, 'synced', 'move: sibling reorder synced')
    assertEqual(reorder.results[0].strategy, 'html-move', 'move: strategy is html-move')
    const reordered = await readAt(root, 'index.html')
    assertEqual(countOccurrences(reordered, '<span'), 3, 'move: no element duplicated or lost')
    assert(
      reordered.indexOf('<span id="c"') < reordered.indexOf('<span id="a"') && reordered.indexOf('<span id="a"') < reordered.indexOf('<span id="b"'),
      'move: C now precedes A and B',
    )
    assert(reordered.includes('      <span id="c" class="item">C</span>\n      <span id="a"'), 'move: indentation preserved at the destination')

    const nest = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'move-2',
          kind: 'move',
          selector: '#a',
          outerHTML: '<span id="a" class="item">A</span>',
          targetParentSelector: '#panel',
          targetParentOuterHTML: '<div id="panel"><p id="p1">Panel</p></div>',
          beforeSelector: null,
        },
      ]),
    )
    assertEqual(nest.results[0].status, 'synced', 'move: re-parenting synced')
    const nested = await readAt(root, 'index.html')
    assert(/<div id="panel">\n\s*<p id="p1">Panel<\/p>\n\s*<span id="a" class="item">A<\/span>\n\s*<\/div>/.test(nested), 'move: appended as the last child of the new parent')
    assert(!/id="list">[\s\S]*id="a"/.test(nested.slice(nested.indexOf('id="list"'), nested.indexOf('</div>', nested.indexOf('id="list"')))), 'move: element left the old parent')

    const writeCount = adapter.state.writes.length
    const cycle = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'move-3',
          kind: 'move',
          selector: '#panel',
          outerHTML: '<div id="panel"></div>',
          targetParentSelector: '#p1',
          targetParentOuterHTML: '<p id="p1">Panel</p>',
        },
      ]),
    )
    assertEqual(cycle.results[0].status, 'preview', 'move: moving an element into itself stays preview-only')
    assertEqual(cycle.results[0].reason, 'invalid-move-target', 'move: reason is invalid-move-target')
    assertEqual(adapter.state.writes.length, writeCount, 'move: refused move writes nothing')

    const orphan = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'move-4',
          kind: 'move',
          selector: '#b',
          outerHTML: '<span id="b" class="item">B</span>',
          targetParentSelector: '#nowhere',
          targetParentOuterHTML: '',
        },
      ]),
    )
    assertEqual(orphan.results[0].status, 'preview', 'move: missing destination parent stays preview-only')
    assertEqual(orphan.results[0].reason, 'unresolved-target-parent', 'move: reason is unresolved-target-parent')

    const noop = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'move-5',
          kind: 'move',
          selector: '#a',
          outerHTML: '<span id="a" class="item">A</span>',
          targetParentSelector: '#panel',
          targetParentOuterHTML: '<div id="panel"></div>',
          beforeSelector: null,
        },
      ]),
    )
    assertEqual(noop.results[0].status, 'synced', 'move: appending the last child reports synced')
    assertEqual(noop.results[0].strategy, 'no-op', 'move: appending the last child is a no-op')
    assertEqual(adapter.state.writes.length, writeCount, 'move: no-op performs no write')
  })
}


// ------------------------------------- structure edits: fallback + safety

/** A resolvable-but-wrong `data-source` hint must not swallow the edit. */
async function testStructureFallsThroughWrongHint() {
  await withWorkspace(async (root) => {
    await writeAt(
      root,
      'demo/index.html',
      '<!doctype html>\n<html>\n  <body>\n    <header id="top">\n      <button id="open-card" class="btn" type="button">New card</button>\n    </header>\n  </body>\n</html>\n',
    )
    await writeAt(root, 'demo/app.js', "var vehicle = { name: 'x' }\n")
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(
        root,
        adapter,
        [
          {
            id: 'hint-miss-1',
            kind: 'remove',
            selector: '#open-card',
            outerHTML: '<button id="open-card" class="btn" type="button">New card</button>',
            textSnippet: 'New card',
            textBefore: 'New card',
            sourceHints: { file: 'demo/app.js', line: 18 },
          },
        ],
        { page: { url: 'http://127.0.0.1:5173/demo/index.html' } },
      ),
    )
    assertEqual(out.results[0].status, 'synced', 'routing: wrong hint falls through to the URL mapping')
    assertEqual(out.results[0].file, 'demo/index.html', 'routing: the URL-mapped page is written')
    const js = await readAt(root, 'demo/app.js')
    assertEqual(js, "var vehicle = { name: 'x' }\n", 'routing: the hinted JS file is untouched')
  })
}

/** An existing mapped file that lacks the element must not suppress search. */
async function testStructureSearchAfterMappedFileMiss() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', '<!doctype html>\n<html>\n  <body>\n    <div id="root"></div>\n  </body>\n</html>\n')
    await writeAt(root, 'src/Panel.html', '<section class="panel">\n  <h2 class="panel-title">Settings</h2>\n</section>\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'shell-1',
          kind: 'remove',
          selector: 'section.panel',
          outerHTML: '<section class="panel"><h2 class="panel-title">Settings</h2></section>',
          textSnippet: 'Settings',
          textBefore: 'Settings',
        },
      ]),
    )
    assertEqual(out.results[0].status, 'synced', 'routing: mapped shell without the element falls through to search')
    assertEqual(out.results[0].file, 'src/Panel.html', 'routing: searched component file is written')
    const panel = await readAt(root, 'src/Panel.html')
    assert(!panel.includes('section class="panel"'), 'routing: the searched file lost the removed element')
  })
}

/** Structure edits never cut JS/JSX (no HTML tokenizer over component code). */
async function testStructureRefusesJsSources() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', '<!doctype html>\n<html>\n  <body>\n    <div id="root"></div>\n  </body>\n</html>\n')
    const jsx = [
      'export function Card(props) {',
      '  return (',
      '    <section className="card">',
      '      <h2 className="title">Title</h2>',
      '    </section>',
      '  )',
      '}',
      '',
    ].join('\n')
    await writeAt(root, 'src/Card.jsx', jsx)
    const adapter = createAdapter()
    const removed = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'jsx-remove-1',
          kind: 'remove',
          selector: 'section.card',
          outerHTML: '<section class="card"><h2 class="title">Title</h2></section>',
          textSnippet: 'Title',
          textBefore: 'Title',
          sourceHints: { file: 'src/Card.jsx' },
        },
      ]),
    )
    assertEqual(removed.results[0].status, 'preview', 'jsx: structure edit on a .jsx source stays preview-only')
    assertEqual(removed.results[0].reason, 'unsupported-js-source', 'jsx: reason names the JS source limit')
    assertEqual(await readAt(root, 'src/Card.jsx'), jsx, 'jsx: the component file is byte-identical')

    const text = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'jsx-text-1',
          kind: 'text',
          selector: 'h2.title',
          outerHTML: '<h2 class="title">Title</h2>',
          textBefore: 'Title',
          textAfter: 'Renamed',
          sourceHints: { file: 'src/Card.jsx' },
        },
      ]),
    )
    assertEqual(text.results[0].file, 'src/Card.jsx', 'jsx: text edits are still routed into the .jsx file')
    assert(text.results[0].status !== 'failed', 'jsx: text edits are not blocked by the structure JS gate')
  })
}

/** Structure edits locate through the pre-mutation text anchor. */
async function testStructureLocatesByTextSnippet() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', '<!doctype html>\n<html>\n  <body>\n    <div id="wrap">\n      <p class="note">Only appears once</p>\n    </div>\n  </body>\n</html>\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        { id: 'snippet-1', kind: 'remove', selector: '.note', textSnippet: 'Only appears once' },
      ]),
    )
    assertEqual(out.results[0].status, 'synced', 'text anchor: remove locates through textSnippet alone')
    assert(!(await readAt(root, 'index.html')).includes('Only appears once'), 'text anchor: the element is gone')
  })
}

/** A truncated outerHTML may never verify a stale DOM path by a text prefix. */
async function testTruncatedOuterHtmlCannotVerifyStalePath() {
  await withWorkspace(async (root) => {
    const body =
      '<!doctype html>\n<html>\n  <body>\n    <p class="x">Same opening words here</p>\n    <p class="x">Same opening words here</p>\n  </body>\n</html>\n'
    await writeAt(root, 'index.html', body)
    const adapter = createAdapter()
    const stale = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'trunc-stale-1',
          kind: 'remove',
          selector: 'p.x',
          path: [0, 0],
          outerHTML: '<p class="y">Same opening words here</p>',
          outerHTMLTruncated: true,
          textSnippet: 'Same opening words here',
        },
      ]),
    )
    assertEqual(stale.results[0].status, 'preview', 'truncated: a stale path is not accepted for a truncated payload')
    assertEqual(adapter.state.writes.length, 0, 'truncated: nothing is written when the path cannot be verified')
    assertEqual(await readAt(root, 'index.html'), body, 'truncated: both paragraphs survive')

    const good = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'trunc-good-1',
          kind: 'remove',
          selector: 'p.x',
          path: [0, 0],
          outerHTML: '<p class="x">Same opening words here</p>',
          outerHTMLTruncated: true,
          textSnippet: 'Same opening words here',
        },
      ]),
    )
    assertEqual(good.results[0].status, 'synced', 'truncated: a verified path still resolves the intended element')
    const after = await readAt(root, 'index.html')
    assertEqual(countOccurrences(after, '<p class="x">'), 1, 'truncated: exactly one paragraph removed')
  })
}

/** Move uses the runtime DOM path when the destination has no usable selector. */
async function testMoveUsesRuntimeDomPathFallback() {
  await withWorkspace(async (root) => {
    await writeAt(
      root,
      'index.html',
      '<!doctype html>\n<html>\n  <body>\n    <div id="list">\n      <p id="a">A</p>\n      <div class="slot"></div>\n      <div class="slot"></div>\n    </div>\n  </body>\n</html>\n',
    )
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'move-path-1',
          kind: 'move',
          selector: '#a',
          outerHTML: '<p id="a">A</p>',
          targetParentSelector: '',
          targetParentPath: [0, 0, 2],
          targetParentOuterHTML: '<div class="slot"></div>',
          beforeSelector: null,
        },
      ]),
    )
    assertEqual(out.results[0].status, 'synced', 'move path: classless repeated destination resolved through the DOM path')
    const content = await readAt(root, 'index.html')
    assert(/<div class="slot">\s*<p id="a">A<\/p>\s*<\/div>\s*<\/div>/.test(content), 'move path: element became the last child of the second slot')
  })
}

/** `insert` is the inverse of `remove` and must restore captured markup. */
async function testInsertRestoresRemovedMarkup() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', '<!doctype html>\n<html>\n  <body>\n    <div id="wrap">\n    </div>\n  </body>\n</html>\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'insert-1',
          kind: 'insert',
          selector: '',
          html: '<p id="back">Restored</p>',
          targetParentSelector: '#wrap',
          beforeSelector: null,
        },
      ]),
    )
    assertEqual(out.results[0].status, 'synced', 'insert: captured markup is written back')
    assertEqual(out.results[0].strategy, 'html-insert', 'insert: strategy is html-insert')
    const content = await readAt(root, 'index.html')
    assert(content.includes('<p id="back">Restored</p>'), 'insert: markup present in the source')
    assert(content.indexOf('<p id="back">') > content.indexOf('<div id="wrap">'), 'insert: markup lands inside the target parent')
    assert(content.indexOf('<p id="back">') < content.lastIndexOf('</div>'), 'insert: markup stays before the parent close')
  })
}

/** A server-issued handle addresses one element even when the selector is ambiguous. */
async function testElementHandleDisambiguatesRepeatedMarkup() {
  await withWorkspace(async (root) => {
    await writeAt(
      root,
      'index.html',
      '<!doctype html>\n<html>\n  <body>\n    <div id="left">\n      <span class="icon"></span>\n    </div>\n    <div id="right">\n      <span class="icon"></span>\n    </div>\n  </body>\n</html>\n',
    )
    const adapter = createAdapter()
    const first = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'handle-1',
          kind: 'attr',
          selector: '#right > span.icon',
          path: [0, 1, 0],
          attrName: 'data-mark',
          attrAfter: '1',
        },
      ]),
    )
    assertEqual(first.results[0].status, 'synced', 'handle: first edit lands (path anchored)')
    const handle = first.results[0].handle
    assert(handle && typeof handle.openStart === 'number' && typeof handle.openTagDigest === 'string', 'handle: result carries a handle')

    const second = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'handle-2',
          kind: 'remove',
          selector: 'span.icon',
          handle,
        },
      ]),
    )
    assertEqual(second.results[0].status, 'synced', 'handle: ambiguous selector resolves through the handle')
    const content = await readAt(root, 'index.html')
    assertEqual(countOccurrences(content, 'class="icon"'), 1, 'handle: exactly one icon remains')
    assert(content.includes('<div id="left">\n      <span class="icon"></span>'), 'handle: the untouched icon is the first one')
  })
}

/** Preview results carry the candidate files + reasons for the UI. */
async function testPreviewCarriesCandidateDiagnostics() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', '<!doctype html>\n<html>\n  <body>\n    <div id="root"></div>\n  </body>\n</html>\n')
    await writeAt(root, 'hint.html', '<!doctype html>\n<html>\n  <body>\n    <div id="other"></div>\n  </body>\n</html>\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'diag-1',
          kind: 'remove',
          selector: '.missing-thing',
          textSnippet: 'missing thing',
          sourceHints: { file: 'hint.html' },
        },
      ]),
    )
    assertEqual(out.results[0].status, 'preview', 'diagnostics: unresolved structure edit stays preview-only')
    assert(Array.isArray(out.results[0].candidates) && out.results[0].candidates.length >= 2, 'diagnostics: every probed candidate is reported')
    const files = out.results[0].candidates.map((entry) => entry.file)
    assert(files.includes('hint.html') && files.includes('index.html'), 'diagnostics: hinted and URL-mapped files are both listed')
    assert(out.results[0].candidates.every((entry) => typeof entry.why === 'string' && entry.why !== ''), 'diagnostics: each candidate carries a reason')
    assertEqual(adapter.state.writes.length, 0, 'diagnostics: nothing is written')
  })
}


/** Undo-insert into a container addressed only by a cssPath (no id) resolves it. */
async function testInsertResolvesClassOnlyParent() {
  await withWorkspace(async (root) => {
    await writeAt(root, 'index.html', '<!doctype html>\n<html>\n  <body>\n    <section class="card-top">\n    </section>\n  </body>\n</html>\n')
    const adapter = createAdapter()
    const out = await syncEdits(
      makeDeps(root, adapter, [
        {
          id: 'insert-class-1',
          kind: 'insert',
          selector: '',
          html: '<span class="badge">New</span>',
          targetParentSelector: 'body > section.card-top',
          beforeSelector: null,
        },
      ]),
    )
    assertEqual(out.results[0].status, 'synced', 'insert: class-only parent resolved by selector tokens')
    assert((await readAt(root, 'index.html')).includes('<span class="badge">New</span>'), 'insert: snippet written into the class-marked parent')
  })
}

// ----------------------------------------------------------------- runner

const tests = [
  ['html url mapping + override block create/update/no-op', testHtmlUrlMappingAndOverrideBlock],
  ['html text + attribute edits (child tags preserved)', testHtmlTextAndAttributeEdits],
  ['css hint rule update + missing rule append', testCssHintUpdateAndAppend],
  ['page outside the workspace root is preview-only', testOutsideWorkspaceIsPreview],
  ['read-only policy never writes (defensive)', testReadOnlyPolicyNeverWrites],
  ['stale write retried once then synced', testStaleVersionRetriedOnce],
  ['unmatched selector stays preview-only', testUnresolvedElementIsPreview],
  ['fallback search finds a file by class token', testFallbackSearchByClassToken],
  ['oversized source file fails with file-too-large', testFileTooLargeFails],
  ['BOM and CRLF preserved', testBomAndCrlfPreserved],
  ['unsafe attribute edits stay preview-only', testUnsafeAttributesStayPreview],
  ['urlRoot mapping, directory index, origin mismatch', testUrlRootMappingAndDirectoryIndex],
  ['explicit hints take priority over URL mapping', testHintsTakePriorityOverUrl],
  ['element location by outerHTML and textBefore', testOuterHtmlAndTextBeforeLocation],
  ['multiple files get one write each', testMultipleFilesOneWriteEach],
  ['missing hinted stylesheet is created', testMissingCssHintCreatesFile],
  ['attribute removal', testAttributeRemoval],
  ['fallback search finds a stylesheet by class token', testStyleSearchFindsStylesheet],
  ['HTML-entity-safe text replacement', testEntitySafeTextReplacement],
  ['hint workspace fallback when sourceRoot is a subdirectory', testHintWorkspaceFallbackWhenSourceRootIsSubdir],
  ['served asset resolved by unique basename', testServedAssetResolvedByUniqueBasename],
  ['pure insertion into a text node', testPureInsertionTextEdit],
  ['text span across a source line break', testTextSpanAcrossSourceLineBreak],
  ['remove element (subtree) from markup', testRemoveElementFromMarkup],
  ['move element (reorder / re-parent) in markup', testMoveElementInMarkup],
  ['structure: wrong hint falls through to URL mapping', testStructureFallsThroughWrongHint],
  ['structure: mapped file miss falls through to search', testStructureSearchAfterMappedFileMiss],
  ['structure: JS/JSX sources are refused, text edits still work', testStructureRefusesJsSources],
  ['structure: locate by textSnippet anchor', testStructureLocatesByTextSnippet],
  ['structure: truncated outerHTML cannot verify a stale path', testTruncatedOuterHtmlCannotVerifyStalePath],
  ['structure: move destination resolved by DOM path', testMoveUsesRuntimeDomPathFallback],
  ['structure: insert restores removed markup', testInsertRestoresRemovedMarkup],
  ['structure: insert resolves a class-only parent', testInsertResolvesClassOnlyParent],
  ['structure: element handle disambiguates repeated markup', testElementHandleDisambiguatesRepeatedMarkup],
  ['structure: preview carries candidate diagnostics', testPreviewCarriesCandidateDiagnostics],
]

let caseCount = 0
for (const [name, run] of tests) {
  console.log('# ' + name)
  try {
    await run()
    caseCount += 1
  } catch (error) {
    failures += 1
    console.error('FAIL - ' + name + ' threw — ' + ((error && error.stack) || error))
  }
}

await rm(TEMP_ROOT, { recursive: true, force: true }).catch(() => {})

if (failures > 0) {
  console.error('\n' + failures + ' source-sync failure(s)')
  process.exit(1)
}
console.log('\n' + caseCount + ' source-sync test groups ok')
