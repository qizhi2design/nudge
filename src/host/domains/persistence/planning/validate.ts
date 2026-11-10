// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: edit-kind normalization and shape validation.
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

import { CSS_EXTENSIONS, TEMPLATE_EXTENSIONS, MARKUP_EXTENSIONS, STRUCTURE_EXTENSIONS, JS_EXTENSIONS } from '../constants.js'
import { styleEditParts } from '../edits/style.js'

/** True when a structural edit may never cut this file (JS/TSX is not HTML). */
export function isJsSourceExtension(ext) {
  return JS_EXTENSIONS.has(ext)
}

/** Map one edit kind + extension to a textual strategy label, or null. */
export function strategyFor(kind, ext) {
  if (kind === 'style') {
    if (CSS_EXTENSIONS.has(ext)) return 'css-rule'
    if (ext === 'html' || ext === 'htm') return 'html-override'
    if (TEMPLATE_EXTENSIONS.has(ext)) return 'template-style'
    return null
  }
  if (kind === 'text' || kind === 'attr') {
    if (MARKUP_EXTENSIONS.has(ext)) return kind === 'text' ? 'html-text' : 'html-attr'
    return null
  }
  if (kind === 'remove' || kind === 'move' || kind === 'insert') {
    if (!STRUCTURE_EXTENSIONS.has(ext)) return null
    if (kind === 'remove') return 'html-remove'
    return kind === 'move' ? 'html-move' : 'html-insert'
  }
  return null
}

export function normalizeKind(value) {
  if (value === 'style' || value === 'text' || value === 'attr') return value
  if (value === 'remove' || value === 'move' || value === 'insert') return value
  return null
}

/** A destination parent is addressable by selector or by runtime DOM path. */
function hasParentTarget(edit) {
  const selector = typeof edit.targetParentSelector === 'string' ? edit.targetParentSelector.trim() : ''
  if (selector !== '') return true
  return Array.isArray(edit.targetParentPath) && edit.targetParentPath.length > 0
}

/** An optional insertion anchor is addressable by selector, path, or absent. */
function hasOptionalAnchor(edit, selectorKey, pathKey) {
  const rawSelector = edit[selectorKey]
  const rawPath = edit[pathKey]
  if (rawSelector === undefined || rawSelector === null) {
    if (Array.isArray(rawPath) && rawPath.length > 0) return true
    return rawSelector === null || rawSelector === undefined
  }
  if (typeof rawSelector !== 'string') return false
  const selector = rawSelector.trim()
  if (selector !== '') return true
  return Array.isArray(rawPath) && rawPath.length > 0
}

/** Shape-level validation: a preview instead of a thrown error on malformed input. */
export function validateEditShape(kind, edit) {
  if (kind === 'style') {
    const parts = styleEditParts(edit)
    return parts !== null
  }
  if (kind === 'text') {
    return typeof edit.textAfter === 'string' || typeof edit.after === 'string'
  }
  if (kind === 'attr') {
    if (typeof edit.attrName !== 'string' || edit.attrName.trim() === '') return false
    if (edit.attrAfter === null) return true
    return typeof edit.attrAfter === 'string'
  }
  if (kind === 'remove') return true
  if (kind === 'move') {
    // Both endpoints must be identifiable in the same markup file: the source
    // element is located through the shared selector/outerHTML contract and the
    // destination parent needs its own selector or runtime path. A null/absent
    // `beforeSelector` means "append as the last child".
    if (!hasParentTarget(edit)) return false
    return hasOptionalAnchor(edit, 'beforeSelector', 'beforePath')
  }
  if (kind === 'insert') {
    // Undo of a remove replays the captured markup. The snippet is inserted
    // before `beforeSelector` inside `targetParentSelector` (or appended).
    if (typeof edit.html !== 'string' || edit.html.trim() === '') return false
    if (!hasParentTarget(edit)) return false
    return hasOptionalAnchor(edit, 'beforeSelector', 'beforePath')
  }
  return false
}
