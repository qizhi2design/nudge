/**
 * Build the single-file page-injected Runtime bundle (`lib/runtime.js`).
 *
 * The Runtime is one IIFE closure in which every function and variable shares
 * the same scope, so it cannot be split into an ESM graph. It is instead split
 * by domain under `src/runtime/`, and each file is a *fragment* of that one
 * closure. This script concatenates the fragments in their original source
 * order, wraps them in the IIFE shell, transforms the TypeScript with esbuild
 * and writes `lib/runtime.js`.
 *
 * - `src/runtime/domains/<domain>/*.ts` and `src/runtime/lifecycle/*.ts` are
 *   fragments. Each starts with `// @ts-nocheck`, which is stripped here: a
 *   fragment references identifiers declared by sibling fragments, so it only
 *   type-checks as part of the concatenated closure (kept out of `tsc` noise).
 * - The numeric file-name prefixes encode the order inside the closure. The
 *   order is fixed and must not change: only `00-bootstrap` has top-level
 *   side effects that must run first, and `20-api` wires the public API last;
 *   everything else hoists, but keeping the original order keeps the build
 *   byte-for-byte equivalent to the pre-split single file.
 * - `lib/runtime.js` is a build artifact; never edit it by hand.
 *
 * Run: node scripts/build-runtime.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transform } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimeDir = join(root, 'src', 'runtime')
const outPath = join(root, 'lib', 'runtime.js')

const FRAGMENT_MARKER = '// @ts-nocheck\n'

/**
 * Runtime glyphs are the Lucide icons: the injected runtime cannot import
 * `lucide-react`, so the build reads the icon node data from the package and
 * embeds it as a plain data map that `overlayIcon()` renders.
 */
const LUCIDE_ICONS = {
  sliders: 'sliders-horizontal',
  locate: 'locate-fixed',
  close: 'x',
  check: 'check',
  message: 'message-square',
  send: 'send',
  trash: 'trash',
  pencil: 'pencil',
  palette: 'palette',
  type: 'type',
  eye: 'eye',
  eyeOff: 'eye-off',
  pin: 'map-pin',
  sparkles: 'sparkles',
  chevron: 'chevron-right',
  mic: 'mic',
  grip: 'grip-vertical',
}
const LUCIDE_DIR = join(root, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons')

async function readLucideIconNodes() {
  const out = {}
  for (const [name, file] of Object.entries(LUCIDE_ICONS)) {
    const modulePath = join(LUCIDE_DIR, file + '.mjs')
    if (!existsSync(modulePath)) throw new Error('missing lucide icon source: ' + modulePath)
    const mod = await import(pathToFileURL(modulePath).href)
    const node = mod.__iconData && Array.isArray(mod.__iconData.node) ? mod.__iconData.node : []
    out[name] = node.map(([tag, attrs]) => {
      const clean = {}
      for (const [key, value] of Object.entries(attrs || {})) {
        if (key !== 'key') clean[key] = value
      }
      return [tag, clean]
    })
  }
  return out
}

const lucideFragment = 'var LUCIDE_ICON_NODES = ' + JSON.stringify(await readLucideIconNodes()) + ';\n'

/**
 * Ordered Runtime fragments (original source order, lines 5-2961 of the
 * pre-split `inspector-runtime.ts`). Function declarations hoist, so position
 * only matters for the bootstrap fragment and the final API fragment, but the
 * list intentionally mirrors the original order.
 */
const PARTS = [
  'domains/core/00-bootstrap.ts',
  'domains/core/10-theme-locale.ts',
  'domains/core/20-dom.ts',
  'domains/core/30-selectors.ts',
  'domains/core/40-styles.ts',
  'domains/core/50-descriptor.ts',
  'domains/core/60-events.ts',
  'domains/overlay/10-chrome.ts',
  'domains/overlay/20-root.ts',
  'domains/overlay/30-parts.ts',
  'domains/overlay/40-visuals.ts',
  'domains/annotation/10-popover.ts',
  'domains/design/10-card.ts',
  'domains/annotation/20-text-selection.ts',
  'domains/selection/10-pointers.ts',
  'domains/selection/20-frame.ts',
  'domains/editing/10-apply.ts',
  'domains/annotation/30-api.ts',
  'domains/core/70-api-helpers.ts',
  'domains/interaction/10-handlers.ts',
  'lifecycle/10-lifecycle.ts',
  'lifecycle/20-api.ts',
]

/**
 * IIFE shell: original source lines 1-4 plus the closing lines 2962-2963 of the
 * pre-split file. `lifecycle/20-api.ts` ends just before `return 'ok'`.
 */
const HEADER = [
  '// @ts-nocheck',
  "/** dsh.nudge runtime: window.__DSH_NUDGE__ v1, returns 'ok'. */",
  ';(function () {',
  "\t'use strict'",
  '',
].join('\n')

const TAIL = ["\treturn 'ok'", '})()', ''].join('\n')

const pieces = []
for (const part of PARTS) {
  const path = join(runtimeDir, part)
  if (!existsSync(path)) throw new Error('missing runtime part: ' + path)
  const text = await readFile(path, 'utf8')
  if (!text.startsWith(FRAGMENT_MARKER)) {
    throw new Error('runtime part must start with "// @ts-nocheck": ' + path)
  }
  pieces.push(text.slice(FRAGMENT_MARKER.length))
}

const source = HEADER + lucideFragment + pieces.join('') + TAIL

const compiled = await transform(source, {
  loader: 'ts',
  target: 'es2020',
  legalComments: 'none',
})

await mkdir(join(root, 'lib'), { recursive: true })

const banner = `/**
 * dsh.nudge — Runtime half (generated by scripts/build-runtime.mjs).
 * Source: src/runtime/domains/<domain>/*.ts and src/runtime/lifecycle/*.ts (single shared IIFE scope).
 * Do not edit this file by hand; rerun node scripts/build-runtime.mjs after changing a fragment.
 */
`

const output = banner + compiled.code
await writeFile(outPath, output, 'utf8')
process.stdout.write(
  'built ' + outPath + ' (' + output.length + ' bytes, ' + PARTS.length + ' fragments)\n',
)
