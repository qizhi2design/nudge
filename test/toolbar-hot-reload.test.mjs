/**
 * Host toolbar auto-reload switch test.
 *
 * The switch used to be a bare RefreshCw icon, so "on" and "off" were only
 * distinguishable from the tooltip. This test renders the real toolbar with
 * React's server renderer and asserts the state is carried by markup (label,
 * aria-pressed, data attributes, switch track/knob) in both directions, plus
 * the pending and feature-disabled variants. `hotReloadVisual` is a pure
 * helper so the on/off palettes can be compared without a DOM.
 */
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import * as JsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'

let failures = 0
let checks = 0
function assert(condition, name) {
  checks += 1
  if (condition) console.log('ok - ' + name)
  else {
    failures += 1
    console.error('FAIL - ' + name)
  }
}
function includes(haystack, needle, name) {
  assert(String(haystack).includes(needle), name + ' (' + needle + ')')
}

// --------------------------------------------------------------- component bundle
const entry = fileURLToPath(new URL('../src/client/ui/toolbar.tsx', import.meta.url))
const built = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  target: 'es2020',
  jsx: 'transform',
  external: ['react', 'react/jsx-runtime'],
  logLevel: 'silent',
})
const bundleModule = { exports: {} }
runInNewContext(built.outputFiles[0].text, {
  module: bundleModule,
  exports: bundleModule.exports,
  require(id) {
    if (id === 'react') return React
    if (id === 'react/jsx-runtime') return JsxRuntime
    throw new Error('unexpected require: ' + id)
  },
  console,
  process,
  setTimeout,
  clearTimeout,
})
const { InspectorToolbar, hotReloadVisual } = bundleModule.exports
assert(typeof InspectorToolbar === 'function', 'toolbar component loads from the TSX source')
assert(typeof hotReloadVisual === 'function', 'hot-reload visual helper is exported')

// ---------------------------------------------------------------------- locale
const zhSource = JSON.parse(await readFile(new URL('../locale/zh.json', import.meta.url), 'utf8'))
const dict = {}
function flatten(source, prefix) {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix === '' ? key : prefix + '.' + key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) flatten(value, path)
    else dict[path] = value
  }
}
flatten(zhSource, '')
const t = (key, vars) => {
  let text = dict[key] === undefined ? key : dict[key]
  for (const [name, value] of Object.entries(vars || {})) text = text.replaceAll('{' + name + '}', String(value))
  return text
}

// ----------------------------------------------------------------------- theme
const LIGHT = {
  brand: '#0f1115',
  base: '#ffffff',
  layer1: '#ffffff',
  layer2: '#ffffff',
  layer3: '#ffffff',
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
const DARK = { ...LIGHT, base: '#151517', layer1: '#232324', layer2: '#2c2c2e', accent: '#7aaaff', text: '#f9fafb', muted: '#cfd3d6', isDark: true }

function props(overrides) {
  return {
    t,
    theme: LIGHT,
    tab: { url: 'http://127.0.0.1:4173/index.html', canGoBack: true, canGoForward: false, mode: 'browse' },
    carrierKind: 'webview',
    canUndo: true,
    canRedo: false,
    onBack() {},
    onForward() {},
    onReload() {},
    onNavigate() {
      return true
    },
    onMode() {},
    onUndo() {},
    onRedo() {},
    onExternal() {},
    onToggleDom() {},
    onToggleWorkspace() {},
    onToggleHotReload() {},
    hotReload: true,
    reloadPending: false,
    features: { annotate: true, edit: true, domTree: true, workspaceVersions: true, hotReload: true },
    ...overrides,
  }
}
function render(overrides) {
  return renderToStaticMarkup(React.createElement(InspectorToolbar, props(overrides)))
}

// ------------------------------------------------------------------- ON state
const on = render({ hotReload: true })
includes(on, 'data-hot-reload-toggle=""', 'switch ships a stable hook for the DOM contract')
includes(on, 'data-hot-reload-state="on"', 'enabled switch exposes the on state')
includes(on, 'aria-pressed="true"', 'enabled switch reports pressed to assistive tech')
includes(on, '自动刷新', 'enabled switch keeps the visible product label')
includes(on, 'aria-label="自动刷新已开启，点击关闭"', 'enabled tooltip/aria label explains the click action')
assert(!on.includes('data-hot-reload-track'), 'no separate switch track: the selected pill carries the state')
includes(on, 'background:color-mix(in srgb, #4176e6 12%, transparent)', 'selected pill paints an accent tint')
includes(on, 'border-color:color-mix(in srgb, #4176e6 36%, transparent)', 'selected pill draws an accent border')
assert(!on.includes('data-hot-reload-pending'), 'no pending marker while the page is current')

// -------------------------------------------------- responsive panel labels
includes(on, '>DOM 树</span>', 'wide toolbar labels the DOM panel entry')
includes(on, '>工作区版本</span>', 'wide toolbar labels the workspace panel entry')
includes(on, 'aria-label="DOM 树"', 'DOM panel entry keeps its accessible name')
includes(on, 'aria-label="工作区版本"', 'workspace panel entry keeps its accessible name')
includes(on, 'aria-pressed="false"', 'closed panel entries expose their pressed state')
assert((on.match(/width:auto/g) || []).length >= 2, 'labeled panel entries override the fixed 28px icon width')
assert(on.includes('dshnudge-w-7'), 'icon size class is still present; the inline auto width wins over it')

// ------------------------------------------------------------------ OFF state
const off = render({ hotReload: false })
includes(off, 'data-hot-reload-state="off"', 'disabled switch exposes the off state')
includes(off, 'aria-pressed="false"', 'disabled switch is not pressed')
includes(off, '自动刷新', 'disabled switch still names the product feature')
includes(off, 'aria-label="自动刷新已关闭，点击开启"', 'disabled tooltip explains how to turn it on')
includes(off, 'background:transparent', 'unselected pill stays untinted')
includes(off, 'border-color:var(--dsw-alias-border-l2, #0000001f)', 'unselected pill keeps a neutral outline')

// --------------------------------------------------------------- pending state
const pending = render({ hotReload: true, reloadPending: true })
includes(pending, 'data-hot-reload-pending="true"', 'pending update is marked on the switch')
includes(pending, '待刷新', 'pending state swaps the label instead of hiding the switch')
includes(pending, 'aria-label="有更新待刷新，点击关闭自动刷新"', 'pending tooltip explains the update')
assert(pending.includes('dshnudge-hot-reload-pending'), 'pending pill breathes (CSS pulse hook present)')
assert(pending.includes('data-hot-reload-state="on"'), 'pending keeps the underlying on state')

// ------------------------------------------------------- disabled product feature
const featureOff = render({ features: { annotate: true, edit: true, domTree: true, workspaceVersions: true, hotReload: false } })
assert(!featureOff.includes('data-hot-reload-toggle'), 'feature switch hides the auto-reload control entirely')

// ------------------------------------------------------------- on/off palettes
const lightOn = hotReloadVisual(LIGHT, true, false)
const lightOff = hotReloadVisual(LIGHT, false, false)
const lightPending = hotReloadVisual(LIGHT, true, true)
const darkOn = hotReloadVisual(DARK, true, false)
function distinct(name, a, b) {
  assert(a !== b, name + ' is visually distinct (' + JSON.stringify(a) + ' vs ' + JSON.stringify(b) + ')')
}
distinct('light on/off background', lightOn.background, lightOff.background)
distinct('light on/off color', lightOn.color, lightOff.color)
distinct('light on/off border', lightOn.border, lightOff.border)
assert(lightOff.background === 'transparent', 'off state stays neutral (no tint) until hover')
assert(lightOn.background.includes(LIGHT.accent), 'selected pill tints with the host business accent')
assert(lightOn.color === LIGHT.accent, 'selected label uses the business accent ink')
assert(lightPending.color === LIGHT.warn, 'pending state uses the host warn token')
assert(lightPending.background !== lightOn.background, 'pending pill differs from the selected pill')
assert(darkOn.color === DARK.accent, 'dark theme reads its own accent for the selected pill')

console.log('\n' + checks + ' checks / ' + failures + ' failures')
if (failures > 0) process.exitCode = 1
