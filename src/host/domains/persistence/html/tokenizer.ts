// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: minimal HTML tokenizer and element/extent helpers.
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

import { VOID_ELEMENTS, RAW_TEXT_ELEMENTS } from '../constants.js'

export function tokenizeHtml(html) {
  const tags = []
  const skips = []
  const length = html.length
  let index = 0
  while (index < length) {
    const lt = html.indexOf('<', index)
    if (lt < 0) break
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      const stop = end < 0 ? length : end + 3
      skips.push({ start: lt, end: stop })
      index = stop
      continue
    }
    if (html.startsWith('<![CDATA[', lt)) {
      const end = html.indexOf(']]>', lt + 9)
      const stop = end < 0 ? length : end + 3
      skips.push({ start: lt, end: stop })
      index = stop
      continue
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt + 2)
      const stop = end < 0 ? length : end + 1
      skips.push({ start: lt, end: stop })
      index = stop
      continue
    }
    if (html[lt + 1] === '/') {
      const match = /^<\/\s*([A-Za-z][A-Za-z0-9:._-]*)\s*>/.exec(html.slice(lt, Math.min(lt + 160, length)))
      if (!match) {
        index = lt + 1
        continue
      }
      tags.push({
        name: match[1].toLowerCase(),
        closing: true,
        start: lt,
        end: lt + match[0].length,
        raw: match[0],
        selfClosing: false,
        attrs: [],
      })
      index = lt + match[0].length
      continue
    }
    const match = /^<([A-Za-z][A-Za-z0-9:._-]*)/.exec(html.slice(lt, Math.min(lt + 160, length)))
    if (!match) {
      index = lt + 1
      continue
    }
    const name = match[1].toLowerCase()
    let cursor = lt + 1 + match[1].length
    let quote = null
    while (cursor < length) {
      const ch = html[cursor]
      if (quote !== null) {
        if (ch === '\\') {
          cursor += 2
          continue
        }
        if (ch === quote) quote = null
        cursor += 1
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = ch
        cursor += 1
        continue
      }
      if (ch === '>') break
      cursor += 1
    }
    if (cursor >= length) break
    const end = cursor + 1
    const raw = html.slice(lt, end)
    const selfClosing = /\/\s*>$/.test(raw)
    tags.push({ name, closing: false, start: lt, end, raw, selfClosing, attrs: parseAttributes(raw) })
    index = end
    if (!selfClosing && RAW_TEXT_ELEMENTS.has(name)) {
      const closeRe = new RegExp('</\\s*' + name + '\\s*>', 'i')
      const found = closeRe.exec(html.slice(end))
      if (found) {
        skips.push({ start: end, end: end + found.index })
        index = end + found.index
      }
    }
  }
  return { tags, skips }
}

/** Parse attributes from a raw opening tag; offsets stay relative to `rawTag`. */
export function parseAttributes(rawTag) {
  const attrs = []
  const length = rawTag.length
  let index = 1
  while (index < length && !/[\s/>]/.test(rawTag[index])) index += 1
  while (index < length) {
    while (index < length && /\s/.test(rawTag[index])) index += 1
    if (index >= length) break
    const ch = rawTag[index]
    if (ch === '>') break
    if (ch === '/') {
      index += 1
      continue
    }
    const nameStart = index
    while (index < length && !/[\s=/>]/.test(rawTag[index])) index += 1
    const rawName = rawTag.slice(nameStart, index)
    if (rawName === '') {
      index += 1
      continue
    }
    const name = rawName.toLowerCase()
    let cursor = index
    while (cursor < length && /\s/.test(rawTag[cursor])) cursor += 1
    let value = null
    let valueStart = -1
    let valueEnd = -1
    let quote = null
    let equals = false
    let end = index
    if (cursor < length && rawTag[cursor] === '=') {
      equals = true
      cursor += 1
      while (cursor < length && /\s/.test(rawTag[cursor])) cursor += 1
      if (cursor < length && (rawTag[cursor] === '"' || rawTag[cursor] === "'")) {
        quote = rawTag[cursor]
        valueStart = cursor + 1
        const closeQuote = rawTag.indexOf(quote, valueStart)
        if (closeQuote < 0) {
          valueEnd = length
          value = rawTag.slice(valueStart, length)
          end = length
          index = length
        } else {
          valueEnd = closeQuote
          value = rawTag.slice(valueStart, closeQuote)
          end = closeQuote + 1
          index = closeQuote + 1
        }
      } else {
        valueStart = cursor
        while (cursor < length && !/[\s>]/.test(rawTag[cursor])) cursor += 1
        valueEnd = cursor
        value = rawTag.slice(valueStart, valueEnd)
        end = cursor
        index = cursor
      }
    } else {
      end = index
      index = cursor
    }
    attrs.push({ name, rawName, nameStart, value, valueStart, valueEnd, quote, equals, end })
  }
  return attrs
}

export function attrValue(tag, name) {
  const lower = String(name).toLowerCase()
  const found = (tag.attrs || []).find((attr) => attr.name === lower)
  return found ? found.value : null
}

export function matchingCloseTagIndex(tags, openIndex, name) {
  let depth = 0
  for (let index = openIndex; index < tags.length; index += 1) {
    const tag = tags[index]
    if (tag.name !== name) continue
    if (tag.closing) {
      depth -= 1
      if (depth === 0) return index
    } else if (!tag.selfClosing) {
      depth += 1
    }
  }
  return -1
}

/** Full extent of one element (open tag, inner range, close tag when present). */
export function elementRange(content, tags, openIndex) {
  const open = tags[openIndex]
  if (!open || open.closing) return null
  if (open.selfClosing || VOID_ELEMENTS.has(open.name)) {
    return { tag: open, tagIndex: openIndex, innerStart: open.end, innerEnd: open.end, openStart: open.start, openEnd: open.end }
  }
  let depth = 1
  for (let index = openIndex + 1; index < tags.length; index += 1) {
    const tag = tags[index]
    if (tag.name !== open.name) continue
    if (tag.closing) {
      depth -= 1
      if (depth === 0) {
        return {
          tag: open,
          tagIndex: openIndex,
          innerStart: open.end,
          innerEnd: tag.start,
          openStart: open.start,
          openEnd: open.end,
          closeStart: tag.start,
          closeEnd: tag.end,
        }
      }
    } else if (!tag.selfClosing) {
      depth += 1
    }
  }
  return null
}

export function findOpeningTagsByAttribute(tags, name, value) {
  const found = []
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]
    if (tag.closing) continue
    if (attrValue(tag, name) === value) found.push(index)
  }
  return found
}

/** Ranges of raw text nodes inside `container`, excluding tags/skips. */
export function textNodeRanges(container, tags, skips) {
  const blocked = []
  for (const tag of tags) blocked.push([tag.start, tag.end])
  for (const skip of skips) blocked.push([skip.start, skip.end])
  blocked.sort((left, right) => left[0] - right[0])
  const ranges = []
  let cursor = 0
  for (const [start, end] of blocked) {
    if (start > cursor) ranges.push({ start: cursor, end: start })
    if (end > cursor) cursor = end
  }
  if (cursor < container.length) ranges.push({ start: cursor, end: container.length })
  return ranges
}

/**
 * Ordered element tree for one tokenized document. Element children are
 * collected per opening-tag index; the root bucket (-1) holds the top-level
 * elements. Void and self-closing tags are element children but never parents,
 * which is exactly how the runtime's childNodes walk sees them.
 */
export function buildElementIndex(tags) {
  const parents = new Array(tags.length).fill(-1)
  const childrenOf = new Map()
  childrenOf.set(-1, [])
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
    const parent = stack.length > 0 ? stack[stack.length - 1] : -1
    parents[index] = parent
    const bucket = childrenOf.get(parent)
    if (bucket) bucket.push(index)
    else childrenOf.set(parent, [index])
    if (!tag.selfClosing && !VOID_ELEMENTS.has(tag.name)) stack.push(index)
  }
  return { parents, childrenOf }
}

/**
 * Locate the edited element using, in order: id anchor, a unique normalized
 * occurrence of outerHTML, then the exact textBefore inside a tag whose
 * class/id tokens match the selector.
 */
export function collectTagIndexes(tags, name) {
  const found = []
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]
    if (!tag.closing && !tag.selfClosing && tag.name === name) found.push(index)
  }
  return found
}

export function attributeSignature(attrs) {
  return (attrs || [])
    .map((attr) => attr.name + '=' + (attr.value === null || attr.value === undefined ? '' : String(attr.value)))
    .sort()
    .join('\u0001')
}
