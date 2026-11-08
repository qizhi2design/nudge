// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: path, target and error helpers.
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

import { isAbsolute, relative, sep } from 'node:path'

export function lineAt(text, index) {
  if (typeof index !== 'number' || !Number.isFinite(index) || index < 0) return undefined
  const limit = Math.min(text.length, Math.floor(index))
  let line = 1
  for (let cursor = 0; cursor < limit; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1
  }
  return line
}

export function newlineOf(content) {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

export function extensionOf(path) {
  const base = String(path).split('/').pop() || ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function editId(edit) {
  return String((edit && edit.id) !== undefined && (edit && edit.id) !== null ? edit.id : '')
}

export function pathOf(fs, target) {
  try {
    if (target && typeof fs.processPath === 'function') return fs.processPath(target)
  } catch {
    /* fall through to a structural fallback */
  }
  if (target && typeof target === 'object' && typeof target.path === 'string') return target.path
  return String(target)
}

export async function statOrUndefined(fs, target) {
  try {
    return await fs.stat(target)
  } catch {
    return undefined
  }
}

/** Workspace-relative POSIX path for a target inside cwd, or ''. */
export function workspaceRelative(ctx, target) {
  return relativePosix(ctx.cwdPath, pathOf(ctx.fs, target))
}

export function relativePosix(from, to) {
  if (typeof from !== 'string' || typeof to !== 'string') return ''
  const rel = relative(from, to)
  if (!rel || rel === '' || rel.startsWith('..') || isAbsolute(rel)) return ''
  return rel.split(sep).join('/')
}

export function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function reasonOf(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
