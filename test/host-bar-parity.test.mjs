/**
 * Guard: in fullscreen the dock hosts the annotate bar in the host layer (the
 * page sits in a webview under the input box). That host bar must stay a
 * pixel-faithful clone of the page runtime's bar — same palette, same Lucide
 * glyph geometry, same dimensions. If the runtime bar is restyled, this test
 * fails so the clone cannot silently drift and change the feature's look.
 */
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

let failures = 0
let checks = 0
function assert(condition, name) {
  checks += 1
  if (!condition) {
    failures += 1
    console.error('FAIL - ' + name)
  }
}

/** Extract one object-literal initializer (`NAME = { ... }`) with brace matching. */
function extractLiteral(source, name) {
  const match = new RegExp('(?:^|[^\\w$.])' + name + '\\s*=\\s*\\{').exec(source)
  if (match === null) return null
  const start = source.indexOf('{', match.index)
  let depth = 0
  let quote = ''
  let escaped = false
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const char = source[cursor]
    if (quote !== '') {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, cursor + 1)
    }
  }
  return null
}

function evalLiteral(text) {
  return runInNewContext('(' + text + ')', {})
}

const runtimeSource = await readFile(new URL('../lib/runtime.js', import.meta.url), 'utf8')
const clientSource = await readFile(new URL('../src/client/domains/composer/floating.ts', import.meta.url), 'utf8')

// ------------------------------------------------------------- palette
const runtimeLight = evalLiteral(extractLiteral(runtimeSource, 'OVERLAY_LIGHT'))
const runtimeDark = evalLiteral(extractLiteral(runtimeSource, 'OVERLAY_DARK'))
const cloneLight = evalLiteral(extractLiteral(clientSource, 'ANNOTATION_BAR_LIGHT'))
const cloneDark = evalLiteral(extractLiteral(clientSource, 'ANNOTATION_BAR_DARK'))
assert(runtimeLight !== null && runtimeDark !== null, 'the runtime overlay palette is readable')
assert(cloneLight !== null && cloneDark !== null, 'the host bar palette is readable')
for (const key of ['bgStrong', 'border', 'text', 'muted', 'hover', 'accent', 'onAccent', 'barShadow']) {
  assert(cloneLight[key] === runtimeLight[key], 'host bar light ' + key + ' matches the page bar')
  assert(cloneDark[key] === runtimeDark[key], 'host bar dark ' + key + ' matches the page bar')
}

// --------------------------------------------------------------- glyphs
const runtimeIcons = evalLiteral(extractLiteral(runtimeSource, 'LUCIDE_ICON_NODES'))
const cloneIcons = evalLiteral(extractLiteral(clientSource, 'FLOATING_BAR_ICONS'))
assert(runtimeIcons !== null && cloneIcons !== null, 'both icon tables are readable')
/** Attribute values are stringified at render time on both sides. */
function normalizeGlyph(nodes) {
  return JSON.stringify(
    (nodes || []).map((node) => [
      node[0],
      Object.fromEntries(
        Object.entries(node[1] || {})
          .map(([key, value]) => [key, String(value)])
          .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)),
      ),
    ]),
  )
}
for (const name of ['grip', 'locate', 'eye', 'eyeOff', 'trash', 'close']) {
  assert(
    normalizeGlyph(cloneIcons[name]) === normalizeGlyph(runtimeIcons[name]),
    'host bar ' + name + ' glyph matches the runtime Lucide node',
  )
}

// ------------------------------------------------------------- geometry
assert(
  clientSource.includes("height: '48px'") &&
    clientSource.includes("padding: '6px 8px 6px 6px'") &&
    clientSource.includes("borderRadius: '14px'"),
  'host bar root mirrors the 48px / 14px / 6px 8px 6px 6px page pill',
)
assert(
  clientSource.includes("width: '22px'") && clientSource.includes("height: '30px'") && clientSource.includes("touchAction: 'none'"),
  'host bar grip mirrors the 22x30 draggable handle',
)
assert(
  clientSource.includes("width: '28px'") && clientSource.includes("borderRadius: '8px'"),
  'host bar icon buttons mirror the 28px / 8px page controls',
)
assert(
  clientSource.includes("padding: '0 14px'") && clientSource.includes("borderRadius: '10px'") && clientSource.includes("margin: '0px 2px 0px 8px'"),
  'host bar send button mirrors the 30px / 10px page send control',
)
assert(
  clientSource.includes("fontWeight: '600'") && clientSource.includes("fontSize: '12.5px'"),
  'host bar count mirrors the page bar typography',
)

if (failures > 0) {
  console.error('\n' + failures + ' of ' + checks + ' host-bar parity check(s) failed')
  process.exit(1)
}
console.log(checks + ' host-bar parity checks passed')
