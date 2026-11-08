// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: edit-kind normalization and shape validation.
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

import { CSS_EXTENSIONS, TEMPLATE_EXTENSIONS, MARKUP_EXTENSIONS } from '../constants.js'
import { styleEditParts } from '../edits/style.js'

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
  return null
}

export function normalizeKind(value) {
  if (value === 'style' || value === 'text' || value === 'attr') return value
  return null
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
  return false
}
