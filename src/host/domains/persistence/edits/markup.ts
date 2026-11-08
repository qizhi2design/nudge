// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: persist text and attribute edits into markup files.
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

import { URL_ATTRIBUTES } from '../constants.js'
import { locateElement } from '../html/locate.js'
import { tokenizeHtml, textNodeRanges } from '../html/tokenizer.js'
import { escapeRegExp } from '../shared/paths.js'
import { diffText, decodeEntities, decodeEntitiesWithMap, escapeHtmlText, escapeAttributeValue, stripMarkup, normalizeWhitespaceText, compactText } from '../shared/text.js'

export function applyMarkupTextEdit(content, edit) {
  const textAfter = typeof edit.textAfter === 'string' ? edit.textAfter : typeof edit.after === 'string' ? edit.after : null
  if (textAfter === null) return { ok: false, reason: 'invalid-edit' }
  const element = locateElement(content, edit)
  if (!element) return { ok: false, reason: 'unresolved-element' }

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

  const element = locateElement(content, edit)
  if (!element) return { ok: false, reason: 'unresolved-element' }
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
