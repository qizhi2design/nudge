// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: bounded fallback search for a source file.
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

import { CSS_EXTENSIONS, SEARCH_EXTENSIONS, SKIP_DIRECTORIES, SEARCH_DIRECTORY_BUDGET, SEARCH_SCORE_THRESHOLD } from '../constants.js'
import { strategyFor } from './validate.js'
import { extensionOf, pathOf, statOrUndefined, relativePosix, escapeRegExp } from '../shared/paths.js'
import { normalizeWhitespaceText } from '../shared/text.js'

export async function listCandidates(ctx) {
  if (ctx.candidateCache) return ctx.candidateCache
  const found = []
  const queue = [ctx.sourceRootTarget]
  const visited = new Set()
  let budget = SEARCH_DIRECTORY_BUDGET
  while (queue.length > 0 && found.length < ctx.scanLimit && budget > 0) {
    const dir = queue.shift()
    budget -= 1
    const key = pathOf(ctx.fs, dir)
    if (visited.has(key)) continue
    visited.add(key)
    let entries
    try {
      entries = await ctx.fs.listDir(dir)
    } catch {
      continue
    }
    if (!Array.isArray(entries)) continue
    const sorted = entries.slice().sort((left, right) => String((left && left.name) || '').localeCompare(String((right && right.name) || '')))
    for (const entry of sorted) {
      if (found.length >= ctx.scanLimit) break
      if (!entry || typeof entry.name !== 'string' || !entry.target) continue
      if (entry.type === 'directory') {
        if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) continue
        queue.push(entry.target)
        continue
      }
      if (entry.type !== 'file') continue
      const ext = extensionOf(entry.name)
      if (!SEARCH_EXTENSIONS.has(ext)) continue
      if (typeof entry.size === 'number' && entry.size > ctx.readLimit) {
        ctx.addWarning('skipped a source file larger than the read limit: ' + entry.name)
        continue
      }
      found.push({ target: entry.target, ext, name: entry.name, size: entry.size })
    }
  }
  ctx.candidateCache = found
  return found
}

/** Score candidate files by selector id/class tokens plus the visible snippet. */
export async function searchForEdit(ctx, edit, kind) {
  const tokens = selectorSearchTokens(edit.selector)
  const snippet = normalizeWhitespaceText(typeof edit.textSnippet === 'string' ? edit.textSnippet : '')
  const key = kind + '\u0000' + tokens.ids.join(',') + '\u0000' + tokens.classes.join(',') + '\u0000' + snippet.slice(0, 96)
  if (ctx.searchMemo.has(key)) return ctx.searchMemo.get(key)

  const candidates = (await listCandidates(ctx)).filter((file) => strategyFor(kind, file.ext) !== null)
  let best = null
  let ties = 0
  for (const candidate of candidates) {
    let content
    try {
      content = await ctx.fs.readText(candidate.target)
    } catch {
      continue
    }
    if (typeof content !== 'string' || content.indexOf('\u0000') >= 0) continue
    const score = scoreFileContent(content, candidate.ext, tokens, snippet)
    if (score <= 0) continue
    if (best === null || score > best.score) {
      best = { score, file: candidate }
      ties = 1
    } else if (score === best.score) {
      ties += 1
    }
  }
  let outcome = null
  if (best && best.score >= SEARCH_SCORE_THRESHOLD) {
    outcome = best
    if (ties > 1) ctx.addWarning('the source search matched more than one file for one edit; used the best-scoring candidate')
  }
  ctx.searchMemo.set(key, outcome)
  return outcome
}

export function selectorSearchTokens(selector) {
  const text = typeof selector === 'string' ? selector : ''
  const ids = new Set()
  const classes = new Set()
  for (const match of text.matchAll(/#([A-Za-z_][A-Za-z0-9_-]+)/g)) if (match[1].length >= 2) ids.add(match[1])
  for (const match of text.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]+)/g)) if (match[1].length >= 2) classes.add(match[1])
  return { ids: [...ids], classes: [...classes] }
}

export function scoreFileContent(content, ext, tokens, snippet) {
  let score = 0
  if (CSS_EXTENSIONS.has(ext)) {
    for (const id of tokens.ids) if (content.includes('#' + id)) score += 5
    for (const cls of tokens.classes) {
      if (new RegExp('\\.' + escapeRegExp(cls) + '(?![\\w-])').test(content)) score += 3
    }
  } else {
    for (const id of tokens.ids) {
      if (new RegExp('\\bid\\s*=\\s*(["\\\'])' + escapeRegExp(id) + '\\1').test(content)) score += 5
    }
    for (const cls of tokens.classes) {
      if (new RegExp('(?:^|[\\s"\'`])' + escapeRegExp(cls) + '(?=[\\s"\'`]|$)').test(content)) score += 3
    }
  }
  if (snippet.length >= 8) {
    const text = normalizeWhitespaceText(content.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' '))
    if (text.includes(snippet)) score += 4
    else if (snippet.length >= 16 && text.includes(snippet.slice(0, 40))) score += 2
  }
  return score
}

/** All known candidate files (bounded, cached) whose basename matches exactly. */
export async function findBasenameCandidates(ctx, baseName) {
  const candidates = await listCandidates(ctx)
  return candidates.filter((file) => file.name === baseName)
}

/** Validate and canonicalize one search hit chosen for writing. */
export async function inspectSearchTarget(ctx, target, fallbackExt) {
  let canonical
  try {
    canonical = await ctx.fs.resolve(pathOf(ctx.fs, target))
  } catch {
    return null
  }
  if (!canonical || !ctx.fs.contains(ctx.cwdTarget, canonical) || !ctx.fs.contains(ctx.sourceRootTarget, canonical)) return null
  const info = await statOrUndefined(ctx.fs, canonical)
  if (!info || info.type !== 'file') return null
  if (typeof info.size === 'number' && info.size > ctx.readLimit) return null
  const canonicalPath = pathOf(ctx.fs, canonical)
  const rel = relativePosix(ctx.sourceRootPath, canonicalPath)
  if (!rel) return null
  return { target: canonical, info, ext: extensionOf(rel) || fallbackExt, relativePath: rel }
}
