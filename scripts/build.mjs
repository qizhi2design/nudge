/**
 * Build orchestrator for the three dsh.nudge artifacts.
 *
 * Each half has its own build script and its own output file, so a change in
 * one domain never has to rebuild the others by hand:
 *
 *   - `lib/runtime.js`   from scripts/build-runtime.mjs (page-injected runtime)
 *   - `lib/index.js`     from scripts/build-host.mjs    (Node host half)
 *   - `lib/source-sync.js` from scripts/build-host.mjs  (host persistence domain)
 *   - `lib/client.js`    from scripts/build-client.mjs  (web Client bundle)
 *
 * Run: npm run build
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const STEPS = [
  ['runtime', 'build-runtime.mjs'],
  ['host', 'build-host.mjs'],
  ['client', 'build-client.mjs'],
]

for (const [label, script] of STEPS) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', script)], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.error) {
    process.stderr.write('build:' + label + ' could not start: ' + result.error.message + '\n')
    process.exit(1)
  }
  if (result.status !== 0) {
    process.stderr.write('build:' + label + ' failed with exit ' + result.status + '\n')
    process.exit(result.status === null ? 1 : result.status)
  }
}
