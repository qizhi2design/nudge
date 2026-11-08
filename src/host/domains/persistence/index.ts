// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: batch entry point, per-edit planning and grouped writes.
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

import { isAbsolute, join, resolve } from 'node:path'

import { READ_LIMIT, DEFAULT_SCAN_LIMIT } from './constants.js'
import { applyMarkupTextEdit, applyMarkupAttrEdit } from './edits/markup.js'
import { applyCssRuleEdit, applyHtmlOverrideEdit, applyTemplateStyleEdit } from './edits/style.js'
import { derivePageMapping, hintToRelativePath, resolveSourceFile, resolveFileUnderRoot, tooLargeFailure } from './planning/mapping.js'
import { searchForEdit, findBasenameCandidates, inspectSearchTarget } from './planning/search.js'
import { strategyFor, normalizeKind, validateEditShape } from './planning/validate.js'
import { lineAt, editId, pathOf, statOrUndefined, workspaceRelative, reasonOf } from './shared/paths.js'

/**
 * Persist one batch of live visual edits into workspace source files.
 * @param {any} deps
 * @returns {Promise<{results: any[], files?: string[], warnings?: string[]}>}
 */
export async function syncEdits(deps) {
  const editList = deps && Array.isArray(deps.edits) ? deps.edits : []
  const results = new Array(editList.length)
  const files = []
  const warnings = []
  const warningSet = new Set()
  const addWarning = (text) => {
    const value = String(text)
    if (warningSet.has(value)) return
    warningSet.add(value)
    warnings.push(value)
  }

  if (editList.length === 0) return { results: [], files, warnings }

  const fs = deps && deps.fs
  if (!fs || typeof fs.resolve !== 'function' || typeof fs.readText !== 'function' || typeof fs.writeText !== 'function' || typeof fs.stat !== 'function' || typeof fs.contains !== 'function') {
    const message = 'the host fs service is unavailable'
    for (let index = 0; index < editList.length; index += 1) {
      results[index] = { id: editId(editList[index]), status: 'failed', reason: 'fs-unavailable', message }
    }
    return { results, files, warnings }
  }

  const policyInput = deps.policy && typeof deps.policy === 'object' ? deps.policy : {}
  const mode = typeof policyInput.mode === 'string' ? policyInput.mode : 'read-only'
  // index.js already filters read-only sessions; this is a defensive second fence.
  if (mode === 'read-only') {
    for (let index = 0; index < editList.length; index += 1) {
      results[index] = { id: editId(editList[index]), status: 'preview', reason: 'read-only-policy' }
    }
    return { results, files, warnings }
  }
  const policy = { ...policyInput, mode }

  let workspaceCwd = typeof deps.cwd === 'string' ? deps.cwd.trim() : ''
  if (!workspaceCwd && typeof policy.workspaceRoot === 'string') workspaceCwd = policy.workspaceRoot.trim()
  if (!workspaceCwd) {
    const message = 'the session working directory is unknown'
    for (let index = 0; index < editList.length; index += 1) {
      results[index] = { id: editId(editList[index]), status: 'failed', reason: 'workspace-unavailable', message }
    }
    return { results, files, warnings }
  }
  if (!isAbsolute(workspaceCwd)) workspaceCwd = resolve(workspaceCwd)

  let cwdTarget
  try {
    cwdTarget = await fs.resolve(workspaceCwd)
  } catch (error) {
    const message = reasonOf(error)
    for (let index = 0; index < editList.length; index += 1) {
      results[index] = { id: editId(editList[index]), status: 'failed', reason: 'workspace-unavailable', message }
    }
    return { results, files, warnings }
  }
  const cwdPath = pathOf(fs, cwdTarget)

  // The source root must live inside the workspace; an out-of-workspace root is
  // ignored rather than silently widening write access.
  const configuredRoot = typeof deps.sourceRoot === 'string' ? deps.sourceRoot.trim() : ''
  let sourceRootTarget = cwdTarget
  if (configuredRoot) {
    try {
      const candidateAbsolute = isAbsolute(configuredRoot) ? configuredRoot : join(workspaceCwd, configuredRoot)
      const candidate = await fs.resolve(candidateAbsolute)
      if (candidate && fs.contains(cwdTarget, candidate)) {
        const info = await statOrUndefined(fs, candidate)
        if (info && info.type === 'directory') sourceRootTarget = candidate
      }
    } catch {
      /* a broken configured root falls back to the workspace root */
    }
  }
  const sourceRootPath = pathOf(fs, sourceRootTarget)

  const configuredLimit = Number(deps.maxFileBytes)
  const readLimit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.min(Math.floor(configuredLimit), READ_LIMIT) : READ_LIMIT
  const configuredScan = Number(deps.maxScanFiles)
  const scanLimit = Number.isFinite(configuredScan) && configuredScan > 0 ? Math.max(20, Math.min(5000, Math.floor(configuredScan))) : DEFAULT_SCAN_LIMIT

  const mapping = derivePageMapping(deps.page, deps.urlRoot)
  const ctx = {
    fs,
    cwdTarget,
    cwdPath,
    sourceRootTarget,
    sourceRootPath,
    readLimit,
    scanLimit,
    policy,
    addWarning,
    candidateCache: null,
    searchMemo: new Map(),
  }

  // ------------------------------------------------------------ plan per edit
  const groups = new Map()
  for (let index = 0; index < editList.length; index += 1) {
    const edit = editList[index] && typeof editList[index] === 'object' ? editList[index] : {}
    try {
      const outcome = await planEdit(ctx, edit, mapping)
      if (outcome.plan) {
        const plan = outcome.plan
        const key = pathOf(fs, plan.target)
        let group = groups.get(key)
        if (!group) {
          group = { target: plan.target, relativePath: plan.relativePath, edits: [] }
          groups.set(key, group)
        }
        if (plan.allowCreate) group.allowCreate = true
        group.edits.push({ index, edit, strategy: plan.strategy, via: plan.via })
        continue
      }
      if (outcome.failed) {
        results[index] = { id: editId(edit), status: 'failed', ...outcome.failed }
        continue
      }
      results[index] = { id: editId(edit), status: 'preview', ...(outcome.preview || { reason: 'no-source-mapping' }) }
    } catch (error) {
      results[index] = { id: editId(edit), status: 'failed', reason: 'internal-error', message: reasonOf(error) }
    }
  }

  // ------------------------------------------- one read / one write per file
  for (const group of groups.values()) {
    try {
      await processGroup(ctx, group, results, files)
    } catch (error) {
      const file = workspaceRelative(ctx, group.target) || group.relativePath
      for (const item of group.edits) {
        if (results[item.index] === undefined) {
          results[item.index] = { id: editId(item.edit), status: 'failed', reason: 'internal-error', message: reasonOf(error), file }
        }
      }
    }
  }

  for (let index = 0; index < editList.length; index += 1) {
    if (results[index] === undefined) {
      results[index] = { id: editId(editList[index]), status: 'failed', reason: 'internal-error', message: 'the edit could not be planned' }
    }
  }
  return { results, files, warnings }
}

/**
 * Decide which source file one edit targets and which textual strategy applies.
 * Order: explicit hints -> URL mapping -> bounded fallback search.
 */
export async function planEdit(ctx, edit, mapping) {
  const kind = normalizeKind(edit.kind)
  if (!kind) return { preview: { reason: 'unsupported-edit-kind' } }
  const selector = typeof edit.selector === 'string' ? edit.selector.trim() : ''
  if (!selector) return { preview: { reason: 'unresolved-element' } }
  if (!validateEditShape(kind, edit)) return { preview: { reason: 'invalid-edit' } }

  const hints = edit.sourceHints && typeof edit.sourceHints === 'object' ? edit.sourceHints : {}
  let sawUnsupported = false
  let oversized = null

  const consider = (resolved, via, allowCreate) => {
    if (!resolved || resolved.ok !== true) {
      if (resolved && resolved.reason === 'file-too-large') oversized = resolved
      return null
    }
    const strategy = strategyFor(kind, resolved.ext)
    if (!strategy) {
      sawUnsupported = true
      return null
    }
    return {
      plan: {
        target: resolved.target,
        info: resolved.info,
        ext: resolved.ext,
        relativePath: resolved.relativePath,
        allowCreate: Boolean(resolved.create || allowCreate),
        strategy,
        via,
      },
    }
  }

  /**
   * Resolve one explicit hint. Hints are source-root-relative by contract; if
   * that path is missing and sourceRoot is a subdirectory of the workspace, a
   * workspace-relative retry keeps repo-style hints (`data-source="demo/x.html"`)
   * working. For stylesheet hrefs, a unique basename match elsewhere in the
   * workspace (served assets often live in a `demo/` or `public/` subtree)
   * resolves before any new file is created.
   */
  const tryHintCandidate = async (relativePath, allowCreate, hintOptions = {}) => {
    const primary = await resolveSourceFile(ctx, relativePath, { allowCreate: false })
    const planned = consider(primary, 'hint', false)
    if (planned) return planned
    if (oversized) return null
    if (primary.reason === 'missing' && ctx.sourceRootPath !== ctx.cwdPath) {
      const fallback = await resolveFileUnderRoot(ctx, ctx.cwdTarget, ctx.cwdPath, relativePath, { allowCreate: false })
      const fallbackPlanned = consider(fallback, 'hint', false)
      if (fallbackPlanned) return fallbackPlanned
      if (oversized) return null
    }
    if (hintOptions.basenameFallback) {
      const baseName = relativePath.split('/').pop()
      if (baseName) {
        const matches = await findBasenameCandidates(ctx, baseName)
        if (matches.length === 1) {
          const inspected = await inspectSearchTarget(ctx, matches[0].target, matches[0].ext)
          if (inspected) {
            const plannedByName = consider(
              { ok: true, target: inspected.target, info: inspected.info, ext: inspected.ext, relativePath: inspected.relativePath },
              'hint',
              false,
            )
            if (plannedByName) return plannedByName
          }
        }
        // Ambiguous basename: never invent a duplicate file next to the source.
        if (matches.length > 1) return null
      }
    }
    if (allowCreate) {
      const created = await resolveSourceFile(ctx, relativePath, { allowCreate: true })
      return consider(created, 'hint', true)
    }
    return null
  }

  // 1. Explicit hints first (page-declared provenance).
  if (kind === 'style' && typeof hints.styleHref === 'string' && hints.styleHref.trim()) {
    const rel = hintToRelativePath(hints.styleHref)
    if (rel) {
      const planned = await tryHintCandidate(rel, true, { basenameFallback: true })
      if (planned) return planned
      if (oversized) return { failed: tooLargeFailure(ctx, oversized) }
    }
  }
  if (typeof hints.file === 'string' && hints.file.trim()) {
    const rel = hintToRelativePath(hints.file)
    if (rel) {
      const planned = await tryHintCandidate(rel, false)
      if (planned) return planned
      if (oversized) return { failed: tooLargeFailure(ctx, oversized) }
    }
  }

  // 2. Page URL mapping (only eligible for configured/loopback HTTP pages).
  if (mapping && mapping.eligible && mapping.relativePath) {
    const resolved = await resolveSourceFile(ctx, mapping.relativePath, { allowCreate: false })
    const planned = consider(resolved, 'url', false)
    if (planned) return planned
    if (oversized) return { failed: tooLargeFailure(ctx, oversized) }

    // 3. Bounded fallback search when the mapping did not resolve a usable file.
    const found = await searchForEdit(ctx, edit, kind)
    if (found) {
      const inspected = await inspectSearchTarget(ctx, found.file.target, found.file.ext)
      if (inspected) {
        const strategy = strategyFor(kind, inspected.ext)
        if (strategy) {
          return {
            plan: {
              target: inspected.target,
              info: inspected.info,
              ext: inspected.ext,
              relativePath: inspected.relativePath,
              allowCreate: false,
              strategy,
              via: 'search',
            },
          }
        }
      }
    }
  }

  if (oversized) return { failed: tooLargeFailure(ctx, oversized) }
  if (sawUnsupported) return { preview: { reason: 'unsupported-source-type' } }
  return { preview: { reason: 'no-source-mapping' } }
}

export async function processGroup(ctx, group, results, files) {
  if (!group.edits.length) return
  const fileRelative = workspaceRelative(ctx, group.target) || group.relativePath
  const failGroup = (reason, message) => {
    for (const item of group.edits) {
      if (results[item.index] === undefined) {
        results[item.index] = { id: editId(item.edit), status: 'failed', reason, message, file: fileRelative }
      }
    }
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const info = await statOrUndefined(ctx.fs, group.target)
    if (info !== undefined && info.type !== 'file') {
      failGroup('unsupported-source-type', 'the mapped source path is not a regular file')
      return
    }
    if (info === undefined && !group.allowCreate) {
      failGroup('file-missing', 'the mapped source file no longer exists')
      return
    }
    if (info !== undefined && typeof info.size === 'number' && info.size > ctx.readLimit) {
      failGroup('file-too-large', tooLargeFailure(ctx, { relativePath: fileRelative }).message)
      return
    }

    let raw = ''
    if (info !== undefined) {
      try {
        raw = await ctx.fs.readText(group.target)
      } catch (error) {
        failGroup('read-failed', reasonOf(error))
        return
      }
      if (typeof raw !== 'string') raw = ''
      if (raw.length > ctx.readLimit) {
        failGroup('file-too-large', tooLargeFailure(ctx, { relativePath: fileRelative }).message)
        return
      }
    }

    const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
    const body = bom ? raw.slice(1) : raw
    let current = body
    const applied = []

    for (const item of group.edits) {
      let outcome
      try {
        outcome = applyEditToContent(current, item)
      } catch (error) {
        outcome = { ok: false, reason: 'internal-error', message: reasonOf(error) }
      }
      if (!outcome || outcome.ok !== true) {
        if (results[item.index] === undefined) {
          results[item.index] = {
            id: editId(item.edit),
            status: 'preview',
            reason: (outcome && outcome.reason) || 'unresolved-element',
            file: fileRelative,
          }
        }
        continue
      }
      current = outcome.content
      applied.push({ item, changed: outcome.changed, lineIndex: outcome.lineIndex })
    }

    if (applied.length === 0) return
    const nextRaw = bom + current
    const bomOffset = bom ? 1 : 0

    if (nextRaw === raw) {
      for (const appliedItem of applied) {
        results[appliedItem.item.index] = {
          id: editId(appliedItem.item.edit),
          status: 'synced',
          file: fileRelative,
          strategy: 'no-op',
          line: lineAt(nextRaw, typeof appliedItem.lineIndex === 'number' ? appliedItem.lineIndex + bomOffset : undefined),
        }
      }
      return
    }

    const expected = info === undefined ? { kind: 'createIfAbsent' } : { kind: 'replaceIfVersion', version: info.version }
    try {
      await ctx.fs.writeText(group.target, nextRaw, expected, undefined, ctx.policy)
    } catch (error) {
      const code = error && typeof error.code === 'string' ? error.code : ''
      const stale = code === 'FS_STALE_VERSION' || code === 'FS_EXISTS' || /STALE|EXISTS/.test(code)
      if (attempt === 0 && stale) continue
      for (const appliedItem of applied) {
        results[appliedItem.item.index] = {
          id: editId(appliedItem.item.edit),
          status: 'failed',
          reason: stale ? 'stale-version' : 'write-failed',
          message: reasonOf(error),
          file: fileRelative,
        }
      }
      return
    }

    if (!files.includes(fileRelative)) files.push(fileRelative)
    for (const appliedItem of applied) {
      const isSearch = appliedItem.item.via === 'search'
      results[appliedItem.item.index] = {
        id: editId(appliedItem.item.edit),
        status: 'synced',
        file: fileRelative,
        strategy: appliedItem.changed ? (isSearch ? 'search' : appliedItem.item.strategy) : 'no-op',
        line: lineAt(nextRaw, typeof appliedItem.lineIndex === 'number' ? appliedItem.lineIndex + bomOffset : undefined),
      }
      if (appliedItem.item.strategy === 'template-style' && appliedItem.changed) {
        ctx.addWarning('style rules were written into the component <style> block; scoped component styles may need :global() to match at runtime')
      }
    }
    return
  }
}

export function applyEditToContent(content, item) {
  switch (item.strategy) {
    case 'css-rule':
      return applyCssRuleEdit(content, item.edit)
    case 'html-override':
      return applyHtmlOverrideEdit(content, item.edit)
    case 'template-style':
      return applyTemplateStyleEdit(content, item.edit)
    case 'html-text':
      return applyMarkupTextEdit(content, item.edit)
    case 'html-attr':
      return applyMarkupAttrEdit(content, item.edit)
    default:
      return { ok: false, reason: 'unsupported-source-type' }
  }
}
