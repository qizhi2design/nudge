// @ts-nocheck
/**
 * dsh.nudge — workspace versions domain facade (bundle entry).
 *
 * Mirrors `src/host/source-sync.ts`: this file stays a thin re-export so
 * `scripts/build-host.mjs` can bundle `src/host/domains/workspace/**` into
 * `lib/workspace.js`, and `src/host/index.ts` keeps importing
 * `{ createWorkspaceDomain } from './workspace.js'` (the compiled sibling
 * artifact in `lib/`).
 *
 * Contract: docs/workspace-versions.md §4.
 */

export { createWorkspaceDomain } from './domains/workspace/index.js'
