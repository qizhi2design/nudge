/**
 * Brand icon test: the shipped package artwork (`icon.svg`) and the in-app
 * `NudgeMark` are one product mark rendered twice — the gradient plate for the
 * package/plugin card, and `currentColor` for tab chips, menus and settings.
 *
 * This locks three things:
 *   1. `icon.svg` carries the right brand metadata (Nudge / 轻推, role img).
 *   2. Both files use the *same* 24-unit geometry. Edit them as a pair.
 *   3. Every surface that names the product uses the same mark instead of a
 *      generic cursor/pointer glyph.
 *
 * No build or browser is required; it reads source only.
 */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let checks = 0
let failures = 0
function assert(condition, name, detail) {
  checks += 1
  if (condition) console.log('ok - ' + name)
  else {
    failures += 1
    console.error('FAIL - ' + name + (detail === undefined ? '' : ' — ' + detail))
  }
}

const GEOMETRY_KEYS = ['x', 'y', 'width', 'height', 'rx', 'cx', 'cy', 'r', 'd', 'strokeWidth']
const SHAPE_ORDER = ['rect', 'path', 'circle', 'path']

function numeric(value) {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : value
}

function pickGeometry(attrs) {
  const shape = {}
  for (const key of GEOMETRY_KEYS) {
    if (key === 'd') {
      if (typeof attrs.d === 'string') shape.d = attrs.d.replace(/\s+/g, ' ')
    } else if (key in attrs) {
      shape[key] = numeric(attrs[key])
    }
  }
  return shape
}

/** Attribute map from an inline SVG tag string: `x="2.5" stroke-width="2"`. */
function svgAttributes(tag) {
  const attrs = {}
  for (const match of tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    attrs[key] = match[2]
  }
  return attrs
}

/** Attribute map from a `React.createElement('rect', { x: 2.5, ... })` block. */
function tsAttributes(block) {
  const attrs = {}
  for (const match of block.matchAll(/(\w+)\s*:\s*(?:'([^']*)'|"([^"]*)"|([-\d.]+))/g)) {
    attrs[match[1]] = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4]
  }
  return attrs
}

function readSvgMark(svg) {
  const open = svg.indexOf('id="nudge-mark"')
  assert(open !== -1, 'icon.svg declares the canonical `nudge-mark` group')
  const start = svg.indexOf('>', open) + 1
  const end = svg.indexOf('</g>', start)
  const body = svg.slice(start, end)
  const tags = body.match(/<(rect|path|circle)\b[^>]*>/g) || []
  const shapeTags = tags.map((tag) => tag.match(/^<(\w+)/)[1])
  assert(
    JSON.stringify(shapeTags) === JSON.stringify(SHAPE_ORDER),
    'icon.svg mark keeps the rect → path → circle → path drawing order',
    shapeTags.join(' '),
  )
  return tags.map((tag) => pickGeometry(svgAttributes(tag)))
}

function readMarkSource(source) {
  const start = source.indexOf('export function NudgeMark')
  assert(start !== -1, 'icons.ts exports the NudgeMark component')
  const end = source.indexOf('export const NudgeIcons', start)
  const body = source.slice(start, end)
  assert(body.includes("viewBox: '0 0 24 24'"), 'NudgeMark draws in the canonical 24-unit viewBox')
  assert(body.includes("stroke: 'currentColor'"), 'NudgeMark inherits the host text colour')
  const blocks = [...body.matchAll(/React\.createElement\('(rect|path|circle)',\s*\{([^}]*)\}\)/g)]
  const shapeTags = blocks.map((block) => block[1])
  assert(
    JSON.stringify(shapeTags) === JSON.stringify(SHAPE_ORDER),
    'NudgeMark keeps the same four shapes in the same order',
    shapeTags.join(' '),
  )
  return blocks.map((block) => pickGeometry(tsAttributes(block[2])))
}

function sameGeometry(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

const svg = await readFile(resolve(ROOT, 'icon.svg'), 'utf8')
const iconsSource = await readFile(resolve(ROOT, 'src/client/ui/icons.ts'), 'utf8')
const registerSource = await readFile(resolve(ROOT, 'src/client/platform/bootstrap/register.tsx'), 'utf8')
const browserSource = await readFile(resolve(ROOT, 'src/client/domains/browser/browser-entry.tsx'), 'utf8')
const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'))

// ---------------------------------------------------------------- metadata

assert(svg.includes('role="img"'), 'icon.svg is announced as an image')
assert(svg.includes('aria-label="Nudge"'), 'icon.svg carries the Nudge accessible name')
assert(svg.includes('<title>Nudge · 轻推</title>'), 'icon.svg carries the bilingual title')
assert(!svg.includes('Visual Inspector'), 'icon.svg no longer carries the retired Visual Inspector name')
assert(svg.includes('id="nudge-mark-gradient"'), 'icon.svg defines the brand gradient')
assert((svg.match(/url\(#nudge-mark-gradient\)/g) || []).length >= 3, 'the window, lens and handle use the brand gradient')
assert(
  pkg.exports && pkg.exports['./icon'] === './icon.svg',
  'package.json exports the brand icon as `dsh.nudge/icon`',
)
assert(Array.isArray(pkg.files) && pkg.files.includes('icon.svg'), 'the published package includes icon.svg')

// ---------------------------------------------------------------- geometry

const svgMark = readSvgMark(svg)
const markSource = readMarkSource(iconsSource)
assert(svgMark.length === markSource.length, 'icon.svg and NudgeMark ship the same shape count')

for (let index = 0; index < Math.min(svgMark.length, markSource.length); index += 1) {
  assert(
    sameGeometry(svgMark[index], markSource[index]),
    'shape ' + (index + 1) + ' (' + SHAPE_ORDER[index] + ') geometry matches icon.svg',
    JSON.stringify({ svg: svgMark[index], source: markSource[index] }),
  )
}

// ----------------------------------------------------- identity surfaces

const identitySlots = [
  ['tab chip', /function NudgeTabTitle[\s\S]{0,900}Icon\.nudge/],
  ['browser chooser row', /Icon\.nudge, \{ size: 16 \}/],
  ['browser tab menu row', /Icon\.nudge, \{ size: 12 \}/],
]
for (const [label, pattern] of identitySlots) {
  assert(pattern.test(browserSource), label + ' renders the product mark')
}
assert(
  /slots\.inject\('contextMenu\.icon'[\s\S]{0,500}Icon\.nudge/.test(registerSource),
  'the link context menu renders the product mark',
)
assert(
  /slots\.inject\('settings\.section\.icon'[\s\S]{0,900}Icon\.nudge/.test(registerSource),
  'the settings navigation renders the product mark',
)
assert(
  (registerSource.match(/Icon\.cursor/g) || []).length === 0,
  'no product identity surface falls back to the generic cursor glyph',
)

// ------------------------------------------------------------------- icon map

assert(
  /export const NudgeIcons = \{[\s\S]*NudgeMark,[\s\S]*\}/.test(iconsSource),
  'the UI icon map exposes NudgeMark to the non-TSX client parts',
)

console.log('\nbrand icon: ' + (checks - failures) + '/' + checks + ' checks passed')
if (failures > 0) {
  console.error(failures + ' brand icon check(s) failed')
  process.exit(1)
}
