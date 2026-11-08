// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: balanced-brace CSS rule scanning and declaration patching.
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

import { skipStringToken, canonicalSelector, splitSelectorParts, lastCompound, compoundTokens, compoundOverlap } from './selector.js'

/**
 * Persist a style edit into a single-file-component `<style>` block. Scoped SFC
 * styles may need `:global()`; a warning is reported for this strategy.
 */
export function deleteDeclarations(body, property) {
  const segments = scanDeclarationSegments(body)
  const matches = []
  for (const segment of segments) {
    const colon = findTopLevelColon(body, segment.start, segment.end)
    if (colon < 0) continue
    if (!sameProperty(body.slice(segment.start, colon).trim(), property)) continue
    matches.push(segment)
  }
  if (matches.length === 0) return { body, changed: false, index: 0 }
  let text = body
  let firstIndex = 0
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const segment = matches[index]
    let end = segment.end
    if (text[end] === ';') end += 1
    text = text.slice(0, segment.start) + text.slice(end)
    firstIndex = segment.start
  }
  return { body: text, changed: true, index: firstIndex }
}

/** Remove a declaration from a rule with an exactly equal selector. */
export function removeCssDeclaration(cssText, selectorText, property) {
  const rules = scanCssRules(cssText)
  const target = canonicalSelector(selectorText)
  const exact = []
  for (let index = 0; index < rules.length; index += 1) {
    if (canonicalSelector(rules[index].selector) === target) exact.push(index)
  }
  if (exact.length === 0) return { ok: true, text: cssText, changed: false, index: 0 }
  let text = cssText
  let changed = false
  let firstIndex = 0
  for (let k = exact.length - 1; k >= 0; k -= 1) {
    const rule = rules[exact[k]]
    const bodyStart = rule.openBrace + 1
    const bodyEnd = rule.closeBrace
    const body = text.slice(bodyStart, bodyEnd)
    const removed = deleteDeclarations(body, property)
    if (k === 0) firstIndex = bodyStart + removed.index
    if (!removed.changed) continue
    changed = true
    const stripped = removed.body.replace(/\/\*[\s\S]*?\*\//g, '').trim()
    if (stripped === '') {
      text = text.slice(0, rule.selectorStart) + text.slice(bodyEnd + 1)
    } else {
      text = text.slice(0, bodyStart) + removed.body + text.slice(bodyEnd)
    }
  }
  return { ok: true, text, changed, index: firstIndex }
}

export function applyCssRule(cssText, selectorText, property, value, options = {}) {
  const nl = options.nl || '\n'
  const rules = scanCssRules(cssText)
  const target = canonicalSelector(selectorText)

  const exactRules = []
  for (let index = 0; index < rules.length; index += 1) {
    if (canonicalSelector(rules[index].selector) === target) exactRules.push(index)
  }
  if (exactRules.length > 0) {
    let text = cssText
    let changed = false
    let firstIndex = -1
    // Patch from highest offset down so earlier rule offsets stay valid.
    for (let k = exactRules.length - 1; k >= 0; k -= 1) {
      const rule = rules[exactRules[k]]
      const bodyStart = rule.openBrace + 1
      const bodyEnd = rule.closeBrace
      const ruleBody = text.slice(bodyStart, bodyEnd)
      const updated = updateDeclarations(ruleBody, property, value, nl)
      if (updated.changed) changed = true
      if (k === 0) firstIndex = bodyStart + updated.index
      text = text.slice(0, bodyStart) + updated.body + text.slice(bodyEnd)
    }
    return { ok: true, text, changed, index: firstIndex }
  }

  // Partial selector match: compare the last compound selector's id/class tokens.
  if (options.allowCompound !== false) {
    const targetTokens = compoundTokens(lastCompound(target))
    const candidates = []
    for (let index = 0; index < rules.length; index += 1) {
      const parts = splitSelectorParts(rules[index].selector)
      if (parts.length !== 1) continue // never rewrite a shared comma rule
      const ruleTokens = compoundTokens(lastCompound(canonicalSelector(parts[0])))
      const score = compoundOverlap(ruleTokens, targetTokens)
      if (score > 0) candidates.push({ index, score })
    }
    if (candidates.length > 0) {
      candidates.sort((left, right) => right.score - left.score)
      if (candidates.length > 1 && candidates[0].score === candidates[1].score) return { ok: false, reason: 'ambiguous-selector' }
      const rule = rules[candidates[0].index]
      const bodyStart = rule.openBrace + 1
      const bodyEnd = rule.closeBrace
      const ruleBody = cssText.slice(bodyStart, bodyEnd)
      const updated = updateDeclarations(ruleBody, property, value, nl)
      return {
        ok: true,
        text: cssText.slice(0, bodyStart) + updated.body + cssText.slice(bodyEnd),
        changed: updated.changed,
        index: bodyStart + updated.index,
      }
    }
  }

  if (options.mode === 'block') {
    let text = cssText
    if (text.length > 0 && !text.endsWith('\n')) text += nl
    else if (text.length === 0) text = nl
    const index = text.length + 2
    text += '  ' + selectorText.trim() + ' { ' + property + ': ' + value + '; }' + nl
    return { ok: true, text, changed: true, index }
  }

  let text = cssText
  if (text.length > 0 && !text.endsWith('\n')) text += nl
  if (text.length > 0) text += nl
  text += '/* dsh-nudge: added rule */' + nl
  const index = text.length
  text += selectorText.trim() + ' {' + nl + '  ' + property + ': ' + value + ';' + nl + '}' + nl
  return { ok: true, text, changed: true, index }
}

/** Balanced-brace scan of top-level CSS rules (comments and strings respected). */
export function scanCssRules(css) {
  const rules = []
  const length = css.length
  let index = 0
  let boundary = 0
  let depth = 0
  let openBrace = -1
  let selectorStart = 0
  while (index < length) {
    const ch = css[index]
    if (ch === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2)
      index = end < 0 ? length : end + 2
      continue
    }
    if (ch === '"' || ch === "'") {
      index = skipStringToken(css, index)
      continue
    }
    if (ch === '{') {
      if (depth === 0) {
        openBrace = index
        selectorStart = boundary
        depth = 1
      } else {
        depth += 1
      }
      index += 1
      continue
    }
    if (ch === '}') {
      if (depth > 0) {
        depth -= 1
        if (depth === 0 && openBrace >= 0) {
          rules.push({ selectorStart, selector: css.slice(selectorStart, openBrace), openBrace, closeBrace: index })
          boundary = index + 1
          openBrace = -1
        }
      }
      index += 1
      continue
    }
    if (ch === ';' && depth === 0) {
      boundary = index + 1
      index += 1
      continue
    }
    index += 1
  }
  return rules
}

export function scanDeclarationSegments(body) {
  const segments = []
  const length = body.length
  let index = 0
  let start = 0
  let depth = 0
  while (index < length) {
    const ch = body[index]
    if (ch === '/' && body[index + 1] === '*') {
      const end = body.indexOf('*/', index + 2)
      index = end < 0 ? length : end + 2
      continue
    }
    if (ch === '"' || ch === "'") {
      index = skipStringToken(body, index)
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1
      index += 1
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth > 0) depth -= 1
      index += 1
      continue
    }
    if (ch === ';' && depth === 0) {
      segments.push({ start, end: index })
      start = index + 1
      index += 1
      continue
    }
    index += 1
  }
  if (start < length) segments.push({ start, end: length })
  return segments
}

export function findTopLevelColon(text, from, to) {
  let index = from
  let depth = 0
  while (index < to) {
    const ch = text[index]
    if (ch === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      index = end < 0 ? to : end + 2
      continue
    }
    if (ch === '"' || ch === "'") {
      index = skipStringToken(text, index)
      if (index > to) return -1
      continue
    }
    if (ch === '(' || ch === '[') {
      depth += 1
      index += 1
      continue
    }
    if (ch === ')' || ch === ']') {
      if (depth > 0) depth -= 1
      index += 1
      continue
    }
    if (ch === ':' && depth === 0) return index
    index += 1
  }
  return -1
}

/**
 * Update one declaration inside a rule body; duplicate declarations for the
 * same property are merged into the first occurrence. Returns the new body, a
 * `changed` flag and the index of the property value within the new body.
 */
export function updateDeclarations(body, property, value, nl) {
  const segments = scanDeclarationSegments(body)
  const matches = []
  for (const segment of segments) {
    const colon = findTopLevelColon(body, segment.start, segment.end)
    if (colon < 0) continue
    const name = body.slice(segment.start, colon).trim()
    if (!name) continue
    if (!sameProperty(name, property)) continue
    matches.push({ segment, colon })
  }

  if (matches.length === 0) {
    const trimmedEnd = body.replace(/[ \t\r\n]+$/, '').length
    if (body.trim() === '') {
      const newBody = nl + '  ' + property + ': ' + value + ';' + nl
      return { body: newBody, changed: true, index: nl.length + 2 }
    }
    // Keep multi-line rules multi-line: insert a new declaration line instead
    // of gluing it onto the previous declaration.
    const multiline = body.includes('\n')
    let indent = '  '
    const indentMatch = /(?:^|\n)([ \t]+)\S/.exec(body)
    if (indentMatch) indent = indentMatch[1]
    const insertion = multiline ? nl + indent + property + ': ' + value + ';' : ' ' + property + ': ' + value + ';'
    const index = trimmedEnd + (multiline ? nl.length + indent.length : 1)
    return {
      body: body.slice(0, trimmedEnd) + insertion + body.slice(trimmedEnd),
      changed: true,
      index,
    }
  }

  const first = matches[0]
  const valueStart = first.colon + 1
  const rawOld = body.slice(valueStart, first.segment.end)
  const leading = /^[ \t\r\n]*/.exec(rawOld)[0]
  const nextRaw = leading + value
  const delta = nextRaw.length - rawOld.length
  const changedValue = rawOld.trim() !== value
  let result = body.slice(0, valueStart) + nextRaw + body.slice(first.segment.end)
  for (let k = matches.length - 1; k >= 1; k -= 1) {
    const segment = matches[k].segment
    let removeStart = segment.start + (segment.start > valueStart ? delta : 0)
    let removeEnd = segment.end + (segment.start > valueStart ? delta : 0)
    if (result[removeEnd] === ';') removeEnd += 1
    while (removeStart > 0 && /[ \t\r\n]/.test(result[removeStart - 1])) removeStart -= 1
    result = result.slice(0, removeStart) + result.slice(removeEnd)
  }
  return { body: result, changed: changedValue || matches.length > 1, index: valueStart + leading.length }
}

export function sameProperty(name, property) {
  if (property.startsWith('--')) return name === property
  return name.toLowerCase() === property.toLowerCase()
}
