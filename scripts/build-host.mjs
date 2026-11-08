/**
 * Build the Node host half of dsh.nudge.
 *
 * The host is a real ESM graph split by domain under `src/host/`:
 *
 *   - `lib/index.js`       compiled 1:1 from `src/host/index.ts` (no bundling, so
 *                          its `import { syncEdits } from './source-sync.js'` and
 *                          `import { createWorkspaceDomain } from './workspace.js'`
 *                          keep pointing at the sibling artifacts);
 *   - `lib/source-sync.js` single-file ESM bundle of the persistence domain
 *                          (`src/host/domains/persistence/**`), entry is the thin
 *                          facade `src/host/source-sync.ts`;
 *   - `lib/workspace.js`   single-file ESM bundle of the workspace domain
 *                          (`src/host/domains/workspace/**`), entry is the thin
 *                          facade `src/host/workspace.ts`.
 *
 * `node:*` builtins stay external. All three files are build artifacts; never
 * edit `lib/*.js` by hand.
 *
 * Run: node scripts/build.mjs (or node scripts/build-host.mjs)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, transform } from 'esbuild'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const hostDir = join(root, 'src', 'host')
const libDir = join(root, 'lib')

await mkdir(libDir, { recursive: true })

// 1. lib/index.js — one-to-one TypeScript transform of the host entry.
const indexSource = await readFile(join(hostDir, 'index.ts'), 'utf8')
const indexCompiled = await transform(indexSource, {
  loader: 'ts',
  format: 'esm',
  target: 'es2020',
  legalComments: 'none',
})
if (indexCompiled.warnings.length > 0) {
  for (const warning of indexCompiled.warnings) process.stderr.write('host:index warning: ' + warning.text + '\n')
}
const indexCode = indexCompiled.code
await writeFile(join(libDir, 'index.js'), indexCode, 'utf8')

const messages = ['built ' + join(libDir, 'index.js') + ' (' + indexCode.length + ' bytes)']

// 2. One-file ESM bundles for the domain facades.
const bundles = [
  { name: 'source-sync', label: 'persistence bundle' },
  { name: 'workspace', label: 'workspace bundle' },
]
for (const entry of bundles) {
  const result = await build({
    entryPoints: [join(hostDir, entry.name + '.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2020',
    legalComments: 'none',
    logLevel: 'silent',
  })
  const code = result.outputFiles[0].text
  await writeFile(join(libDir, entry.name + '.js'), code, 'utf8')
  messages.push(
    'built ' + join(libDir, entry.name + '.js') + ' (' + code.length + ' bytes, ' + entry.label + ')',
  )
}

process.stdout.write(messages.join('\n') + '\n')
