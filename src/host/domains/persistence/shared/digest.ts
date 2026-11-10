// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: stable element-handle digests.
 *
 * A handle is the server-issued identity of one element inside one source file.
 * It lets the client address the same element again without re-deriving
 * selector/outerHTML heuristics, which is what makes repeated edits on repeated
 * markup (cards, list rows, nav items) deterministic.
 *
 * The digest is computed from the element's OPENING TAG only, so it survives
 * text edits, attribute edits inside the body, and structural moves; any edit
 * that changes the opening tag simply issues a new handle.
 *
 * Pure functions only: no I/O.
 */

import { createHash } from 'node:crypto'

/** Collapse insignificant whitespace and normalise ` = ` spacing. */
export function normalizeOpenTag(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .replace(/\s*=\s*/g, '=')
    .trim()
}

/** Short, stable digest of one opening tag (source bytes, not live DOM). */
export function openTagDigest(raw) {
  const normalized = normalizeOpenTag(raw)
  if (normalized === '') return ''
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 32)
}
