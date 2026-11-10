// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: persist text and attribute edits into markup files.
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

import { URL_ATTRIBUTES, VOID_ELEMENTS } from '../constants.js'
import { locateElement, locateElementDetailed } from '../html/locate.js'
import { tokenizeHtml, textNodeRanges } from '../html/tokenizer.js'
import { escapeRegExp } from '../shared/paths.js'
import { diffText, decodeEntities, decodeEntitiesWithMap, escapeHtmlText, escapeAttributeValue, stripMarkup, normalizeWhitespaceText, compactText } from '../shared/text.js'

export function applyMarkupTextEdit(content, edit) {
  const textAfter = typeof edit.textAfter === 'string' ? edit.textAfter : typeof edit.after === 'string' ? edit.after : null
  if (textAfter === null) return { ok: false, reason: 'invalid-edit' }
  const located = locateElementDetailed(content, edit)
  if (!located.range) return { ok: false, reason: located.reason || 'unresolved-element' }
  const element = located.range

  const innerStart = element.innerStart
  const innerEnd = element.innerEnd
  const inner = content.slice(innerStart, innerEnd)
  const { tags: innerTags, skips: innerSkips } = tokenizeHtml(inner)
  const hasChildTags = innerTags.some((tag) => !tag.closing)
  const beforeText = typeof edit.textBefore === 'string' ? edit.textBefore : ''

  // Case 1: a bare text element — replace its whole text content.
  if (!hasChildTags) {
    const decoded = decodeEntities(inner)
    if (beforeText !== '' && normalizeWhitespaceText(decoded) !== normalizeWhitespaceText(beforeText)) {
      return { ok: false, reason: 'unresolved-element' }
    }
    const leading = /^[ \t\r\n]*/.exec(inner)[0]
    const trailing = /[ \t\r\n]*$/.exec(inner)[0]
    const newInner = leading + escapeHtmlText(textAfter) + trailing
    return finishTextEdit(content, innerStart, innerEnd, inner, newInner)
  }

  const textNodes = textNodeRanges(inner, innerTags, innerSkips)

  // Case 2: locate the changed span between textBefore/textAfter and replace
  // only that span inside its own text node, preserving child tags.
  if (beforeText !== '') {
    const diff = diffText(beforeText, textAfter)
    if (diff && diff.oldText === '' && diff.newText === '') return { ok: true, content, changed: false, lineIndex: innerStart }
    if (diff && diff.oldText !== '') {
      // Search each text node; first a literal match, then a whitespace-flexible
      // match because the browser reports whitespace-normalized visible text
      // while the source may wrap the same words across lines/indentation.
      const collectHits = (needle, flexible) => {
        const hits = []
        const pattern = flexible ? new RegExp(escapeRegExp(needle).replace(/ /g, '\\s+'), 'g') : null
        for (const node of textNodes) {
          const rawNode = inner.slice(node.start, node.end)
          if (!rawNode.trim()) continue
          const decoded = decodeEntitiesWithMap(rawNode)
          if (!flexible) {
            let found = decoded.text.indexOf(needle)
            while (found >= 0) {
              const lastIndex = found + needle.length - 1
              hits.push({ rawStart: node.start + decoded.start[found], rawEnd: node.start + decoded.end[lastIndex] })
              if (hits.length > 1) break
              found = decoded.text.indexOf(needle, found + 1)
            }
          } else {
            pattern.lastIndex = 0
            let match = pattern.exec(decoded.text)
            while (match) {
              const lastIndex = match.index + match[0].length - 1
              hits.push({ rawStart: node.start + decoded.start[match.index], rawEnd: node.start + decoded.end[lastIndex] })
              if (hits.length > 1) break
              match = pattern.exec(decoded.text)
            }
          }
          if (hits.length > 1) break
        }
        return hits
      }
      let hits = collectHits(diff.oldText, false)
      if (hits.length === 0) hits = collectHits(diff.oldText, true)
      if (hits.length === 1) {
        const hit = hits[0]
        const newInner = inner.slice(0, hit.rawStart) + escapeHtmlText(diff.newText) + inner.slice(hit.rawEnd)
        return finishTextEdit(content, innerStart, innerEnd, inner, newInner)
      }
    }
    // Case 2b: pure insertion (e.g. appending a word to one text node). Walk the
    // text nodes to the diff prefix boundary, then verify the result text.
    if (diff && diff.oldText === '' && diff.newText !== '') {
      let consumed = 0
      let rawPosition = -1
      for (const node of textNodes) {
        const rawNode = inner.slice(node.start, node.end)
        const decoded = decodeEntitiesWithMap(rawNode)
        const nodeLength = decoded.text.length
        if (diff.prefix <= consumed + nodeLength) {
          const offset = diff.prefix - consumed
          rawPosition = offset < nodeLength ? node.start + decoded.start[offset] : node.end
          break
        }
        consumed += nodeLength
      }
      if (rawPosition >= 0 && rawPosition <= inner.length) {
        const newInner = inner.slice(0, rawPosition) + escapeHtmlText(diff.newText) + inner.slice(rawPosition)
        const proposed = compactText(stripMarkup(newInner))
        if (proposed === compactText(textAfter)) {
          return finishTextEdit(content, innerStart, innerEnd, inner, newInner)
        }
      }
    }
  }

  // Case 3: exactly one meaningful text node inside the element.
  const meaningful = textNodes.filter((node) => inner.slice(node.start, node.end).trim() !== '')
  if (meaningful.length === 1) {
    const node = meaningful[0]
    const rawNode = inner.slice(node.start, node.end)
    const decoded = decodeEntities(rawNode)
    if (beforeText === '' || normalizeWhitespaceText(decoded) === normalizeWhitespaceText(beforeText)) {
      const leading = /^[ \t\r\n]*/.exec(rawNode)[0]
      const trailing = /[ \t\r\n]*$/.exec(rawNode)[0]
      const newInner = inner.slice(0, node.start) + leading + escapeHtmlText(textAfter) + trailing + inner.slice(node.end)
      return finishTextEdit(content, innerStart, innerEnd, inner, newInner)
    }
  }

  // Case 4: one text node holds the element's exact full text.
  if (beforeText !== '') {
    const target = normalizeWhitespaceText(beforeText)
    const whole = textNodes.filter((node) => normalizeWhitespaceText(decodeEntities(inner.slice(node.start, node.end))) === target)
    if (whole.length === 1) {
      const node = whole[0]
      const rawNode = inner.slice(node.start, node.end)
      const leading = /^[ \t\r\n]*/.exec(rawNode)[0]
      const trailing = /[ \t\r\n]*$/.exec(rawNode)[0]
      const newInner = inner.slice(0, node.start) + leading + escapeHtmlText(textAfter) + trailing + inner.slice(node.end)
      return finishTextEdit(content, innerStart, innerEnd, inner, newInner)
    }
  }

  return { ok: false, reason: 'unresolved-element' }
}

export function finishTextEdit(content, innerStart, innerEnd, oldInner, newInner) {
  const next = content.slice(0, innerStart) + newInner + content.slice(innerEnd)
  const leading = /^[ \t\r\n]*/.exec(newInner)
  return {
    ok: true,
    content: next,
    changed: next !== content,
    lineIndex: innerStart + (leading ? leading[0].length : 0),
  }
}

export function applyMarkupAttrEdit(content, edit) {
  const name = typeof edit.attrName === 'string' ? edit.attrName.trim() : ''
  if (!name) return { ok: false, reason: 'invalid-edit' }
  const lowerName = name.toLowerCase()
  if (lowerName.startsWith('on')) return { ok: false, reason: 'unsafe-attribute' }
  if (lowerName === 'style') return { ok: false, reason: 'unsupported-attribute' }
  if (lowerName === 'srcdoc') return { ok: false, reason: 'unsafe-attribute' }
  const removal = edit.attrAfter === null
  if (!removal && typeof edit.attrAfter !== 'string') return { ok: false, reason: 'invalid-edit' }
  if (!removal && URL_ATTRIBUTES.has(lowerName) && isScriptUrl(edit.attrAfter)) return { ok: false, reason: 'unsafe-attribute' }

  const located = locateElementDetailed(content, edit)
  if (!located.range) return { ok: false, reason: located.reason || 'unresolved-element' }
  const element = located.range
  const tag = element.tag
  const existing = (tag.attrs || []).find((attr) => attr.name === lowerName)

  if (existing) {
    const absoluteNameStart = tag.start + existing.nameStart
    const absoluteEnd = tag.start + existing.end
    if (removal) {
      let removeStart = absoluteNameStart
      while (removeStart > tag.start && /\s/.test(content[removeStart - 1])) removeStart -= 1
      return {
        ok: true,
        content: content.slice(0, removeStart) + content.slice(absoluteEnd),
        changed: true,
        lineIndex: removeStart,
      }
    }
    if (existing.equals && existing.value !== null) {
      const quote = existing.quote === "'" ? "'" : '"'
      const escaped = escapeAttributeValue(edit.attrAfter, quote)
      const valueStart = tag.start + existing.valueStart
      const valueEnd = tag.start + existing.valueEnd
      return {
        ok: true,
        content: content.slice(0, valueStart) + escaped + content.slice(valueEnd),
        changed: escaped !== existing.value,
        lineIndex: valueStart,
      }
    }
    // Boolean attribute present but the edit wants a value.
    const insertion = '="' + escapeAttributeValue(edit.attrAfter, '"') + '"'
    return {
      ok: true,
      content: content.slice(0, absoluteEnd) + insertion + content.slice(absoluteEnd),
      changed: true,
      lineIndex: absoluteEnd,
    }
  }

  if (removal) return { ok: true, content, changed: false, lineIndex: tag.start }

  // Insert a new attribute just before the tag close (`>` or `/>`).
  let insertAt = tag.end - 1
  const rawTag = tag.raw
  let cursor = rawTag.length - 2
  while (cursor >= 0 && /\s/.test(rawTag[cursor])) cursor -= 1
  if (rawTag[cursor] === '/') insertAt = tag.start + cursor
  const needsSpace = insertAt > tag.start && !/\s/.test(content[insertAt - 1])
  const insertion = (needsSpace ? ' ' : '') + name + '="' + escapeAttributeValue(edit.attrAfter, '"') + '"'
  return {
    ok: true,
    content: content.slice(0, insertAt) + insertion + content.slice(insertAt),
    changed: true,
    lineIndex: insertAt,
  }
}

export function isScriptUrl(value) {
  const text = String(value).replace(/[\u0000-\u0020]+/g, '').toLowerCase()
  return text.startsWith('javascript:') || text.startsWith('vbscript:') || text.startsWith('data:text/html') || text.startsWith('data:image/svg+xml')
}
// --------------------------------------------------------- structure edits

/** Elements a structural edit must never remove or move. */
const STRUCTURE_PROTECTED_TAGS = new Set(['html', 'head', 'body'])

/** Destination containers whose inner text is not markup. */
const STRUCTURE_UNSUPPORTED_PARENT_TAGS = new Set(['html', 'head', 'script', 'style', 'textarea', 'title'])

function structureExtent(range) {
  const end = typeof range.closeEnd === 'number' ? range.closeEnd : range.openEnd
  return { start: range.openStart, end }
}

function lineStartAt(content, index) {
  const found = content.lastIndexOf('\n', Math.max(0, index - 1))
  return found < 0 ? 0 : found + 1
}

function lineEndAt(content, index) {
  const found = content.indexOf('\n', index)
  return found < 0 ? content.length : found
}

/** Leading whitespace of the line index sits on, '' when the line is not blank. */
function indentAt(content, index) {
  const start = lineStartAt(content, index)
  const prefix = content.slice(start, index)
  return /^[ \t]*$/.test(prefix) ? prefix : ''
}

/**
 * Remove [start,end) from content. When the removed element occupied its own
 * line(s) (only whitespace before and after it) the whole line is dropped so no
 * blank gap is left behind; an inline removal keeps one separating space when
 * both neighbours carry one.
 */
function cutWithLineCleanup(content, start, end) {
  const startLine = lineStartAt(content, start)
  const endLine = lineEndAt(content, end)
  const prefixBlank = /^[ \t\r]*$/.test(content.slice(startLine, start))
  const suffixBlank = /^[ \t\r]*$/.test(content.slice(end, endLine))
  if (prefixBlank && suffixBlank) {
    const removeEnd = endLine < content.length ? endLine + 1 : endLine
    return {
      content: content.slice(0, startLine) + content.slice(removeEnd),
      start: startLine,
      end: removeEnd,
      lineIndex: startLine,
    }
  }
  let trimStart = start
  while (trimStart > startLine && /[ \t]/.test(content[trimStart - 1])) trimStart -= 1
  let trimEnd = end
  while (trimEnd < endLine && /[ \t]/.test(content[trimEnd])) trimEnd += 1
  let cutStart = start
  let cutEnd = end
  // Preserve the visible spacing around the removed element: keep one space
  // when both neighbours had one, otherwise leave the existing space alone.
  if (trimStart < start && trimEnd > end) {
    cutStart = trimStart + 1
    cutEnd = trimEnd
  }
  return {
    content: content.slice(0, cutStart) + content.slice(cutEnd),
    start: cutStart,
    end: cutEnd,
    lineIndex: cutStart,
  }
}

/** Parent tag index for every opening tag, mirroring the tokenizer's nesting. */
function elementParentIndexes(tags) {
  const parents = new Array(tags.length).fill(-1)
  const stack = []
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]
    if (tag.closing) {
      for (let cursor = stack.length - 1; cursor >= 0; cursor -= 1) {
        if (tags[stack[cursor]].name === tag.name) {
          stack.length = cursor
          break
        }
      }
      continue
    }
    parents[index] = stack.length > 0 ? stack[stack.length - 1] : -1
    if (!tag.selfClosing && !VOID_ELEMENTS.has(tag.name)) stack.push(index)
  }
  return parents
}

function nextSiblingIndexOf(tags, parents, index) {
  const parent = parents[index]
  for (let cursor = index + 1; cursor < tags.length; cursor += 1) {
    if (parents[cursor] !== parent) continue
    if (tags[cursor].closing) continue
    return cursor
  }
  return -1
}

/** Re-indent the continuation lines of a moved element snippet. */
function reindentSnippet(snippet, fromIndent, toIndent) {
  if (snippet.indexOf('\n') < 0 || fromIndent === toIndent) return snippet
  const lines = snippet.split('\n')
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '') {
      lines[index] = ''
      continue
    }
    if (fromIndent !== '' && line.indexOf(fromIndent) === 0) lines[index] = toIndent + line.slice(fromIndent.length)
    else if (fromIndent === '') lines[index] = toIndent + line
  }
  return lines.join('\n')
}

/** Delete one element (with its subtree) from a markup file. */
export function applyMarkupRemoveEdit(content, edit) {
  const located = locateElementDetailed(content, edit)
  if (!located.range) return { ok: false, reason: located.reason || 'unresolved-element' }
  const range = located.range
  const tag = range.tag && range.tag.name ? range.tag.name : ''
  if (STRUCTURE_PROTECTED_TAGS.has(tag)) return { ok: false, reason: 'protected-element' }
  const extent = structureExtent(range)
  const cut = cutWithLineCleanup(content, extent.start, extent.end)
  return { ok: true, content: cut.content, changed: cut.content !== content, lineIndex: cut.lineIndex }
}

/**
 * Move one element inside the same markup file: cut its source extent and
 * insert it before the anchor sibling (or append it to the destination parent
 * when no anchor is given). Both endpoints must resolve uniquely, otherwise
 * nothing is written.
 */
export function applyMarkupMoveEdit(content, edit) {
  const sourceLocated = locateElementDetailed(content, edit)
  if (!sourceLocated.range) return { ok: false, reason: sourceLocated.reason || 'unresolved-element' }
  const sourceRange = sourceLocated.range
  const sourceTag = sourceRange.tag && sourceRange.tag.name ? sourceRange.tag.name : ''
  if (STRUCTURE_PROTECTED_TAGS.has(sourceTag)) return { ok: false, reason: 'protected-element' }

  const { tags } = tokenizeHtml(content)
  const parents = elementParentIndexes(tags)
  const sourceIndex = sourceRange.tagIndex
  const sourceParentIndex = parents[sourceIndex]

  const parentSpec = {
    selector: typeof edit.targetParentSelector === 'string' ? edit.targetParentSelector : '',
    outerHTML: typeof edit.targetParentOuterHTML === 'string' ? edit.targetParentOuterHTML : '',
    textBefore: typeof edit.targetParentTextBefore === 'string' ? edit.targetParentTextBefore : '',
  }
  const parentRange = locateElement(content, parentSpec)
  if (!parentRange) return { ok: false, reason: 'unresolved-target-parent' }
  const parentTag = parentRange.tag && parentRange.tag.name ? parentRange.tag.name : ''
  if (parentTag === 'html') return { ok: false, reason: 'protected-element' }
  if (STRUCTURE_UNSUPPORTED_PARENT_TAGS.has(parentTag)) return { ok: false, reason: 'unsupported-target-parent' }
  if (typeof parentRange.closeStart !== 'number') return { ok: false, reason: 'unsupported-target-parent' }
  const parentIndex = parentRange.tagIndex

  // The destination must not be the moved element or one of its descendants.
  if (parentIndex === sourceIndex) return { ok: false, reason: 'invalid-move-target' }
  for (let cursor = parentIndex; cursor >= 0; cursor = parents[cursor]) {
    if (cursor === sourceIndex) return { ok: false, reason: 'invalid-move-target' }
  }

  const beforeSelector = typeof edit.beforeSelector === 'string' ? edit.beforeSelector.trim() : ''
  let anchorRange = null
  let anchorIndex = -1
  if (beforeSelector !== '') {
    const anchorSpec = {
      selector: beforeSelector,
      outerHTML: typeof edit.beforeOuterHTML === 'string' ? edit.beforeOuterHTML : '',
      textBefore: typeof edit.beforeTextBefore === 'string' ? edit.beforeTextBefore : '',
    }
    anchorRange = locateElement(content, anchorSpec)
    if (!anchorRange) return { ok: false, reason: 'unresolved-target-anchor' }
    anchorIndex = anchorRange.tagIndex
    if (anchorIndex === sourceIndex) return { ok: true, content, changed: false, lineIndex: sourceRange.openStart }
    if (parents[anchorIndex] !== parentIndex) return { ok: false, reason: 'invalid-move-target' }
  } else if (sourceParentIndex === parentIndex && nextSiblingIndexOf(tags, parents, sourceIndex) < 0) {
    return { ok: true, content, changed: false, lineIndex: sourceRange.openStart }
  }
  if (anchorIndex >= 0 && sourceParentIndex === parentIndex && nextSiblingIndexOf(tags, parents, sourceIndex) === anchorIndex) {
    return { ok: true, content, changed: false, lineIndex: sourceRange.openStart }
  }

  const extent = structureExtent(sourceRange)
  const snippet = content.slice(extent.start, extent.end)
  const sourceIndent = indentAt(content, extent.start)

  let destIndent = ''
  let insertAt = 0
  let insertionText = ''
  if (anchorRange) {
    // Insert before the anchor sibling, on the anchor's own line.
    destIndent = indentAt(content, anchorRange.openStart)
    const anchorLineStart = lineStartAt(content, anchorRange.openStart)
    const anchorLinePrefix = content.slice(anchorLineStart, anchorRange.openStart)
    const reindented = reindentSnippet(snippet, sourceIndent, destIndent)
    if (/^[ \t]*$/.test(anchorLinePrefix)) {
      insertAt = anchorLineStart
      insertionText = destIndent + reindented + '\n'
    } else {
      insertAt = anchorRange.openStart
      insertionText = reindented
    }
  } else {
    // Append inside the destination container, before its closing tag.
    let firstChild = -1
    for (let cursor = 0; cursor < tags.length; cursor += 1) {
      if (parents[cursor] !== parentIndex) continue
      if (tags[cursor].closing) continue
      firstChild = cursor
      break
    }
    const closeLineStart = lineStartAt(content, parentRange.closeStart)
    const closeIndent = indentAt(content, parentRange.closeStart)
    const closeLinePrefix = content.slice(closeLineStart, parentRange.closeStart)
    destIndent = firstChild >= 0 ? indentAt(content, tags[firstChild].start) : closeIndent + '  '
    const reindented = reindentSnippet(snippet, sourceIndent, destIndent)
    if (/^[ \t]*$/.test(closeLinePrefix)) {
      insertAt = closeLineStart
      insertionText = destIndent + reindented + '\n'
    } else {
      insertAt = parentRange.closeStart
      insertionText = reindented
    }
  }

  const cut = cutWithLineCleanup(content, extent.start, extent.end)
  let mapped = insertAt
  if (mapped >= cut.end) mapped = insertAt - (cut.end - cut.start)
  else if (mapped > cut.start) mapped = cut.start
  const next = cut.content.slice(0, mapped) + insertionText + cut.content.slice(mapped)
  if (next === content) return { ok: true, content, changed: false, lineIndex: sourceRange.openStart }
  return { ok: true, content: next, changed: true, lineIndex: Math.min(cut.lineIndex, mapped) }
}
