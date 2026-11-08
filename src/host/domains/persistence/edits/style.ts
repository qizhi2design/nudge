// @ts-nocheck
/**
 * dsh.nudge — host persistence domain: persist style edits into CSS, HTML override blocks and SFC styles.
 *
 * Pure functions only: no I/O, no top-level side effects.
 */

import { OVERRIDE_STYLE_ID } from '../constants.js'
import { removeCssDeclaration, applyCssRule } from '../css/patch.js'
import { tokenizeHtml, attrValue, matchingCloseTagIndex } from '../html/tokenizer.js'
import { newlineOf } from '../shared/paths.js'
import { normalizeSelector, normalizeProperty, normalizeStyleValue } from '../shared/text.js'

export function styleEditParts(edit) {
  const hints = edit.sourceHints && typeof edit.sourceHints === 'object' ? edit.sourceHints : {}
  const selectorSource = typeof hints.styleSelector === 'string' && hints.styleSelector.trim() !== '' ? hints.styleSelector : edit.selector
  const selector = normalizeSelector(selectorSource)
  const property = normalizeProperty(edit.property)
  const rawValue = typeof edit.value === 'string' ? edit.value : typeof edit.after === 'string' ? edit.after : ''
  const value = rawValue.trim() === '' ? '' : normalizeStyleValue(rawValue)
  if (!selector || !property || value === null) return null
  return { selector, property, value }
}

/** Update/append a CSS rule inside a plain stylesheet file. */
export function applyCssRuleEdit(content, edit) {
  const parts = styleEditParts(edit)
  if (!parts || parts.value === '') return { ok: false, reason: 'invalid-edit' }
  const applied = applyCssRule(content, parts.selector, parts.property, parts.value, {
    nl: newlineOf(content),
    mode: 'sheet',
    allowCompound: true,
  })
  if (!applied.ok) return applied
  return { ok: true, content: applied.text, changed: applied.changed, lineIndex: applied.index }
}

/**
 * Persist a style override into static HTML through a dedicated `<style>` block
 * (`dsh-nudge-overrides`), creating it in `<head>` when missing.
 */
export function applyHtmlOverrideEdit(content, edit) {
  const selector = normalizeSelector(edit.selector)
  const property = normalizeProperty(edit.property)
  const rawValue = typeof edit.value === 'string' ? edit.value : typeof edit.after === 'string' ? edit.after : ''
  const value = normalizeStyleValue(rawValue)
  const removal = !value
  if (!selector || !property) return { ok: false, reason: 'invalid-edit' }

  const nl = newlineOf(content)
  const { tags } = tokenizeHtml(content)
  let styleIndex = -1
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]
    if (tag.closing || tag.name !== 'style') continue
    if (attrValue(tag, 'id') === OVERRIDE_STYLE_ID) {
      styleIndex = index
      break
    }
  }
  if (styleIndex >= 0) {
    const closeIndex = matchingCloseTagIndex(tags, styleIndex, 'style')
    if (closeIndex < 0) return { ok: false, reason: 'unresolved-element' }
    const open = tags[styleIndex]
    const close = tags[closeIndex]
    const blockBody = content.slice(open.end, close.start)
    const applied = removal
      ? removeCssDeclaration(blockBody, selector, property)
      : applyCssRule(blockBody, selector, property, value, { nl, mode: 'block', allowCompound: true })
    if (!applied.ok) return applied
    return {
      ok: true,
      content: content.slice(0, open.end) + applied.text + content.slice(close.start),
      changed: applied.changed,
      lineIndex: open.end + applied.index,
    }
  }
  if (removal) return { ok: true, content, changed: false, lineIndex: 0 }

  let insertAt = content.length
  for (const tag of tags) {
    if (tag.closing && tag.name === 'head') {
      insertAt = tag.start
      break
    }
  }
  if (insertAt === content.length) {
    for (const tag of tags) {
      if (tag.closing && tag.name === 'body') {
        insertAt = tag.start
        break
      }
    }
  }
  const prefixNewline = insertAt > 0 && content[insertAt - 1] !== '\n' ? nl : ''
  const openText = '<style id="' + OVERRIDE_STYLE_ID + '">'
  const block = openText + nl + '  ' + selector + ' { ' + property + ': ' + value + '; }' + nl + '</style>' + nl
  const lineIndex = insertAt + prefixNewline.length + openText.length + nl.length + 2
  return {
    ok: true,
    content: content.slice(0, insertAt) + prefixNewline + block + content.slice(insertAt),
    changed: true,
    lineIndex,
  }
}

/**
 * Update the declaration for `property` inside an existing matching rule, or
 * append a new rule. Supports a balanced-brace scanner (no full CSS parsing).
 * @returns {{ok:true,text:string,changed:boolean,index:number}|{ok:false,reason:string}}
 */
export function applyTemplateStyleEdit(content, edit) {
  const selector = normalizeSelector(edit.selector)
  const property = normalizeProperty(edit.property)
  const rawValue = typeof edit.value === 'string' ? edit.value : typeof edit.after === 'string' ? edit.after : ''
  const value = normalizeStyleValue(rawValue)
  if (!selector || !property || !value) return { ok: false, reason: 'invalid-edit' }

  const nl = newlineOf(content)
  const { tags } = tokenizeHtml(content)
  let styleIndex = -1
  for (let index = 0; index < tags.length; index += 1) {
    if (!tags[index].closing && tags[index].name === 'style') {
      styleIndex = index
      break
    }
  }
  if (styleIndex >= 0) {
    const closeIndex = matchingCloseTagIndex(tags, styleIndex, 'style')
    if (closeIndex >= 0) {
      const open = tags[styleIndex]
      const close = tags[closeIndex]
      const blockBody = content.slice(open.end, close.start)
      const applied = applyCssRule(blockBody, selector, property, value, { nl, mode: 'block', allowCompound: true })
      if (!applied.ok) return applied
      return {
        ok: true,
        content: content.slice(0, open.end) + applied.text + content.slice(close.start),
        changed: applied.changed,
        lineIndex: open.end + applied.index,
      }
    }
  }

  let prefix = content
  if (prefix.length > 0 && !prefix.endsWith('\n')) prefix += nl
  const lead = prefix.length > 0 ? nl : ''
  const block = '<style>' + nl + '  ' + selector + ' { ' + property + ': ' + value + '; }' + nl + '</style>' + nl
  return {
    ok: true,
    content: prefix + lead + block,
    changed: true,
    lineIndex: prefix.length + lead.length + '<style>'.length + nl.length + 2,
  }
}
