// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: CSS selector normalization and compound matching.
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

/** Split a rule body into declaration segments at top-level semicolons. */
export function skipStringToken(text, index) {
  const quote = text[index]
  let cursor = index + 1
  while (cursor < text.length) {
    const ch = text[cursor]
    if (ch === '\\') {
      cursor += 2
      continue
    }
    if (ch === quote) return cursor + 1
    cursor += 1
  }
  return text.length
}

export function canonicalSelector(text) {
  if (typeof text !== 'string') return ''
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~,])\s*/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Split a selector list on top-level commas. */
export function splitSelectorParts(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]
    if (ch === '(' || ch === '[') {
      depth += 1
      continue
    }
    if (ch === ')' || ch === ']') {
      if (depth > 0) depth -= 1
      continue
    }
    if (ch === '"' || ch === "'") {
      index = skipStringToken(text, index) - 1
      continue
    }
    if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, index))
      start = index + 1
    }
  }
  parts.push(text.slice(start))
  return parts.map((part) => part.trim()).filter((part) => part !== '')
}

/** Split a complex selector into compound selectors at top-level combinators. */
export function splitCompounds(selector) {
  const parts = []
  let depth = 0
  let current = ''
  for (let index = 0; index < selector.length; index += 1) {
    const ch = selector[index]
    if (ch === '(' || ch === '[') {
      depth += 1
      current += ch
      continue
    }
    if (ch === ')' || ch === ']') {
      if (depth > 0) depth -= 1
      current += ch
      continue
    }
    if (depth === 0 && (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '>' || ch === '+' || ch === '~')) {
      if (current.trim() !== '') parts.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim() !== '') parts.push(current.trim())
  return parts
}

export function lastCompound(selector) {
  const parts = splitCompounds(selector)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

/** Remove pseudo-classes/elements so token extraction only sees ids/classes. */
export function stripPseudo(compound) {
  return compound.replace(/::?[A-Za-z-]+(?:\((?:[^()]|\([^()]*\))*\))?/g, '')
}

export function compoundTokens(compound) {
  const cleaned = stripPseudo(compound)
  const ids = []
  const classes = []
  for (const match of cleaned.matchAll(/#([A-Za-z_][A-Za-z0-9_-]*)/g)) ids.push(match[1])
  for (const match of cleaned.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) classes.push(match[1])
  const tagMatch = /^([A-Za-z][A-Za-z0-9-]*)/.exec(cleaned)
  return { ids, classes, tag: tagMatch ? tagMatch[1].toLowerCase() : '' }
}

export function compoundOverlap(left, right) {
  let score = 0
  for (const id of left.ids) if (right.ids.includes(id)) score += 2
  for (const cls of left.classes) if (right.classes.includes(cls)) score += 1
  return score
}
