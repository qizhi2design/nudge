// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: page-URL to source-file mapping and target resolution.
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

import { dirname, join } from 'node:path'

import { extensionOf, statOrUndefined, workspaceRelative, reasonOf } from '../shared/paths.js'

export function derivePageMapping(page, urlRoot) {
  const rawUrl = page && typeof page.url === 'string' ? page.url.trim() : ''
  if (!rawUrl) return { eligible: false, relativePath: null }
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { eligible: false, relativePath: null }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { eligible: false, relativePath: null }

  const configured = typeof urlRoot === 'string' ? urlRoot.trim() : ''
  let prefixPath = ''
  if (configured) {
    let rootUrl = null
    try {
      const candidate = new URL(configured)
      if (candidate.protocol === 'http:' || candidate.protocol === 'https:') rootUrl = candidate
    } catch {
      rootUrl = null
    }
    if (rootUrl) {
      if (parsed.origin !== rootUrl.origin) return { eligible: false, relativePath: null }
      prefixPath = rootUrl.pathname.replace(/\/+$/, '')
    } else {
      if (!isLoopbackHostname(parsed.hostname)) return { eligible: false, relativePath: null }
      const prefix = configured.startsWith('/') ? configured : '/' + configured
      prefixPath = prefix.replace(/\/+$/, '')
    }
    if (prefixPath !== '' && parsed.pathname !== prefixPath && !parsed.pathname.startsWith(prefixPath + '/')) {
      return { eligible: false, relativePath: null }
    }
  } else if (!isLoopbackHostname(parsed.hostname)) {
    return { eligible: false, relativePath: null }
  }

  const rest = prefixPath ? parsed.pathname.slice(prefixPath.length) : parsed.pathname
  if (rest === '' || rest === '/') return { eligible: true, relativePath: 'index.html' }
  let decoded
  try {
    decoded = decodeURIComponent(rest)
  } catch {
    return { eligible: false, relativePath: null }
  }
  const clean = sanitizeRelativePath(decoded)
  if (!clean) return { eligible: false, relativePath: null }
  return { eligible: true, relativePath: clean }
}

export function isLoopbackHostname(hostname) {
  const value = String(hostname || '').toLowerCase()
  return value === 'localhost' || value === '127.0.0.1' || value === '[::1]' || value === '::1'
}

/**
 * Normalize a URL path or workspace-relative hint into safe relative segments.
 * Returns null for empty input, absolute escapes, `..`, NUL, or a drive prefix.
 */
export function sanitizeRelativePath(input) {
  if (typeof input !== 'string') return null
  let text = input.trim()
  if (text === '') return null
  text = text.replace(/\\/g, '/')
  const query = text.indexOf('?')
  if (query >= 0) text = text.slice(0, query)
  const hash = text.indexOf('#')
  if (hash >= 0) text = text.slice(0, hash)
  if (text.includes('\u0000')) return null
  text = text.replace(/^\/+/, '')
  while (text.startsWith('./')) text = text.slice(2)
  const segments = text.split('/')
  const output = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') return null
    if (segment.includes(':') || segment.includes('\u0000')) return null
    output.push(segment)
  }
  if (output.length === 0) return null
  return output.join('/')
}

/** Resolve a `sourceHints` value (workspace-relative or URL path) to a relative path. */
export function hintToRelativePath(hint) {
  if (typeof hint !== 'string') return null
  let text = hint.trim()
  if (text === '') return null
  if (/^https?:\/\//i.test(text)) {
    try {
      text = new URL(text).pathname
    } catch {
      return null
    }
  }
  try {
    text = decodeURIComponent(text)
  } catch {
    return null
  }
  return sanitizeRelativePath(text)
}

/**
 * Resolve one source-root-relative path to a canonical target.
 * Returns `{ ok:true, target, info?, ext, relativePath, create? }` or an
 * explicit non-ok reason (`missing`, `file-too-large`, `outside-workspace`, ...).
 */
export async function resolveSourceFile(ctx, relativePath, options = {}) {
  return resolveFileUnderRoot(ctx, ctx.sourceRootTarget, ctx.sourceRootPath, relativePath, options)
}

/** Shared resolver for either the source root or (hint fallback) the workspace root. */
export async function resolveFileUnderRoot(ctx, rootTarget, rootPath, relativePath, options = {}) {
  const rel = typeof relativePath === 'string' ? relativePath.replace(/^\/+/, '') : ''
  if (!rel) return { ok: false, reason: 'no-source-mapping', relativePath: '' }
  const absolute = join(rootPath, ...rel.split('/'))
  let target
  try {
    target = await ctx.fs.resolve(absolute)
  } catch (error) {
    return { ok: false, reason: 'no-source-mapping', message: reasonOf(error), relativePath: rel }
  }
  if (!target || !ctx.fs.contains(ctx.cwdTarget, target)) return { ok: false, reason: 'outside-workspace', relativePath: rel }
  if (!ctx.fs.contains(rootTarget, target)) return { ok: false, reason: 'outside-source-root', relativePath: rel }
  const ext = extensionOf(rel)
  let info
  try {
    info = await ctx.fs.stat(target)
  } catch {
    info = undefined
  }
  if (info === undefined) {
    if (options.allowCreate) {
      const parent = await ctx.fs.resolve(dirname(absolute))
      const parentInfo = parent ? await statOrUndefined(ctx.fs, parent) : undefined
      if (!parentInfo || parentInfo.type !== 'directory') return { ok: false, reason: 'no-source-mapping', relativePath: rel }
      return { ok: true, target, ext, relativePath: rel, create: true }
    }
    return { ok: false, reason: 'missing', target, ext, relativePath: rel }
  }
  if (info.type === 'directory') {
    if (rel === 'index.html' || rel.endsWith('/index.html')) return { ok: false, reason: 'unsupported-source-type', relativePath: rel }
    return resolveFileUnderRoot(ctx, rootTarget, rootPath, rel + '/index.html', options)
  }
  if (info.type !== 'file') return { ok: false, reason: 'unsupported-source-type', relativePath: rel }
  if (typeof info.size === 'number' && info.size > ctx.readLimit) {
    return { ok: false, reason: 'file-too-large', target, ext, size: info.size, relativePath: rel }
  }
  return { ok: true, target, info, ext, relativePath: rel }
}

export function tooLargeFailure(ctx, resolved) {
  const targetFile = resolved && resolved.target ? workspaceRelative(ctx, resolved.target) : ''
  return {
    reason: 'file-too-large',
    message: 'the source file is larger than the ' + Math.floor(ctx.readLimit / 1000) + ' kB read limit',
    file: targetFile || (resolved && resolved.relativePath) || undefined,
  }
}
