// @ts-nocheck
/**
 * dsh.nudge — host workspace domain facade.
 *
 * Composes the three capabilities from docs/workspace-versions.md §4:
 *   git.ts      repository state, log, branch switch, file restore, commit
 *   files.ts    bounded HTML scan
 *   preview.ts  per-root static preview server + change watcher
 *
 * `src/host/workspace.ts` re-exports `createWorkspaceDomain` so
 * `scripts/build-host.mjs` can emit `lib/workspace.js`; `src/host/index.ts`
 * imports it back through the sibling artifact and wires the eight remote
 * methods (`workspace`, `gitLog`, `gitSwitch`, `gitRestoreFile`, `gitCommit`,
 * `previewOpen`, `previewStop`, `watchPoll`).
 *
 * Session resolution stays in `src/host/index.ts` (the remote layer passes the
 * `requireSession` / `sessionCwd` / `sessionPolicy` / `resolveSourceRoot`
 * helpers in) so the policy fence and error prefix live in one place.
 *
 * No top-level side effects.
 */

import { isAbsolute, relative, sep } from 'node:path'
import { scanHtmlFiles } from './files.js'
import {
  gitCommit,
  gitLog,
  gitRestoreFile,
  gitSwitch,
  readGitState,
} from './git.js'
import { createPreviewService, createWatcherService } from './preview.js'

const DEFAULT_MAX_SCAN_FILES = 400

/**
 * @param {{
 *   ctx: any,
 *   config: any,
 *   requireSession: (sessionId: string) => any,
 *   sessionCwd: (session: any) => string | undefined,
 *   sessionPolicy: (session: any) => {mode: string, workspaceRoot: string},
 *   resolveSourceRoot: (session: any, cwd: string) => Promise<{root: string}>,
 * }} deps
 */
/**
 * Map an absolute file path under the source root to its `/`-separated relative
 * spelling. Relative input is passed through untouched so existing callers keep
 * the preview service's own validation and error messages.
 */
function normalizePreviewFile(root, file) {
  if (typeof file !== 'string' || file.trim() === '' || !isAbsolute(file)) return file
  const rel = relative(root, file)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('file ' + JSON.stringify(file) + ' is outside the session source root')
  }
  return rel.split(sep).join('/')
}

export function createWorkspaceDomain(deps) {
  const config = deps.config && typeof deps.config === 'object' ? deps.config : {}
  const maxScanFiles =
    typeof config.maxScanFiles === 'number' && Number.isFinite(config.maxScanFiles) && config.maxScanFiles > 0
      ? Math.floor(config.maxScanFiles)
      : DEFAULT_MAX_SCAN_FILES
  const preview = createPreviewService()
  const watcher = createWatcherService()

  /** Resolve one session into the cwd / sourceRoot / policy triple. */
  async function contextFor(sessionId) {
    const session = deps.requireSession(sessionId)
    const cwd = deps.sessionCwd(session)
    if (typeof cwd !== 'string' || cwd.length === 0) {
      throw new Error('this session has no working directory')
    }
    const policy = deps.sessionPolicy(session)
    const root = await deps.resolveSourceRoot(session, cwd)
    return { cwd, sourceRoot: root.root, policy }
  }

  /** Write operations are refused outright under a read-only standing policy. */
  function requireWritable(policy, action) {
    if (policy !== null && typeof policy === 'object' && policy.mode === 'read-only') {
      throw new Error('the current session policy is read-only and does not allow ' + action)
    }
  }

  return {
    /** §3.1 — workspace snapshot: policy, git facts, HTML scan, preview state. */
    async workspace(sessionId) {
      const context = await contextFor(sessionId)
      const git = await readGitState(context)
      const scan = await scanHtmlFiles({ sourceRoot: context.sourceRoot, maxScanFiles })
      const labels = new Map()
      for (const change of git.changes) labels.set(change.path, change.label)
      const htmlFiles = scan.files.map((file) => ({
        ...file,
        change: labels.has(file.path) ? labels.get(file.path) : null,
      }))
      return {
        sessionId,
        cwd: context.cwd,
        sourceRoot: context.sourceRoot,
        writable: context.policy.mode !== 'read-only',
        truncated: scan.truncated,
        git,
        htmlFiles,
        preview: preview.peek(context.sourceRoot),
      }
    },

    /** §3.2 — recent commits (read operation, no policy gate). */
    async gitLog(sessionId, file) {
      const context = await contextFor(sessionId)
      return gitLog(context, file)
    },

    /** §3.3 — switch branches; dirty refusal / stash mode. */
    async gitSwitch(sessionId, branch, options) {
      const context = await contextFor(sessionId)
      requireWritable(context.policy, 'switching branches')
      return gitSwitch(context, branch, options)
    },

    /** §3.4 — restore one file from a commit. */
    async gitRestoreFile(sessionId, file, commit) {
      const context = await contextFor(sessionId)
      requireWritable(context.policy, 'restoring files')
      return gitRestoreFile(context, file, commit)
    },

    /** §3.5 — commit selected files or everything. */
    async gitCommit(sessionId, message, files) {
      const context = await contextFor(sessionId)
      requireWritable(context.policy, 'committing changes')
      return gitCommit(context, message, files)
    },

    /**
     * §3.6 — start or reuse the static server for this sourceRoot.
     *
     * Chat file mentions resolve to absolute paths; the preview service serves
     * source-root-relative paths. Accept both spellings and let the preview
     * service keep its traversal guard.
     */
    async previewOpen(sessionId, file) {
      const context = await contextFor(sessionId)
      return preview.open(context.sourceRoot, normalizePreviewFile(context.sourceRoot, file))
    },

    /** §3.7 — stop the static server and watcher for this sourceRoot. */
    async previewStop(sessionId) {
      const context = await contextFor(sessionId)
      watcher.stop(context.sourceRoot)
      return preview.stop(context.sourceRoot)
    },

    /** §3.8 — start (or reuse) the watcher and report revision/state. */
    async watchPoll(sessionId) {
      const context = await contextFor(sessionId)
      return watcher.poll(context.sourceRoot)
    },

    /** Host-side teardown registered through `ctx.effect`. */
    async dispose() {
      watcher.dispose()
      await preview.dispose()
    },
  }
}
