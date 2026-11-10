// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: locate the edited element inside one source file.
 *
 * The client descriptor carries several independent anchors. They are tried from
 * the most specific to the most fragile, and a miss is reported precisely:
 *
 *   1. a unique #id from outerHTML or the selector
 *   2. a unique normalized occurrence of outerHTML
 *   3. a unique textBefore match constrained by selector id/class tokens
 *   4. the runtime DOM path (element-child indexes), verified against outerHTML
 *
 * Reasons: unresolved-element (nothing matched), ambiguous-element (more than one
 * candidate and no anchor disambiguated it), path-mismatch (the DOM path landed on
 * an element whose text visibly contradicts outerHTML).
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

import { VOID_ELEMENTS } from '../constants.js'
import { canonicalSelector, lastCompound, compoundTokens } from '../css/selector.js'
import { tokenizeHtml, attrValue, elementRange, findOpeningTagsByAttribute, collectTagIndexes, attributeSignature, buildElementIndex } from './tokenizer.js'
import { openTagDigest } from '../shared/digest.js'
import { stripMarkup, normalizeWhitespaceText, normalizeWhitespaceWithMap } from '../shared/text.js'

const REASON_UNRESOLVED = 'unresolved-element'
const REASON_AMBIGUOUS = 'ambiguous-element'
const REASON_PATH_MISMATCH = 'path-mismatch'

/**
 * Locate the edit target and explain a miss. Returns { range, reason } where
 * exactly one of the two is non-null.
 */
export function locateElementDetailed(content, edit) {
  const { tags } = tokenizeHtml(content)
  const descriptor = edit && typeof edit === 'object' ? edit : {}
  const selector = typeof descriptor.selector === 'string' ? descriptor.selector : ''
  const outerHTML = typeof descriptor.outerHTML === 'string' ? descriptor.outerHTML : ''
  let ambiguous = false

  // A server-issued handle is the only anchor that is not a heuristic: it names
  // one opening tag in this file by offset + digest. It survives repeated
  // markup, live-DOM drift, and a changed selector.
  const byHandle = locateByHandle(content, tags, descriptor.handle)
  if (byHandle) return { range: byHandle, reason: null }

  const byId = locateById(content, tags, selector, outerHTML)
  if (byId.range) return { range: byId.range, reason: null }
  if (byId.ambiguous) ambiguous = true

  if (outerHTML) {
    const byOuter = locateByOuterHtml(content, tags, outerHTML)
    if (byOuter.range) return { range: byOuter.range, reason: null }
    if (byOuter.ambiguous) ambiguous = true
  }

  const byText = locateByTextBefore(content, tags, descriptor)
  if (byText.range) return { range: byText.range, reason: null }
  if (byText.ambiguous) ambiguous = true

  // Last resort: the runtime wrote the element's DOM path, so walk the same
  // element-child indexes through the source tree. It only counts when the
  // landed element's text still agrees with outerHTML.
  const byPath = locateByPath(content, tags, descriptor)
  if (byPath.range) return { range: byPath.range, reason: null }
  if (byPath.reason === REASON_PATH_MISMATCH) return { range: null, reason: REASON_PATH_MISMATCH }
  return { range: null, reason: ambiguous ? REASON_AMBIGUOUS : REASON_UNRESOLVED }
}

/** Backwards-compatible locator for callers that do not need the reason. */
export function locateElement(content, edit) {
  return locateElementDetailed(content, edit).range
}

/** A unique id from outerHTML or the selector's last compound. */
function locateById(content, tags, selector, outerHTML) {
  const idCandidates = []
  if (outerHTML) {
    const outerOpen = tokenizeHtml(outerHTML).tags.find((tag) => !tag.closing)
    if (outerOpen) {
      const id = attrValue(outerOpen, 'id')
      if (id) idCandidates.push(id)
    }
  }
  const selectorTokens = compoundTokens(lastCompound(canonicalSelector(selector)))
  if (selectorTokens.ids.length > 0) idCandidates.push(selectorTokens.ids[selectorTokens.ids.length - 1])

  const seenIds = new Set()
  let ambiguous = false
  for (const id of idCandidates) {
    if (seenIds.has(id)) continue
    seenIds.add(id)
    const found = findOpeningTagsByAttribute(tags, 'id', id)
    if (found.length > 1) ambiguous = true
    if (found.length !== 1) continue
    const range = elementRange(content, tags, found[0])
    if (range) return { range, ambiguous: false }
  }
  return { range: null, ambiguous }
}

/**
 * Locate by a unique normalized occurrence of outerHTML. Reports an ambiguous
 * miss when the (or a shortened) needle occurs more than once.
 */
export function locateByOuterHtml(content, tags, outerHTML) {
  const normalizedTarget = normalizeWhitespaceText(outerHTML)
  let ambiguous = false
  if (normalizedTarget) {
    const normalizedContent = normalizeWhitespaceWithMap(content)
    const needles = [normalizedTarget]
    if (normalizedTarget.length > 200) needles.push(normalizedTarget.slice(0, 200))
    if (normalizedTarget.length > 80) needles.push(normalizedTarget.slice(0, 80))
    for (const needle of needles) {
      const first = normalizedContent.text.indexOf(needle)
      if (first < 0) continue
      if (normalizedContent.text.indexOf(needle, first + 1) >= 0) {
        ambiguous = true
        continue
      }
      const rawIndex = normalizedContent.map[first]
      if (typeof rawIndex !== 'number') continue
      const tagIndex = tags.findIndex((tag) => !tag.closing && tag.start === rawIndex)
      if (tagIndex < 0) continue
      const range = elementRange(content, tags, tagIndex)
      if (range) return { range, ambiguous: false }
    }
  }

  // Fallback: compare the opening-tag attribute signature (DOM serialization
  // may reorder or normalize source attributes).
  const outerOpen = tokenizeHtml(outerHTML).tags.find((tag) => !tag.closing)
  if (!outerOpen) return { range: null, ambiguous }
  const signature = attributeSignature(outerOpen.attrs)
  const matches = []
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]
    if (tag.closing || tag.selfClosing || tag.name !== outerOpen.name) continue
    if (attributeSignature(tag.attrs) === signature) matches.push(index)
  }
  if (matches.length === 1) {
    const range = elementRange(content, tags, matches[0])
    if (range) return { range, ambiguous: false }
  }
  if (matches.length > 1) ambiguous = true

  const outerText = normalizeWhitespaceText(stripMarkup(outerHTML)).slice(0, 40)
  if (outerText.length >= 8) {
    const pool = matches.length > 0 ? matches : collectTagIndexes(tags, outerOpen.name)
    const textMatches = []
    for (const candidateIndex of pool) {
      const range = elementRange(content, tags, candidateIndex)
      if (!range) continue
      const text = normalizeWhitespaceText(stripMarkup(content.slice(range.innerStart, range.innerEnd)))
      if (text.startsWith(outerText)) textMatches.push(candidateIndex)
      if (textMatches.length > 1) break
    }
    if (textMatches.length === 1) {
      const range = elementRange(content, tags, textMatches[0])
      if (range) return { range, ambiguous: false }
    }
    if (textMatches.length > 1) ambiguous = true
  }
  return { range: null, ambiguous }
}

/**
 * Locate by an exact textBefore inside a tag whose class/id tokens match the
 * selector. Reports ambiguous when several candidates fit equally well.
 */
export function locateByTextBefore(content, tags, edit) {
  // Structure edits historically carried only `textSnippet`; accept it as the
  // text anchor instead of silently skipping this ladder step.
  const before =
    typeof edit.textBefore === 'string' && edit.textBefore.trim() !== ''
      ? edit.textBefore
      : typeof edit.textSnippet === 'string'
        ? edit.textSnippet
        : ''
  if (before.trim() === '') return { range: null, ambiguous: false }
  const target = normalizeWhitespaceText(before)
  const tokens = compoundTokens(lastCompound(canonicalSelector(typeof edit.selector === 'string' ? edit.selector : '')))
  const strong = []
  const weak = []
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]
    if (tag.closing || tag.selfClosing || VOID_ELEMENTS.has(tag.name)) continue
    const id = attrValue(tag, 'id')
    const classAttr = attrValue(tag, 'class')
    const classes = classAttr ? classAttr.split(/\s+/).filter(Boolean) : []
    const tokenMatch =
      tokens.ids.length === 0 && tokens.classes.length === 0
        ? true
        : (id !== null && tokens.ids.includes(id)) || tokens.classes.some((cls) => classes.includes(cls))
    if (!tokenMatch) continue
    const range = elementRange(content, tags, index)
    if (!range) continue
    const text = normalizeWhitespaceText(stripMarkup(content.slice(range.innerStart, range.innerEnd)))
    if (text === target) strong.push(index)
    else if (text.includes(target)) weak.push(index)
  }
  if (strong.length === 1) {
    const range = elementRange(content, tags, strong[0])
    if (range) return { range, ambiguous: false }
  }
  if (strong.length === 0 && weak.length === 1) {
    const range = elementRange(content, tags, weak[0])
    if (range) return { range, ambiguous: false }
  }
  return { range: null, ambiguous: strong.length > 1 || weak.length > 1 }
}

/**
 * Walk edit.path (element-child indexes from documentElement down) through the
 * tokenized source tree. Shadow-DOM placeholders (negative steps), invalid
 * numbers, missing html roots and out-of-range indexes abandon the fallback;
 * a landed node whose text contradicts outerHTML reports path-mismatch.
 */
export function locateByPath(content, tags, edit) {
  const rawPath = Array.isArray(edit.path) ? edit.path : null
  if (!rawPath || rawPath.length === 0) return { range: null, reason: null }
  const steps = []
  for (const raw of rawPath) {
    const step = Number(raw)
    if (!Number.isFinite(step) || Math.floor(step) !== step) return { range: null, reason: null }
    // Negative indexes address shadow roots; a static HTML file cannot express
    // that boundary, so the path hint is unusable instead of being guessed.
    if (step < 0) return { range: null, reason: null }
    steps.push(step)
  }
  const index = buildElementIndex(tags)
  const roots = index.childrenOf.get(-1) || []
  let current = roots.find((rootIndex) => tags[rootIndex].name === 'html')
  if (current === undefined) return { range: null, reason: null }
  for (const step of steps) {
    const children = index.childrenOf.get(current) || []
    if (step >= children.length) return { range: null, reason: null }
    current = children[step]
  }
  const range = elementRange(content, tags, current)
  if (!range) return { range: null, reason: null }
  if (!structureMatchesOuterHtml(content, range, edit.outerHTML, edit.outerHTMLTruncated === true)) return { range: null, reason: REASON_PATH_MISMATCH }
  return { range, reason: null }
}

/**
 * Guard against a stale path: compare the landed element's tag and normalized
 * text with the serialized outerHTML. Tiny/empty texts are not judged; longer
 * texts must agree by containment (or by a shared head when outerHTML was
 * truncated by the runtime).
 */
export function structureMatchesOuterHtml(content, range, outerHTML, truncatedHint) {
  if (typeof outerHTML !== 'string' || outerHTML.trim() === '') return true
  const outerOpen = tokenizeHtml(outerHTML).tags.find((tag) => !tag.closing)
  if (outerOpen && range.tag && range.tag.name !== outerOpen.name) return false
  const truncated = truncatedHint === true || /\u2026$/.test(outerHTML)
  const targetText = normalizeWhitespaceText(stripMarkup(truncated ? outerHTML.replace(/\u2026$/, '') : outerHTML))
  const candidateText = normalizeWhitespaceText(stripMarkup(content.slice(range.innerStart, range.innerEnd)))
  if (truncated) {
    // A truncated payload must never *verify* a stale path by a text prefix: a
    // 60-char head is shared by repeated components, so accepting it deleted the
    // wrong element. Require the opening-tag attribute signature and the full
    // visible text to agree instead.
    if (!outerOpen) return false
    if (attributeSignature(outerOpen.attrs) !== attributeSignature(range.tag.attrs)) return false
    if (targetText === '') return candidateText === ''
    return candidateText === targetText
  }
  if (targetText === '' || candidateText === '') return true
  if (targetText.length < 8 || candidateText.length < 8) return true
  if (candidateText.indexOf(targetText) >= 0 || targetText.indexOf(candidateText) >= 0) return true
  return false
}

/**
 * Resolve a server-issued element handle against the current file bytes.
 *
 * A handle names one opening tag by (offset | line) + opening-tag digest. The
 * exact offset wins; a line scan is the fallback so a handle survives unrelated
 * edits earlier in the file. Anything not provably the same element returns
 * null and the caller falls back to the normal ladder.
 */
export function locateByHandle(content, tags, handle) {
  if (!handle || typeof handle !== 'object') return null
  const digest = typeof handle.openTagDigest === 'string' ? handle.openTagDigest : ''
  if (digest === '') return null
  const digestOf = (range) => (range && range.tag ? openTagDigest(content.slice(range.tag.start, range.tag.end)) : '')
  const openStart = Number(handle.openStart)
  if (Number.isFinite(openStart) && openStart >= 0 && openStart <= content.length) {
    for (let index = 0; index < tags.length; index += 1) {
      if (tags[index].closing || tags[index].start !== openStart) continue
      const range = elementRange(content, tags, index)
      if (range && digestOf(range) === digest) return range
    }
  }
  const line = Number(handle.line)
  if (!Number.isFinite(line) || line < 1) return null
  const found = []
  let cursor = 0
  let lineNo = 1
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]
    if (!tag || tag.closing) continue
    while (cursor < tag.start && cursor < content.length) {
      if (content.charCodeAt(cursor) === 10) lineNo += 1
      cursor += 1
    }
    if (lineNo !== line) continue
    const range = elementRange(content, tags, index)
    if (range && digestOf(range) === digest) {
      found.push(range)
      if (found.length > 1) return null
    }
  }
  return found.length === 1 ? found[0] : null
}

/**
 * Last-resort match on the selector's final compound (tag + ids + classes).
 *
 * Structure anchors captured by the runtime may carry only a cssPath for a
 * destination parent (e.g. the undo-insert target), with no id, no outerHTML and
 * no DOM path. When exactly one source element matches the final compound it is
 * a safe target; anything ambiguous stays unresolved.
 */
export function locateBySelectorTokens(content, tags, selector) {
  const compound = lastCompound(canonicalSelector(typeof selector === 'string' ? selector : ''))
  if (compound === '') return null
  const tokens = compoundTokens(compound)
  if (tokens.ids.length === 0 && tokens.classes.length === 0 && tokens.tag === '') return null
  const matches = []
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]
    if (tag.closing || tag.selfClosing || VOID_ELEMENTS.has(tag.name)) continue
    if (tokens.tag !== '' && tag.name !== tokens.tag) continue
    const id = attrValue(tag, 'id')
    const classAttr = attrValue(tag, 'class')
    const classes = classAttr ? classAttr.split(/\s+/).filter(Boolean) : []
    if (tokens.ids.length > 0 && (id === null || !tokens.ids.every((wanted) => id === wanted))) continue
    if (tokens.classes.length > 0 && !tokens.classes.every((wanted) => classes.includes(wanted))) continue
    const range = elementRange(content, tags, index)
    if (!range) continue
    matches.push(range)
    if (matches.length > 1) return null
  }
  return matches.length === 1 ? matches[0] : null
}

/** The handle payload for one located element (issued after a successful write). */
export function elementHandleAt(content, range) {
  if (!range || !range.tag || typeof range.openStart !== 'number') return null
  const openTag = content.slice(range.tag.start, range.tag.end)
  const digest = openTagDigest(openTag)
  if (digest === '') return null
  let line = 1
  for (let cursor = 0; cursor < range.openStart && cursor < content.length; cursor += 1) {
    if (content.charCodeAt(cursor) === 10) line += 1
  }
  return {
    openStart: range.openStart,
    line,
    tag: range.tag.name,
    openTagDigest: digest,
  }
}
