// @ts-nocheck
/**
 * dsh.nudge — host workspace domain: pure path and containment helpers.
 *
 * Every path crossing the remote API is a normalised POSIX path relative to the
 * session `sourceRoot`. These helpers are the single place that enforces the
 * traversal rules from docs/workspace-versions.md §2; they perform no I/O
 * except `realpathWithinRoot`, which only stats the path chain.
 *
 * No top-level side effects.
 */

import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { realpath } from 'node:fs/promises'

/** Directory names that are never scanned, watched or served. */
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.dsh',
])

/** True when a bare directory/file name must be skipped (dot entries included). */
export function isIgnoredName(name) {
  if (typeof name !== 'string' || name.length === 0) return false
  if (IGNORED_DIRECTORY_NAMES.has(name)) return true
  // Every dot directory and dot file is skipped, matching the contract's
  // "dot directories" rule.
  return name.startsWith('.')
}

/** True when any segment of a POSIX relative path is ignored. */
export function isIgnoredRelativePath(path) {
  if (typeof path !== 'string' || path.length === 0) return true
  return path.split('/').some((segment) => isIgnoredName(segment))
}

/**
 * Relative container check on already-resolved absolute paths.
 * @returns {boolean} true when `child` is `parent` itself or lives inside it.
 */
export function isInsideOrEqual(parent, child) {
  if (typeof parent !== 'string' || typeof child !== 'string') return false
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** POSIX relative path from `from` to `to`, '' when equal, null when outside. */
export function relativePosix(from, to) {
  if (typeof from !== 'string' || typeof to !== 'string' || from.length === 0 || to.length === 0) return null
  const rel = relative(from, to)
  if (rel === '') return ''
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return rel.split(sep).join('/')
}

/**
 * Validate and normalise one remote path value.
 *
 * Rejects: non-strings, empty strings, absolute paths (POSIX, drive-letter and
 * UNC), NUL bytes, backslash separators, `.`/`..`/empty segments and `.git`
 * segments. Returns a `/`-separated normalised POSIX path.
 */
export function normalizeRelativePath(input, label = 'path') {
  if (typeof input !== 'string') throw new Error(label + ' must be a string')
  const value = input.trim()
  if (value.length === 0) throw new Error(label + ' must not be empty')
  if (value.includes('\u0000')) throw new Error(label + ' must not contain NUL characters')
  if (value.startsWith('/') || value.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new Error(label + ' must be relative to the source root')
  }
  if (value.includes('\\')) throw new Error(label + ' must use / as the path separator')
  const segments = value.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(label + ' must be a normalised relative path')
    }
    if (segment.toLowerCase() === '.git') {
      throw new Error(label + ' must not point inside .git')
    }
  }
  return segments.join('/')
}

/** Convert a sourceRoot-relative path to a repo-root-relative one, null when outside. */
export function toRepoRelative(relativeRoot, file) {
  if (!relativeRoot) return file
  if (file === relativeRoot) return ''
  const prefix = relativeRoot + '/'
  return file.startsWith(prefix) ? file.slice(prefix.length) : null
}

/** Resolve `absolutePath` and prove it stays inside `rootReal` (symlink escape fence). */
export async function realpathWithinRoot(rootReal, absolutePath) {
  const root = String(rootReal)
  let cursor = String(absolutePath)
  const tail = []
  for (let guard = 0; guard < 128; guard += 1) {
    try {
      const real = await realpath(cursor)
      const resolved = tail.length > 0 ? join(real, ...tail.slice().reverse()) : real
      return isInsideOrEqual(root, resolved) ? resolved : null
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
      const parent = dirname(cursor)
      if (parent === cursor) return null
      tail.push(basename(cursor))
      cursor = parent
    }
  }
  return null
}
