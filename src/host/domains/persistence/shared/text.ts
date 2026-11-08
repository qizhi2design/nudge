// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: text normalization, entity decoding and diff helpers.
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

export function diffText(before, after) {
  if (typeof before !== 'string' || typeof after !== 'string') return null
  let prefix = 0
  const maxPrefix = Math.min(before.length, after.length)
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  const maxSuffix = Math.min(before.length, after.length) - prefix
  while (suffix < maxSuffix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1
  return {
    oldText: before.slice(prefix, before.length - suffix),
    newText: after.slice(prefix, after.length - suffix),
    prefix,
    suffix,
  }
}

export function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body) => {
    const decoded = decodeEntity('&' + body + ';')
    return decoded === null ? whole : decoded
  })
}

/** Decode entities while keeping decoded-index -> raw start/end maps. */
export function decodeEntitiesWithMap(raw) {
  const chars = []
  const starts = []
  const ends = []
  let index = 0
  while (index < raw.length) {
    if (raw[index] === '&') {
      const semi = raw.indexOf(';', index + 1)
      if (semi > index && semi - index <= 12) {
        const decoded = decodeEntity(raw.slice(index, semi + 1))
        if (decoded !== null) {
          for (const ch of decoded) {
            chars.push(ch)
            starts.push(index)
            ends.push(semi + 1)
          }
          index = semi + 1
          continue
        }
      }
    }
    chars.push(raw[index])
    starts.push(index)
    ends.push(index + 1)
    index += 1
  }
  return { text: chars.join(''), start: starts, end: ends }
}

export function decodeEntity(entity) {
  const named = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': '\u00A0',
  }
  if (Object.prototype.hasOwnProperty.call(named, entity)) return named[entity]
  const numeric = /^&#(x?)([0-9a-fA-F]+);$/.exec(entity)
  if (numeric) {
    const code = parseInt(numeric[2], numeric[1] ? 16 : 10)
    if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff) {
      try {
        return String.fromCodePoint(code)
      } catch {
        return null
      }
    }
  }
  return null
}

export function escapeHtmlText(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeAttributeValue(value, quote) {
  const q = quote === "'" ? "'" : '"'
  let text = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  text = q === '"' ? text.replace(/"/g, '&quot;') : text.replace(/'/g, '&#39;')
  return text
}

/** Strip tags/comments then decode entities (used for text comparisons). */
export function stripMarkup(fragment) {
  return decodeEntities(
    String(fragment)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
}

export function normalizeWhitespaceText(text) {
  return String(text).replace(/\s+/g, ' ').trim()
}

/** Whitespace-free comparison form used to verify a proposed text patch. */
export function compactText(text) {
  return String(text).replace(/\s+/g, '')
}

export function normalizeWhitespaceWithMap(text) {
  const chars = []
  const map = []
  let pendingSpace = -1
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    const ch = text[index]
    const isSpace = code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11
    if (isSpace) {
      if (pendingSpace < 0) pendingSpace = index
      continue
    }
    if (pendingSpace >= 0 && chars.length > 0) {
      chars.push(' ')
      map.push(pendingSpace)
    }
    pendingSpace = -1
    chars.push(ch)
    map.push(index)
  }
  return { text: chars.join(''), map }
}

export function normalizeSelector(raw) {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '' || text.length > 500) return null
  if (/[;{}]/.test(text)) return null
  if (text.includes('/*') || text.includes('*/') || text.includes('\u0000')) return null
  if (/<\/?[A-Za-z]/.test(text)) return null
  return text
}

export function normalizeProperty(raw) {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '' || text.length > 128) return null
  if (/[;{}<>]/.test(text) || text.includes('/*') || text.includes('\u0000')) return null
  if (text.startsWith('--')) return text
  // The Client speaks CSSOM camelCase (`fontSize`, `backgroundColor`); the
  // source must use kebab-case declarations.
  const kebab = text.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()).toLowerCase()
  if (!/^-?[a-z][a-z0-9-]*$/.test(kebab)) return null
  return kebab
}

export function normalizeStyleValue(raw) {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text === '' || text.length > 1000) return null
  if (/[;{}<>]/.test(text) || text.includes('/*') || text.includes('\u0000')) return null
  if (/<\/style/i.test(text)) return null
  return text
}
