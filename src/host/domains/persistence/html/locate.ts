// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: locate the edited element inside one source file.
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

import { VOID_ELEMENTS } from '../constants.js'
import { canonicalSelector, lastCompound, compoundTokens } from '../css/selector.js'
import { tokenizeHtml, attrValue, elementRange, findOpeningTagsByAttribute, collectTagIndexes, attributeSignature } from './tokenizer.js'
import { stripMarkup, normalizeWhitespaceText, normalizeWhitespaceWithMap } from '../shared/text.js'

export function locateElement(content, edit) {
  const { tags } = tokenizeHtml(content)
  const selector = typeof edit.selector === 'string' ? edit.selector : ''
  const outerHTML = typeof edit.outerHTML === 'string' ? edit.outerHTML : ''

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
  for (const id of idCandidates) {
    if (seenIds.has(id)) continue
    seenIds.add(id)
    const found = findOpeningTagsByAttribute(tags, 'id', id)
    if (found.length === 1) {
      const range = elementRange(content, tags, found[0])
      if (range) return range
    }
  }

  if (outerHTML) {
    const byOuter = locateByOuterHtml(content, tags, outerHTML)
    if (byOuter >= 0) {
      const range = elementRange(content, tags, byOuter)
      if (range) return range
    }
  }

  const byText = locateByTextBefore(content, tags, edit)
  if (byText >= 0) {
    const range = elementRange(content, tags, byText)
    if (range) return range
  }
  return null
}

export function locateByOuterHtml(content, tags, outerHTML) {
  const normalizedTarget = normalizeWhitespaceText(outerHTML)
  if (!normalizedTarget) return -1
  const normalizedContent = normalizeWhitespaceWithMap(content)
  const needles = [normalizedTarget]
  if (normalizedTarget.length > 200) needles.push(normalizedTarget.slice(0, 200))
  if (normalizedTarget.length > 80) needles.push(normalizedTarget.slice(0, 80))
  for (const needle of needles) {
    const first = normalizedContent.text.indexOf(needle)
    if (first < 0) continue
    if (normalizedContent.text.indexOf(needle, first + 1) >= 0) continue
    const rawIndex = normalizedContent.map[first]
    if (typeof rawIndex !== 'number') continue
    const tagIndex = tags.findIndex((tag) => !tag.closing && tag.start === rawIndex)
    if (tagIndex >= 0) return tagIndex
  }

  // Fallback: compare the opening-tag attribute signature (DOM serialization
  // may reorder or normalize source attributes).
  const outerOpen = tokenizeHtml(outerHTML).tags.find((tag) => !tag.closing)
  if (!outerOpen) return -1
  const signature = attributeSignature(outerOpen.attrs)
  const matches = []
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]
    if (tag.closing || tag.selfClosing || tag.name !== outerOpen.name) continue
    if (attributeSignature(tag.attrs) === signature) matches.push(index)
  }
  if (matches.length === 1) return matches[0]

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
    if (textMatches.length === 1) return textMatches[0]
  }
  return -1
}

export function locateByTextBefore(content, tags, edit) {
  const before = typeof edit.textBefore === 'string' ? edit.textBefore : ''
  if (before.trim() === '') return -1
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
  if (strong.length === 1) return strong[0]
  if (strong.length === 0 && weak.length === 1) return weak[0]
  return -1
}
