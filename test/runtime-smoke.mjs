#!/usr/bin/env node
/**
 * Engineering smoke test for lib/runtime.js.
 *
 * The runtime normally runs inside Chromium. This test loads it into a tiny
 * hand-written DOM shim so the API contract, the CSSOM edit helpers, selector
 * generation, event queue and re-injection behaviour can be exercised with
 * plain `node test/runtime-smoke.mjs`.
 */
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const RUNTIME_PATH = resolve(HERE, '..', 'lib', 'runtime.js')

/* ------------------------------------------------------------------ result */

let failures = 0
let checks = 0

function ok(name, condition, detail) {
  checks += 1
  if (condition) {
    process.stdout.write('ok - ' + name + '\n')
    return
  }
  failures += 1
  process.stderr.write('not ok - ' + name + (detail ? ' :: ' + detail : '') + '\n')
}

function safeString(value) {
  if (value === undefined) return 'undefined'
  if (typeof value === 'function') return '[function]'
  if (typeof value === 'object' && value !== null) {
    try {
      const seen = new WeakSet()
      return JSON.stringify(value, (key, nested) => {
        if (typeof nested === 'object' && nested !== null) {
          if (seen.has(nested)) return '[circular]'
          seen.add(nested)
        }
        return nested
      })
    } catch {
      return Object.prototype.toString.call(value)
    }
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function eq(name, actual, expected) {
  ok(name, Object.is(actual, expected), 'expected ' + safeString(expected) + ', got ' + safeString(actual))
}

function deepEq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}

function section(name) {
  process.stdout.write('# ' + name + '\n')
}

/* ---------------------------------------------------------------- fake DOM */

const COLOR_KEYWORDS = new Set([
  'transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'revert', 'red', 'blue', 'green',
  'white', 'black', 'gray', 'grey', 'yellow', 'orange', 'purple', 'pink', 'brown', 'silver',
  'navy', 'teal', 'lime', 'aqua', 'maroon', 'olive', 'fuchsia', 'none',
])
const DISPLAY_KEYWORDS = new Set([
  'block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'contents', 'none', 'table', 'list-item',
])
const GENERIC_KEYWORDS = new Set([
  'auto', 'normal', 'none', 'inherit', 'initial', 'unset', 'revert', 'fit-content', 'max-content', 'min-content',
  'transparent', 'currentcolor',
])

function isValidPropertyName(name) {
  return /^--[a-zA-Z0-9_-]+$/.test(name) || /^[a-z][a-z-]*$/.test(name)
}

function isValidPropertyValue(name, value) {
  if (value === '') return true
  if (/[;{}]|<\/?script/i.test(value)) return false
  if (name === 'color' || name === 'background-color' || name === 'border-color') {
    if (/^#[0-9a-f]{3,8}$/i.test(value)) return true
    if (/^(?:rgba?|hsla?)\([^)]*\)$/i.test(value)) return true
    return COLOR_KEYWORDS.has(value.toLowerCase())
  }
  if (name === 'display') return DISPLAY_KEYWORDS.has(value.toLowerCase())
  if (name === 'opacity') return /^-?\d*\.?\d+$/.test(value) || GENERIC_KEYWORDS.has(value.toLowerCase())
  if (name === 'fill' || name === 'stroke') return true
  if (/^(?:width|height|min-width|min-height|max-width|max-height|font-size|line-height|top|right|bottom|left|gap|border-radius|letter-spacing|margin|padding|margin-top|margin-right|margin-bottom|margin-left|padding-top|padding-right|padding-bottom|padding-left|border|border-width|z-index|transform|box-shadow|background-image|flex-direction|justify-content|align-items|overflow|visibility)$/.test(name)) {
    if (GENERIC_KEYWORDS.has(value.toLowerCase())) return true
    return /^[-+]?(?:\d*\.)?\d+(?:px|%|em|rem|vh|vw|pt|s|ms)?$/i.test(value) || /^(?:solid|dashed|dotted|none|row|column|flex-start|flex-end|center|space-between|space-around|space-evenly|stretch|normal|visible|hidden|clip|scroll|auto|absolute|relative|fixed|sticky|static)$/i.test(value) || /[a-z(]/.test(value)
  }
  return true
}

class FakeStyle {
  constructor() {
    this._store = new Map()
    this._priorities = new Map()
  }
  get length() {
    return this._store.size
  }
  item(index) {
    return Array.from(this._store.keys())[index] || ''
  }
  setProperty(name, value, priority) {
    const key = String(name).toLowerCase()
    const text = String(value)
    if (!isValidPropertyName(key)) return
    if (!isValidPropertyValue(key, text)) return
    this._store.set(key, text)
    this._priorities.set(key, priority || '')
  }
  removeProperty(name) {
    const key = String(name).toLowerCase()
    const had = this._store.has(key)
    this._store.delete(key)
    this._priorities.delete(key)
    return had ? this._store.get(key) || '' : ''
  }
  getPropertyValue(name) {
    return this._store.get(String(name).toLowerCase()) || ''
  }
  getPropertyPriority(name) {
    return this._priorities.get(String(name).toLowerCase()) || ''
  }
  get cssText() {
    return Array.from(this._store.entries())
      .map(([property, value]) => property + ': ' + value + ';')
      .join(' ')
  }
}

class FakeTextNode {
  constructor(value) {
    this.nodeType = 3
    this.nodeValue = String(value)
    this.parentNode = null
  }
  get textContent() {
    return this.nodeValue
  }
  set textContent(value) {
    this.nodeValue = String(value)
  }
  get isConnected() {
    let node = this.parentNode
    while (node) {
      if (node.nodeType === 9) return true
      if (node === node.ownerDocument?.documentElement) return true
      node = node.parentNode
    }
    return false
  }
}

class FakeDocumentFragment {
  constructor(document) {
    this.nodeType = 11
    this.ownerDocument = document
    this.parentNode = null
    this.childNodes = []
  }
  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1)
  }
  appendChild(node) {
    if (!node) return node
    if (node.parentNode) node.parentNode.removeChild(node)
    node.parentNode = this
    this.childNodes.push(node)
    return node
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node)
    if (index !== -1) this.childNodes.splice(index, 1)
    node.parentNode = null
    return node
  }
  get textContent() {
    return this.childNodes.map((node) => node.textContent || '').join('')
  }
}

class FakeEvent {
  constructor(type, init) {
    const options = init || {}
    this.type = type
    this.target = options.target || null
    this.button = options.button === undefined ? 0 : options.button
    this.clientX = options.clientX || 0
    this.clientY = options.clientY || 0
    this.key = options.key || ''
    this.code = options.code || ''
    this.metaKey = options.metaKey === true
    this.ctrlKey = options.ctrlKey === true
    this.shiftKey = options.shiftKey === true
    this.altKey = options.altKey === true
    this.repeat = options.repeat === true
    this.isComposing = options.isComposing === true
    this.relatedTarget = options.relatedTarget || null
    this.defaultPrevented = false
    this._stopped = false
    this._path = null
  }
  preventDefault() {
    this.defaultPrevented = true
  }
  stopPropagation() {
    this._stopped = true
  }
  stopImmediatePropagation() {
    this._stopped = true
  }
  composedPath() {
    return this._path || buildPath(this.target)
  }
}

function eventTargetMixin(target) {
  const listeners = new Map()
  target.__listeners = listeners
  target.addEventListener = (type, handler, capture) => {
    const key = String(type) + (capture === true ? '#c' : '#b')
    if (!listeners.has(key)) listeners.set(key, [])
    listeners.get(key).push(handler)
  }
  target.removeEventListener = (type, handler, capture) => {
    const key = String(type) + (capture === true ? '#c' : '#b')
    const list = listeners.get(key)
    if (!list) return
    const index = list.indexOf(handler)
    if (index !== -1) list.splice(index, 1)
  }
  return target
}

function listenerCount(target) {
  let total = 0
  for (const list of target.__listeners.values()) total += list.length
  return total
}

function buildPath(target) {
  const path = []
  let node = target
  let guard = 0
  while (node && guard < 200) {
    path.push(node)
    if (node.nodeType === 9) break
    node = node.parentNode || null
    guard += 1
  }
  // path currently target..document (or root)
  if (path[path.length - 1] && path[path.length - 1].nodeType === 9) {
    path.push(path[path.length - 1].defaultView || null)
  }
  return path.filter(Boolean)
}

function dispatch(target, event) {
  event.target = event.target || target
  event._path = buildPath(event.target)
  const path = event._path
  // capture: window -> target
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (event._stopped) break
    invoke(path[index], event, true)
  }
  // bubble: target -> window
  for (let index = 0; index < path.length; index += 1) {
    if (event._stopped) break
    invoke(path[index], event, false)
  }
  return !event.defaultPrevented
}

function invoke(node, event, capture) {
  if (!node || !node.__listeners) return
  const key = event.type + (capture ? '#c' : '#b')
  const list = node.__listeners.get(key)
  if (!list || list.length === 0) return
  const previous = event.currentTarget
  event.currentTarget = node
  for (const handler of list.slice()) {
    try {
      handler(event)
    } catch (error) {
      failures += 1
      process.stderr.write('not ok - listener threw during ' + event.type + ': ' + (error && error.stack ? error.stack : error) + '\n')
    }
    if (event._stopped) break
  }
  event.currentTarget = previous
}

function splitTopLevel(text, separator) {
  const parts = []
  let depth = 0
  let quote = ''
  let buffer = ''
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quote) {
      buffer += character
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      buffer += character
      continue
    }
    if (character === '[' || character === '(') depth += 1
    if (character === ']' || character === ')') depth -= 1
    if (depth === 0 && character === separator) {
      parts.push(buffer)
      buffer = ''
      continue
    }
    buffer += character
  }
  parts.push(buffer)
  return parts
}

function matchesCompound(element, compound) {
  if (!element || element.nodeType !== 1) return false
  let rest = compound.trim()
  if (rest === '') return false
  const tagMatch = /^([a-zA-Z][\w-]*|\*)/.exec(rest)
  if (tagMatch) {
    if (tagMatch[1] !== '*' && element.localName !== tagMatch[1].toLowerCase()) return false
    rest = rest.slice(tagMatch[0].length)
  }
  while (rest.length > 0) {
    if (rest[0] === '.') {
      const match = /^\.([\w-]+)/.exec(rest)
      if (!match) return false
      if (!element.classList.contains(match[1])) return false
      rest = rest.slice(match[0].length)
      continue
    }
    if (rest[0] === '#') {
      const match = /^#([\w-]+)/.exec(rest)
      if (!match) return false
      if (element.id !== match[1]) return false
      rest = rest.slice(match[0].length)
      continue
    }
    if (rest[0] === '[') {
      const match = /^\[\s*([\w:.-]+)(?:\s*([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/.exec(rest)
      if (!match) return false
      const name = match[1]
      const operator = match[2]
      const expected = match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : match[5]
      const actual = element.getAttribute(name)
      if (actual === null) return false
      if (operator === '=' && actual !== expected) return false
      if (operator === '*=' && actual.indexOf(expected) === -1) return false
      if (operator === '^=' && !actual.startsWith(expected)) return false
      if (operator === '$=' && !actual.endsWith(expected)) return false
      if (operator === '~=' && actual.split(/\s+/).indexOf(expected) === -1) return false
      rest = rest.slice(match[0].length)
      continue
    }
    if (rest[0] === ':') {
      const nthOfType = /^:nth-of-type\((\d+)\)/.exec(rest)
      if (nthOfType) {
        const parent = element.parentNode
        if (!parent) return false
        const peers = Array.from(parent.children).filter((sibling) => sibling.localName === element.localName)
        if (peers.indexOf(element) !== Number(nthOfType[1]) - 1) return false
        rest = rest.slice(nthOfType[0].length)
        continue
      }
      const nthChild = /^:nth-child\((\d+)\)/.exec(rest)
      if (nthChild) {
        const parent = element.parentNode
        if (!parent) return false
        const peers = Array.from(parent.children)
        if (peers.indexOf(element) !== Number(nthChild[1]) - 1) return false
        rest = rest.slice(nthChild[0].length)
        continue
      }
      if (rest.startsWith(':first-child')) {
        const parent = element.parentNode
        if (!parent || parent.children[0] !== element) return false
        rest = rest.slice(':first-child'.length)
        continue
      }
      if (rest.startsWith(':last-child')) {
        const parent = element.parentNode
        if (!parent || parent.children[parent.children.length - 1] !== element) return false
        rest = rest.slice(':last-child'.length)
        continue
      }
      return false
    }
    return false
  }
  return true
}

function matchesDescendantSequence(element, segment) {
  // Split on whitespace outside brackets/quotes so `[aria-label="Move toolbar"]`
  // stays one compound instead of becoming a descendant chain.
  const tokens = splitTopLevel(segment.trim(), ' ').map((token) => token.trim()).filter(Boolean)
  if (tokens.length === 0) return false
  if (!matchesCompound(element, tokens[tokens.length - 1])) return false
  let current = element.parentElement
  for (let index = tokens.length - 2; index >= 0; index -= 1) {
    let matched = false
    while (current) {
      if (matchesCompound(current, tokens[index])) {
        matched = true
        current = current.parentElement
        break
      }
      current = current.parentElement
    }
    if (!matched) return false
  }
  return true
}

function matchesSelector(element, selector) {
  const alternatives = splitTopLevel(selector, ',')
  for (const alternative of alternatives) {
    const text = alternative.trim()
    if (text === '') continue
    const segments = text.split('>').map((segment) => segment.trim()).filter(Boolean)
    if (segments.length === 0) continue
    if (!matchesDescendantSequence(element, segments[segments.length - 1])) continue
    let current = element
    let matched = true
    for (let index = segments.length - 2; index >= 0; index -= 1) {
      const tokens = segments[index].split(/\s+/).filter(Boolean)
      const direct = tokens[tokens.length - 1]
      const parent = current.parentElement
      if (!parent || !matchesCompound(parent, direct)) {
        matched = false
        break
      }
      let ancestor = parent.parentElement
      for (let tokenIndex = tokens.length - 2; tokenIndex >= 0; tokenIndex -= 1) {
        let found = false
        while (ancestor) {
          if (matchesCompound(ancestor, tokens[tokenIndex])) {
            found = true
            ancestor = ancestor.parentElement
            break
          }
          ancestor = ancestor.parentElement
        }
        if (!found) {
          matched = false
          break
        }
      }
      if (!matched) break
      current = parent
    }
    if (matched) return true
  }
  return false
}

function collectElements(root) {
  const out = []
  function walk(node) {
    for (const child of node.children) {
      out.push(child)
      walk(child)
    }
  }
  walk(root)
  return out
}

function classListFor(element) {
  const api = {
    contains(name) {
      return (element.getAttribute('class') || '').split(/\s+/).filter(Boolean).indexOf(name) !== -1
    },
    add(name) {
      const current = api.values()
      if (current.indexOf(name) === -1) current.push(name)
      element.setAttribute('class', current.join(' '))
    },
    remove(name) {
      const current = api.values().filter((value) => value !== name)
      element.setAttribute('class', current.join(' '))
    },
    toggle(name, force) {
      const has = api.contains(name)
      const next = force === undefined ? !has : force === true
      if (next) api.add(name)
      else api.remove(name)
      return next
    },
    values() {
      return (element.getAttribute('class') || '').split(/\s+/).filter(Boolean)
    },
  }
  return api
}

class FakeElement {
  constructor(tag, document) {
    this.nodeType = 1
    this.tagName = String(tag).toUpperCase()
    this.localName = String(tag).toLowerCase()
    this.ownerDocument = document
    this.parentNode = null
    this.childNodes = []
    this.attributes = []
    this.style = new FakeStyle()
    this.value = ''
    this.__rect = { x: 0, y: 0, width: 100, height: 40 }
    eventTargetMixin(this)
    this.classList = classListFor(this)
  }
  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1)
  }
  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null
  }
  get id() {
    return this.getAttribute('id') || ''
  }
  set id(value) {
    this.setAttribute('id', value)
  }
  get className() {
    return this.getAttribute('class') || ''
  }
  set className(value) {
    this.setAttribute('class', value)
  }
  get isConnected() {
    let node = this
    while (node) {
      if (node === this.ownerDocument.documentElement) return true
      node = node.parentNode
    }
    return false
  }
  appendChild(node) {
    if (!node) return node
    if (node.parentNode) node.parentNode.removeChild(node)
    node.parentNode = this
    this.childNodes.push(node)
    return node
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node)
    if (index !== -1) this.childNodes.splice(index, 1)
    node.parentNode = null
    return node
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this)
  }
  insertBefore(node, reference) {
    if (!node) return node
    if (node.parentNode) node.parentNode.removeChild(node)
    const index = reference ? this.childNodes.indexOf(reference) : -1
    if (index === -1) this.childNodes.push(node)
    else this.childNodes.splice(index, 0, node)
    node.parentNode = this
    return node
  }
  get nextElementSibling() {
    const parent = this.parentNode
    if (!parent) return null
    const siblings = parent.children
    const index = siblings.indexOf(this)
    return index >= 0 ? siblings[index + 1] || null : null
  }
  getAttribute(name) {
    const key = String(name).toLowerCase()
    for (const attribute of this.attributes) {
      if (attribute.name === key) return attribute.value
    }
    return null
  }
  setAttribute(name, value) {
    const key = String(name).toLowerCase()
    const text = String(value)
    for (const attribute of this.attributes) {
      if (attribute.name === key) {
        attribute.value = text
        return
      }
    }
    this.attributes.push({ name: key, value: text })
  }
  removeAttribute(name) {
    const key = String(name).toLowerCase()
    this.attributes = this.attributes.filter((attribute) => attribute.name !== key)
  }
  hasAttribute(name) {
    return this.getAttribute(name) !== null
  }
  get textContent() {
    return this.childNodes.map((node) => node.textContent || '').join('')
  }
  set textContent(value) {
    this.childNodes = []
    const text = String(value)
    if (text !== '') this.appendChild(new FakeTextNode(text))
  }
  get innerHTML() {
    return this.textContent
  }
  set innerHTML(value) {
    this.textContent = value
  }
  get innerText() {
    return this.textContent
  }
  set innerText(value) {
    this.textContent = value
  }
  get outerHTML() {
    const attributes = this.attributes
      .map((attribute) => ' ' + attribute.name + '="' + attribute.value + '"')
      .join('')
    return '<' + this.localName + attributes + '>' + this.textContent + '</' + this.localName + '>'
  }
  getBoundingClientRect() {
    const rect = this.__rect
    return {
      x: rect.x,
      y: rect.y,
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
    }
  }
  scrollIntoView() {}
  focus() {}
  setSelectionRange() {}
  getRootNode() {
    let node = this
    while (node.parentNode) node = node.parentNode
    return node
  }
  contains(node) {
    let current = node
    while (current) {
      if (current === this) return true
      current = current.parentNode
    }
    return false
  }
  closest(selector) {
    let node = this
    while (node) {
      if (node.nodeType === 1 && matchesSelector(node, selector)) return node
      node = node.parentNode
    }
    return null
  }
  matches(selector) {
    return matchesSelector(this, selector)
  }
  querySelectorAll(selector) {
    return collectElements(this).filter((element) => matchesSelector(element, selector))
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])
const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

function decodeEntities(text) {
  return String(text).replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, name) => {
    const key = String(name).toLowerCase()
    if (key.charAt(0) === '#') {
      const code = key.charAt(1) === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10)
      return isFinite(code) ? String.fromCharCode(code) : match
    }
    return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, key) ? HTML_ENTITIES[key] : match
  })
}

/**
 * Minimal inert HTML fragment parser backing `<template>.innerHTML` in the shim:
 * enough for tag/attribute/text/void-element markup used by insert tests.
 */
function parseHTMLFragment(html, document) {
  const tokens = String(html).match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]*>|[^<]+/g) || []
  const roots = []
  const stack = []
  const push = (node) => {
    const parent = stack[stack.length - 1]
    if (parent) parent.appendChild(node)
    else roots.push(node)
  }
  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<!')) continue
    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim().toLowerCase()
      while (stack.length > 0) {
        if (stack.pop().localName === name) break
      }
      continue
    }
    if (token.startsWith('<')) {
      const selfClosing = /\/>$/.test(token)
      const inner = token.slice(1, selfClosing ? -2 : -1)
      const tagMatch = /^([a-zA-Z][\w-]*)/.exec(inner)
      if (!tagMatch) continue
      const node = new FakeElement(tagMatch[1].toLowerCase(), document)
      const attributes = inner.slice(tagMatch[0].length)
      const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
      let match
      while ((match = attributePattern.exec(attributes))) {
        const value = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : ''
        node.setAttribute(match[1], decodeEntities(value))
      }
      push(node)
      if (!selfClosing && !VOID_TAGS.has(node.localName)) stack.push(node)
      continue
    }
    push(new FakeTextNode(decodeEntities(token)))
  }
  return roots
}

class FakeTemplateElement extends FakeElement {
  constructor(tag, document) {
    super(tag, document)
    this.content = new FakeDocumentFragment(document)
  }
  get innerHTML() {
    return this.content.childNodes.map((node) => (node.nodeType === 1 ? node.outerHTML : node.textContent)).join('')
  }
  set innerHTML(value) {
    for (const node of this.content.childNodes.slice()) this.content.removeChild(node)
    for (const node of parseHTMLFragment(value, this.ownerDocument)) this.content.appendChild(node)
  }
}

class FakeDocument {
  constructor() {
    eventTargetMixin(this)
    this.nodeType = 9
    this.title = 'Demo page'
    this.readyState = 'complete'
    this.styleSheets = []
    this.documentElement = new FakeElement('html', this)
    this.documentElement.parentNode = this
    const head = new FakeElement('head', this)
    const body = new FakeElement('body', this)
    this.documentElement.appendChild(head)
    this.documentElement.appendChild(body)
    this.head = head
    this.body = body
    this.defaultView = null
    this.__all = [this.documentElement, head, body]
  }
  createElement(tag) {
    const name = String(tag).toLowerCase()
    const element = name === 'template' ? new FakeTemplateElement(name, this) : new FakeElement(name, this)
    this.__all.push(element)
    return element
  }
  createTextNode(value) {
    return new FakeTextNode(value)
  }
  getElementById(id) {
    return collectElements(this.documentElement).find((element) => element.id === id) || null
  }
  contains(node) {
    return this.documentElement.contains(node)
  }
  querySelectorAll(selector) {
    const all = [this.documentElement].concat(collectElements(this.documentElement))
    return all.filter((element) => matchesSelector(element, selector))
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
  elementFromPoint(x, y) {
    const candidates = collectElements(this.documentElement).filter((element) => {
      const rect = element.getBoundingClientRect()
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    })
    return candidates[candidates.length - 1] || null
  }
  dispatchEvent(event) {
    return dispatch(this, event)
  }
}

const defaultsByTag = {
  div: 'block', section: 'block', header: 'block', footer: 'block', main: 'block',
  p: 'block', h1: 'block', h2: 'block', h3: 'block', ul: 'block', li: 'list-item',
  span: 'inline', a: 'inline', strong: 'inline', em: 'inline',
  input: 'inline-block', textarea: 'inline-block', button: 'inline-block',
}

function defaultComputedValue(element, property) {
  const rect = element.__rect || { width: 0, height: 0 }
  switch (property) {
    case 'display':
      return defaultsByTag[element.localName] || 'inline'
    case 'position':
      return 'static'
    case 'width':
    case 'height':
      return (property === 'width' ? rect.width : rect.height) + 'px'
    case 'color':
      return 'rgb(0, 0, 0)'
    case 'background-color':
    case 'background':
      return 'rgba(0, 0, 0, 0)'
    case 'font-size':
      return '16px'
    case 'font-family':
      return 'sans-serif'
    case 'font-weight':
      return '400'
    case 'line-height':
      return 'normal'
    case 'border-radius':
      return '0px'
    case 'border':
      return '0px none rgb(0, 0, 0)'
    case 'opacity':
      return '1'
    case 'z-index':
      return 'auto'
    case 'overflow':
      return 'visible'
    case 'margin':
    case 'padding':
    case 'margin-top':
    case 'margin-right':
    case 'margin-bottom':
    case 'margin-left':
    case 'padding-top':
    case 'padding-right':
    case 'padding-bottom':
    case 'padding-left':
    case 'gap':
    case 'letter-spacing':
      return property === 'letter-spacing' || property === 'gap' ? 'normal' : '0px'
    case 'top':
    case 'right':
    case 'bottom':
    case 'left':
      return 'auto'
    case 'min-width':
    case 'min-height':
      return 'auto'
    case 'max-width':
    case 'max-height':
      return 'none'
    case 'flex-direction':
      return 'row'
    case 'justify-content':
    case 'align-items':
      return 'normal'
    case 'box-shadow':
    case 'transform':
    case 'background-image':
      return 'none'
    case 'visibility':
      return 'visible'
    case 'text-align':
      return 'start'
    default:
      return ''
  }
}

function getComputedStyle(element) {
  return {
    getPropertyValue(property) {
      const name = String(property).toLowerCase()
      const inline = element.style.getPropertyValue(name)
      if (inline !== '') return inline
      return defaultComputedValue(element, name)
    },
  }
}

/* ---------------------------------------------------------------- sandbox */

const document = new FakeDocument()
const rafQueue = []
let rafSeq = 0

function requestAnimationFrame(callback) {
  rafSeq += 1
  rafQueue.push({ id: rafSeq, callback })
  return rafSeq
}

function cancelAnimationFrame(id) {
  const index = rafQueue.findIndex((entry) => entry.id === id)
  if (index !== -1) rafQueue.splice(index, 1)
}

function flushFrames(rounds = 6) {
  let remaining = rounds
  while (rafQueue.length > 0 && remaining > 0) {
    remaining -= 1
    const batch = rafQueue.splice(0, rafQueue.length)
    for (const entry of batch) entry.callback(Date.now())
  }
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback
  }
  observe() {}
  disconnect() {}
}

const history = {
  state: null,
  pushState(state, title, url) {
    this.state = state
    if (url) location.href = new URL(url, location.href).href
  },
  replaceState(state, title, url) {
    this.state = state
    if (url) location.href = new URL(url, location.href).href
  },
}

const location = { href: 'http://127.0.0.1:4173/index.html', origin: 'http://127.0.0.1:4173' }


const themeMedia = {
  media: '(prefers-color-scheme: dark)',
  matches: false,
  _listeners: new Set(),
  addEventListener(type, handler) {
    if (type === 'change') this._listeners.add(handler)
  },
  removeEventListener(type, handler) {
    if (type === 'change') this._listeners.delete(handler)
  },
  addListener(handler) {
    this._listeners.add(handler)
  },
  removeListener(handler) {
    this._listeners.delete(handler)
  },
  setMatches(value) {
    this.matches = value === true
    for (const handler of Array.from(this._listeners)) handler({ matches: this.matches })
  },
  listenerCount() {
    return this._listeners.size
  },
}
function matchMedia(query) {
  return themeMedia
}

const sandbox = {
  document,
  location,
  history,
  innerWidth: 1280,
  innerHeight: 800,
  devicePixelRatio: 1,
  CSS: { escape: (value) => String(value) },
  matchMedia,
  getComputedStyle,
  requestAnimationFrame,
  cancelAnimationFrame,
  setTimeout,
  clearTimeout,
  MutationObserver: FakeMutationObserver,
  console,
  URL,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Map,
  Set,
  Promise,
  Error,
  isFinite,
  parseInt,
}
sandbox.window = sandbox
sandbox.self = sandbox
sandbox.globalThis = sandbox
eventTargetMixin(sandbox)
document.defaultView = sandbox

vm.createContext(sandbox)

/* --------------------------------------------------------------- utilities */

function element(tag, options) {
  const created = document.createElement(tag)
  const settings = options || {}
  if (settings.id) created.setAttribute('id', settings.id)
  if (settings.className) created.setAttribute('class', settings.className)
  if (settings.text !== undefined) created.textContent = settings.text
  if (settings.rect) created.__rect = settings.rect
  if (settings.attrs) {
    for (const [name, value] of Object.entries(settings.attrs)) created.setAttribute(name, value)
  }
  const parent = settings.parent || document.body
  if (parent) parent.appendChild(created)
  return created
}

function flushEvents(runtime) {
  return runtime.drainEvents()
}

/* ------------------------------------------------------------------- tests */

async function run() {
  const source = await readFile(RUNTIME_PATH, 'utf8')

  section('load')
  const status = vm.runInContext(source, sandbox, { filename: 'runtime.js' })
  eq("executeJavaScript result is 'ok'", status, 'ok')
  const runtime = sandbox.__DSH_NUDGE__
  ok('namespace exposed', !!runtime)

  section('api surface')
  eq('version is 1', runtime.version, 1)
  const methods = [
    'setMode', 'setSelection', 'clearSelection', 'setSelectionByPath', 'getDescriptor',
    'getAncestry', 'drainEvents', 'getState', 'applyStyle', 'applyText', 'applyAttr',
    'reapply', 'applyInsert', 'applyMoveElement', 'setLocale', 'setTheme', 'setBottomInset', 'setBarHosted', 'getBarState',
    'toggleMarkers', 'discardAnnotations', 'sendAnnotations', 'exitAnnotate', 'locateLastAnnotation', 'locate', 'openAnnotationEditor',
    'updateAnnotation', 'removeAnnotation', 'reinit', 'destroy',
  ]
  for (const method of methods) {
    ok('api.' + method + ' is a function', typeof runtime[method] === 'function')
  }

  section('page info and state')
  const info = flushEvents(runtime)
  ok('initial page-info queued', info.some((event) => event.type === 'page-info'))
  const pageInfo = info.find((event) => event.type === 'page-info')
  eq('page-info url', pageInfo.url, 'http://127.0.0.1:4173/index.html')
  eq('page-info title', pageInfo.title, 'Demo page')
  eq('drain clears queue', flushEvents(runtime).length, 0)
  const state0 = runtime.getState()
  eq('default mode browse', state0.mode, 'browse')
  eq('state version', state0.version, 1)
  eq('no selection initially', state0.selection, null)
  eq('no annotations initially', state0.annotations.length, 0)

  section('annotation bar palette tokens')
  eq('palette: theme media starts light', themeMedia.matches, false)
  runtime.setMode('annotate')
  runtime.setSelection('body')
  flushFrames()
  const barRoot = document.querySelector('[data-dsh-nudge="bar"]')
  ok('palette: annotate bar rendered', !!barRoot)
  const barButtons = barRoot ? barRoot.querySelectorAll('button') : []
  eq('palette: bar keeps its button set', barButtons.length, 6)
  const locateButton = barButtons[1]
  const sendButton = barButtons[4]
  const locateGlyph = locateButton && locateButton.childNodes ? locateButton.childNodes[0] : null
  ok('palette: locate button carries an svg glyph', !!locateGlyph && String(locateGlyph.tagName).toLowerCase() === 'svg')
  eq('palette: light bar uses the light surface token', barRoot && barRoot.style.getPropertyValue('background'), '#ffffff')
  eq('palette: light bar uses the light border token', barRoot && barRoot.style.getPropertyValue('border-color'), 'rgba(15,17,21,0.12)')
  eq('palette: light bar uses the light text token', barRoot && barRoot.style.getPropertyValue('color'), '#0f1115')
  eq('palette: disabled send uses the light disabled fill', sendButton && sendButton.style.getPropertyValue('background'), '#e6ecf5')
  eq('palette: disabled send keeps a readable ink', sendButton && sendButton.style.getPropertyValue('color'), '#4a5563')
  eq('palette: disabled send is not opacity-faded', sendButton && sendButton.style.getPropertyValue('opacity'), '')
  eq('palette: disabled send reports aria-disabled', sendButton && sendButton.getAttribute('aria-disabled'), 'true')
  ok(
    'palette: disabled send fill differs from its ink',
    !!sendButton && sendButton.style.getPropertyValue('background') !== sendButton.style.getPropertyValue('color'),
  )
  dispatch(locateButton, new FakeEvent('mouseenter', { target: locateButton }))
  eq('palette: hovered icon uses the light text token', locateButton && locateButton.style.getPropertyValue('color'), '#0f1115')
  eq('palette: hovered icon uses the light hover fill', locateButton && locateButton.style.getPropertyValue('background'), 'rgba(15,17,21,0.06)')
  dispatch(locateButton, new FakeEvent('mouseleave', { target: locateButton }))
  eq('palette: resting icon uses the muted token', locateButton && locateButton.style.getPropertyValue('color'), '#61666b')

  // Until the host publishes an explicit flag, the OS preference drives the palette.
  themeMedia.setMatches(true)
  eq('palette: OS dark preference repaints the bar dark', barRoot && barRoot.style.getPropertyValue('background'), '#262626')
  eq('palette: dark bar uses the dark border token', barRoot && barRoot.style.getPropertyValue('border-color'), 'rgba(255,255,255,0.10)')
  eq('palette: dark bar uses the dark text token', barRoot && barRoot.style.getPropertyValue('color'), '#f5f5f5')
  eq('palette: dark disabled send uses the dark disabled fill', sendButton && sendButton.style.getPropertyValue('background'), '#39424f')
  eq('palette: dark disabled send keeps a readable ink', sendButton && sendButton.style.getPropertyValue('color'), '#c3ccd8')
  themeMedia.setMatches(false)
  eq('palette: light preference restores the light bar', barRoot && barRoot.style.getPropertyValue('background'), '#ffffff')

  // The client publishes an explicit isDark flag; it must win over the OS hint.
  runtime.setTheme({ isDark: true })
  flushFrames()
  eq('palette: explicit dark host flag paints the dark bar', barRoot && barRoot.style.getPropertyValue('background'), '#262626')
  eq('palette: explicit dark bar text token', barRoot && barRoot.style.getPropertyValue('color'), '#f5f5f5')
  dispatch(locateButton, new FakeEvent('mouseenter', { target: locateButton }))
  eq('palette: dark hovered icon uses the dark text token', locateButton && locateButton.style.getPropertyValue('color'), '#f5f5f5')
  dispatch(locateButton, new FakeEvent('mouseleave', { target: locateButton }))
  runtime.setTheme({ isDark: false })
  flushFrames()
  eq('palette: explicit light flag restores the light bar', barRoot && barRoot.style.getPropertyValue('background'), '#ffffff')
  runtime.clearSelection()
  runtime.setMode('browse')
  flushFrames()

  section('mode switching')
  eq('setMode annotate', runtime.setMode('annotate'), true)
  eq('mode is annotate', runtime.getState().mode, 'annotate')
  eq('setMode edit', runtime.setMode('edit'), true)
  eq('mode is edit', runtime.getState().mode, 'edit')
  eq('setMode rejects unknown mode', runtime.setMode('destroy'), false)
  eq('setMode browse', runtime.setMode('browse'), true)

  section('fixtures')
  const hero = element('section', {
    id: 'hero',
    className: 'hero card',
    rect: { x: 20, y: 40, width: 600, height: 240 },
  })
  hero.setAttribute('data-source', 'demo/index.html:30')
  const title = element('h2', { id: 'title', text: '智选汽车', rect: { x: 24, y: 48, width: 240, height: 32 }, parent: hero })
  const sub = element('p', { className: 'sub', text: '一张会说话的卡片', rect: { x: 24, y: 88, width: 300, height: 24 }, parent: hero })
  const repeated = []
  for (let index = 0; index < 3; index += 1) {
    repeated.push(
      element('div', {
        className: 'item',
        rect: { x: 20, y: 300 + index * 50, width: 200, height: 40 },
        parent: document.body,
      }),
    )
  }
  const textHost = element('div', { id: 'text-host', parent: document.body, rect: { x: 20, y: 500, width: 300, height: 40 } })
  textHost.appendChild(document.createTextNode('Hello '))
  const strongChild = element('strong', { text: 'child', parent: textHost })
  textHost.appendChild(document.createTextNode(' world'))
  const noTextHost = element('div', { id: 'no-text', parent: document.body })
  element('span', { text: 'only child', parent: noTextHost })
  const link = element('a', { id: 'link', attrs: { href: 'https://example.com/a' }, parent: document.body })
  const button = element('button', { id: 'button', text: '按钮', parent: document.body, rect: { x: 400, y: 500, width: 120, height: 36 } })
  const destroyable = element('div', { id: 'destroyable', parent: document.body, rect: { x: 600, y: 500, width: 80, height: 30 } })
  const script = element('script', { id: 'script', parent: document.head })
  const stylesheet = element('link', { id: 'stylesheet', parent: document.head })
  const image = element('img', { id: 'image', parent: document.body })
  const styled = element('div', { id: 'styled', parent: document.body, rect: { x: 20, y: 600, width: 100, height: 20 } })
  styled.style.setProperty('color', 'blue')

  section('descriptors')
  ok('setSelection #hero returns a descriptor', !!runtime.setSelection('#hero') && runtime.getState().selection.id === 'hero')
  const heroState = runtime.getState()
  ok('selection present', !!heroState.selection)
  eq('selected tag', heroState.selection.tag, 'section')
  eq('selected id', heroState.selection.id, 'hero')
  deepEq('selected classes', heroState.selection.classes.slice(0, 2), ['hero', 'card'])
  deepEq('rect x/y/width/height', heroState.selection.rect, { x: 20, y: 40, width: 600, height: 240 })
  eq('descriptor selector resolves uniquely', document.querySelector(heroState.selection.selector), hero)
  ok('descriptor has styles', !!heroState.selection.styles)
  eq('styles display', heroState.selection.styles.display, 'block')
  for (const key of ['top', 'right', 'bottom', 'left', 'marginTop', 'paddingLeft', 'gap', 'minWidth', 'maxWidth', 'flexDirection', 'justifyContent', 'alignItems', 'letterSpacing', 'boxShadow', 'transform', 'visibility', 'backgroundImage']) {
    ok('styles includes ' + key, Object.prototype.hasOwnProperty.call(heroState.selection.styles, key))
  }
  ok('sourceHints file', !!heroState.selection.sourceHints && heroState.selection.sourceHints.file === 'demo/index.html')
  eq('sourceHints line', heroState.selection.sourceHints.line, 30)
  ok('ancestry bounded', heroState.selection.ancestry.length <= 6)
  eq('directText', runtime.getDescriptor('#title').directText, '智选汽车')
  eq('inlineStyles camelCase', runtime.getDescriptor('#styled').inlineStyles.color, 'blue')
  eq('getDescriptor missing returns null', runtime.getDescriptor('.does-not-exist'), null)
  eq('setSelection missing selector returns null', runtime.setSelection('.does-not-exist'), null)
  eq('setSelection null does not throw', runtime.setSelection(null), null)

  section('paths and ancestry')
  const heroDescriptor = runtime.getDescriptor('#hero')
  ok('path is an array', Array.isArray(heroDescriptor.path))
  ok('setSelectionByPath round-trips', !!runtime.setSelectionByPath(heroDescriptor.path))
  eq('setSelectionByPath selected same element', runtime.getState().selection.id, 'hero')
  const ancestry = runtime.getAncestry('#title', 3, 2)
  ok('getAncestry returns a tree', !!ancestry && typeof ancestry.tag === 'string')
  ok('getAncestry root is an ancestor', ancestry.tag === 'html' || ancestry.tag === 'body' || ancestry.tag === 'section')
  function findTreeSelector(node, selector) {
    if (!node) return null
    if (node.selector === selector) return node
    for (const child of node.children || []) {
      const found = findTreeSelector(child, selector)
      if (found) return found
    }
    return null
  }
  const targetNode = findTreeSelector(ancestry, runtime.getDescriptor('#title').selector)
  ok('getAncestry targets the element selector', !!targetNode, JSON.stringify(ancestry))
  ok('getAncestry target has children', !!targetNode && Array.isArray(targetNode.children))
  const defaultAncestry = runtime.getAncestry('#title')
  ok('getAncestry defaults up/down (up=3)', !!defaultAncestry && defaultAncestry.tag === 'html', JSON.stringify(defaultAncestry && defaultAncestry.tag))

  section('selector uniqueness')
  for (let index = 0; index < repeated.length; index += 1) {
    runtime.setSelectionByPath((function findPath(node) {
      const path = []
      let current = node
      while (current && current !== document.documentElement) {
        const parent = current.parentElement
        path.unshift(Array.from(parent.children).indexOf(current))
        current = parent
      }
      return path
    })(repeated[index]))
    const descriptor = runtime.getState().selection
    ok('repeated item ' + index + ' selector unique', !!descriptor && document.querySelector(descriptor.selector) === repeated[index], descriptor && descriptor.selector)
  }
  const selectors = new Set()
  for (const item of repeated) {
    runtime.setSelectionByPath((function findPath(node) {
      const path = []
      let current = node
      while (current && current !== document.documentElement) {
        const parent = current.parentElement
        path.unshift(Array.from(parent.children).indexOf(current))
        current = parent
      }
      return path
    })(item))
    selectors.add(runtime.getState().selection.selector)
  }
  eq('repeated items produce distinct selectors', selectors.size, 3)

  section('applyStyle')
  const styleResult = runtime.applyStyle('#hero', 'backgroundColor', '#ff0000')
  eq('applyStyle ok', styleResult.ok, true)
  eq('applyStyle applied', styleResult.applied, true)
  eq('applyStyle before is transparent', styleResult.before, 'rgba(0, 0, 0, 0)')
  eq('applyStyle after is the inline value', styleResult.after, '#ff0000')
  eq('camelCase property normalized', hero.style.getPropertyValue('background-color'), '#ff0000')
  eq('kebabCase property works', runtime.applyStyle('#hero', 'font-size', '20px').applied, true)
  eq('computed font-size updated', runtime.getDescriptor('#hero').styles.fontSize, '20px')
  const badProperty = runtime.applyStyle('#hero', 'not a property!', 'x')
  eq('invalid property rejected', badProperty.ok, false)
  eq('invalid property reason', badProperty.reason, 'invalid-property')
  const badValue = runtime.applyStyle('#hero', 'color', 'not-a-color')
  eq('invalid value rejected', badValue.ok, false)
  eq('invalid value reason', badValue.reason, 'invalid-value')
  const dangerous = runtime.applyStyle('#hero', 'color', 'red;display:none')
  eq('dangerous value rejected', dangerous.ok, false)
  const removeResult = runtime.applyStyle('#hero', 'backgroundColor', '')
  eq('empty value removes declaration', removeResult.ok, true)
  eq('removed declaration leaves empty inline value', hero.style.getPropertyValue('background-color'), '')
  eq('removal reports applied false', removeResult.applied, false)
  eq('remove reports no inline value', runtime.applyStyle('#hero', 'font-size', '') .applied, false)
  eq('applyStyle missing selector', runtime.applyStyle('#missing', 'color', 'red').ok, false)

  section('applyText')
  const textResult = runtime.applyText('#text-host', 'Hi ')
  eq('applyText ok', textResult.ok, true)
  eq('applyText before', textResult.before, 'Hello child world')
  eq('applyText after', textResult.after, 'Hi child world')
  ok('child element preserved', textHost.childNodes.indexOf(strongChild) !== -1)
  eq('child text preserved', strongChild.textContent, 'child')
  eq('text node mutated', textHost.childNodes[0].nodeValue, 'Hi ')
  eq('applyText idempotent', runtime.applyText('#text-host', 'Hi ').ok, true)
  const noTextResult = runtime.applyText('#no-text', 'x')
  eq('applyText without direct text fails', noTextResult.ok, false)
  eq('no-text-node reason', noTextResult.reason, 'no-text-node')
  eq('no-text element keeps its child', noTextHost.children.length, 1)
  eq('applyText missing selector', runtime.applyText('#missing', 'x').ok, false)

  section('applyAttr')
  eq('applyAttr set title', runtime.applyAttr('#link', 'title', 'hello').after, 'hello')
  eq('applyAttr removes with empty value', runtime.applyAttr('#link', 'title', '').after, null)
  eq('forbidden onclick rejected', runtime.applyAttr('#button', 'onclick', 'alert(1)').ok, false)
  eq('forbidden onClick case-insensitive', runtime.applyAttr('#button', 'onClick', 'alert(1)').ok, false)
  eq('forbidden style rejected', runtime.applyAttr('#button', 'style', 'color:red').ok, false)
  eq('forbidden srcdoc rejected', runtime.applyAttr('#button', 'srcdoc', '<b>x</b>').ok, false)
  eq('unsafe javascript href rejected', runtime.applyAttr('#link', 'href', 'javascript:alert(1)').ok, false)
  eq('unsafe javascript href reason', runtime.applyAttr('#link', 'href', 'javascript:alert(1)').reason, 'unsafe-href')
  eq('unsafe data href rejected', runtime.applyAttr('#link', 'href', 'data:text/html,x').ok, false)
  eq('https href allowed', runtime.applyAttr('#link', 'href', 'https://example.com/b').ok, true)
  eq('mailto href allowed', runtime.applyAttr('#link', 'href', 'mailto:a@b.c').ok, true)
  eq('fragment href allowed', runtime.applyAttr('#link', 'href', '#section').ok, true)
  eq('relative href allowed', runtime.applyAttr('#link', 'href', './other.html').ok, true)
  eq('src on script rejected', runtime.applyAttr('#script', 'src', 'https://evil.test/x.js').ok, false)
  eq('href on link rejected', runtime.applyAttr('#stylesheet', 'href', 'https://evil.test/x.css').ok, false)
  eq('src on img allowed', runtime.applyAttr('#image', 'src', './photo.png').ok, true)
  eq('invalid attribute name rejected', runtime.applyAttr('#button', 'bad name', 'x').ok, false)

  section('reapply')
  const reapplyResult = runtime.reapply([
    { kind: 'style', selector: '#hero', property: 'color', value: 'rgb(1, 2, 3)' },
    { kind: 'text', selector: '#title', value: '新标题' },
    { kind: 'attr', selector: '#link', attrName: 'data-x', value: '1' },
    { kind: 'attr', selector: '#missing', attrName: 'data-x', value: '1' },
  ])
  eq('reapply applied count', reapplyResult.applied, 3)
  eq('reapply failed count', reapplyResult.failed, 1)
  eq('reapply style applied', runtime.getDescriptor('#hero').styles.color, 'rgb(1, 2, 3)')
  eq('reapply text applied', title.textContent, '新标题')
  eq('reapply attr applied', link.getAttribute('data-x'), '1')
  eq('reapply has result details', reapplyResult.results.length, 4)


  section('structure reapply')
  const moveHost = element('div', { id: 'move-host', parent: document.body })
  const moveA = element('span', { id: 'move-a', text: 'A', parent: moveHost })
  const moveB = element('span', { id: 'move-b', text: 'B', parent: moveHost })
  const moveTarget = element('div', { id: 'move-target', parent: document.body })
  element('p', { id: 'move-p', text: 'P', parent: moveTarget })
  const structureResult = runtime.reapply([
    { kind: 'move', selector: '#move-a', targetParentSelector: '#move-target', beforeSelector: null },
    { kind: 'remove', selector: '#move-b' },
  ])
  eq('structure reapply applied count', structureResult.applied, 2)
  deepEq('structure reapply result kinds', structureResult.results.map((entry) => entry.kind), ['move', 'remove'])
  eq('structure move re-parented the element', moveA.parentNode, moveTarget)
  eq('structure move appended as last child', moveA.nextElementSibling, null)
  eq('structure move kept the old parent', moveHost.children.length, 0)
  eq('structure remove detached the element', moveB.parentNode, null)
  const protectedStructure = runtime.reapply([
    { kind: 'remove', selector: 'body' },
    { kind: 'move', selector: '#move-target', targetParentSelector: 'body', beforeSelector: '#move-a' },
    { kind: 'move', selector: '#move-a', targetParentSelector: '#move-a' },
  ])
  eq('structure reapply refuses body removal', protectedStructure.results[0].reason, 'protected-element')
  eq('structure reapply protects body for move', protectedStructure.results[1].ok, false)
  eq('structure reapply rejects a self destination', protectedStructure.results[2].reason, 'invalid-move-target')


  section('edit-mode structure drag and delete')
  eq('edit mode for drag', runtime.setMode('edit'), true)
  const dragHost = element('div', { id: 'drag-host', parent: document.body, rect: { x: 0, y: 700, width: 400, height: 200 } })
  const dragOne = element('span', { id: 'drag-one', text: 'one', parent: dragHost, rect: { x: 0, y: 700, width: 100, height: 40 } })
  const dragTwo = element('span', { id: 'drag-two', text: 'two', parent: dragHost, rect: { x: 0, y: 740, width: 100, height: 40 } })
  flushEvents(runtime)
  dispatch(dragOne, new FakeEvent('mousedown', { target: dragOne, clientX: 10, clientY: 720 }))
  dispatch(dragOne, new FakeEvent('mousemove', { target: dragOne, clientX: 10, clientY: 780 }))
  flushFrames()
  const dropNode = document.querySelector('[data-dsh-nudge="drop"]')
  ok('structure drag shows a drop indicator', !!dropNode && dropNode.style.getPropertyValue('display') === 'block')
  dispatch(dragHost, new FakeEvent('mouseup', { target: dragHost, clientX: 10, clientY: 780 }))
  const dragEvents = flushEvents(runtime)
  const moveEvent = dragEvents.find((event) => event.type === 'design-structure' && event.op === 'move')
  ok('structure drag queues a move event', !!moveEvent)
  eq('structure move event source', moveEvent && moveEvent.selector, '#drag-one')
  eq('structure move event parent', moveEvent && moveEvent.targetParentSelector, '#drag-host')
  eq('structure move event anchor', moveEvent && moveEvent.beforeSelector, null)
  deepEq(
    'structure drag reordered the DOM',
    dragHost.children.map((child) => child.id),
    ['drag-two', 'drag-one'],
  )
  eq('structure drag selects the moved element', runtime.getState().selection.id, 'drag-one')
  eq('structure drop indicator hidden after drop', document.querySelector('[data-dsh-nudge="drop"]').style.getPropertyValue('display'), 'none')

  const keydownDelete = dispatch(document.body, new FakeEvent('keydown', { target: document.body, key: 'Delete' }))
  const deleteEvents = flushEvents(runtime)
  const removeEvent = deleteEvents.find((event) => event.type === 'design-structure' && event.op === 'remove')
  ok('Delete key queues a remove event', !!removeEvent)
  eq('Delete key source selector', removeEvent && removeEvent.selector, '#drag-one')
  eq('Delete key detached the element', dragOne.parentNode, null)
  deepEq(
    'Delete key keeps the sibling',
    dragHost.children.map((child) => child.id),
    ['drag-two'],
  )
  eq('Delete key clears the selection', runtime.getState().selection, null)
  eq('Delete keydown is consumed', keydownDelete, false)

  // A mode flip clears the post-drag click suppression from the mouseup above.
  runtime.setMode('browse')
  runtime.setMode('edit')
  dispatch(dragTwo, new FakeEvent('click', { target: dragTwo }))
  const cardRoot = document.querySelector('[data-dsh-nudge="design"]')
  ok('edit click opens the design card', !!cardRoot)
  const deleteButton = cardRoot && cardRoot.querySelector('button[aria-label="Delete element"]')
  ok('design card has a delete button', !!deleteButton)
  const dragHandle = cardRoot && cardRoot.querySelector('span[title]')
  ok('design card drag handle explains the drag', !!dragHandle && dragHandle.getAttribute('title') === 'Drag to reorder or nest')
  dispatch(deleteButton, new FakeEvent('click', { target: deleteButton }))
  const cardRemoveEvents = flushEvents(runtime).filter((event) => event.type === 'design-structure' && event.op === 'remove')
  eq('design card delete queues a remove event', cardRemoveEvents.length, 1)
  eq('design card delete removed the element', dragTwo.parentNode, null)
  eq('design card closes after delete', document.querySelector('[data-dsh-nudge="design"]'), null)
  eq('mode restored after structure tests', runtime.setMode('browse'), true)
  flushEvents(runtime)

  section('structure anchors (Anchor v1.5)')
  runtime.setMode('edit')
  const anchorHost = element('div', { id: 'anchor-host', parent: document.body })
  const anchorOne = element('p', { id: 'anchor-one', text: 'first card', parent: anchorHost })
  const anchorTwo = element('p', { id: 'anchor-two', text: 'second card', parent: anchorHost })
  const anchorThree = element('p', { id: 'anchor-three', text: 'third card', parent: anchorHost })
  const altHost = element('div', { id: 'alt-host', parent: document.body })
  // Away from (0,0,100,40), the shim's default rect, so elementFromPoint cannot
  // pick an overlay part or another default-sized element instead of this one.
  const altChild = element('em', { id: 'alt-child', text: 'alt', parent: altHost, rect: { x: 300, y: 10, width: 20, height: 20 } })
  flushEvents(runtime)

  runtime.setSelection('#anchor-one')
  dispatch(document.body, new FakeEvent('keydown', { target: document.body, key: 'Delete' }))
  const anchorRemoveEvent = flushEvents(runtime).find((event) => event.type === 'design-structure' && event.op === 'remove')
  ok('anchor remove payload queued', !!anchorRemoveEvent)
  eq('anchor remove textBefore is untruncated', anchorRemoveEvent && anchorRemoveEvent.textBefore, 'first card')
  eq('anchor remove keeps the legacy textSnippet', anchorRemoveEvent && anchorRemoveEvent.textSnippet, 'first card')
  eq('anchor remove outerHTMLTruncated flag', anchorRemoveEvent && anchorRemoveEvent.outerHTMLTruncated, false)
  eq('anchor remove outerHTML has no ellipsis', anchorRemoveEvent && anchorRemoveEvent.outerHTML, '<p id="anchor-one">first card</p>')
  ok('anchor remove elementKey shape', !!anchorRemoveEvent && /^el_\d+$/.test(anchorRemoveEvent.elementKey), anchorRemoveEvent && anchorRemoveEvent.elementKey)
  eq('anchor remove parentSelector', anchorRemoveEvent && anchorRemoveEvent.parentSelector, '#anchor-host')
  eq('anchor remove beforeSelector', anchorRemoveEvent && anchorRemoveEvent.beforeSelector, '#anchor-two')

  const hugeAnchor = element('div', { id: 'huge-anchor', text: 'x'.repeat(70000), parent: document.body })
  runtime.setSelection('#huge-anchor')
  dispatch(document.body, new FakeEvent('keydown', { target: document.body, key: 'Delete' }))
  const hugeEvent = flushEvents(runtime).find((event) => event.type === 'design-structure' && event.op === 'remove')
  ok('huge remove payload queued', !!hugeEvent)
  eq('huge remove outerHTMLTruncated flag', hugeEvent && hugeEvent.outerHTMLTruncated, true)
  eq('huge remove outerHTML is capped at 64KiB', hugeEvent && hugeEvent.outerHTML.length, 65536)
  ok('huge remove outerHTML has no ellipsis', !!hugeEvent && hugeEvent.outerHTML.indexOf('\u2026') === -1)
  eq('huge remove textBefore is capped at 2048', hugeEvent && hugeEvent.textBefore.length, 2048)
  eq('huge remove keeps the legacy textSnippet cap', hugeEvent && hugeEvent.textSnippet.length, 300)

  dispatch(anchorTwo, new FakeEvent('mousedown', { target: anchorTwo, clientX: 5, clientY: 5 }))
  dispatch(anchorTwo, new FakeEvent('mousemove', { target: anchorTwo, clientX: 305, clientY: 15 }))
  flushFrames()
  dispatch(document.body, new FakeEvent('mouseup', { target: document.body }))
  const anchorMoveEvent = flushEvents(runtime).find((event) => event.type === 'design-structure' && event.op === 'move')
  ok('anchor move payload queued', !!anchorMoveEvent)
  eq('anchor move textBefore', anchorMoveEvent && anchorMoveEvent.textBefore, 'second card')
  eq('anchor move outerHTMLTruncated flag', anchorMoveEvent && anchorMoveEvent.outerHTMLTruncated, false)
  ok('anchor move elementKey shape', !!anchorMoveEvent && /^el_\d+$/.test(anchorMoveEvent.elementKey), anchorMoveEvent && anchorMoveEvent.elementKey)
  eq('anchor move fromParentSelector is the original parent', anchorMoveEvent && anchorMoveEvent.fromParentSelector, '#anchor-host')
  eq('anchor move fromBeforeSelector is the original next sibling', anchorMoveEvent && anchorMoveEvent.fromBeforeSelector, '#anchor-three')
  eq('anchor move target parent', anchorMoveEvent && anchorMoveEvent.targetParentSelector, '#alt-host')
  eq('anchor move anchor selector', anchorMoveEvent && anchorMoveEvent.beforeSelector, '#alt-child')
  deepEq(
    'anchor move re-parented the element before the anchor',
    altHost.children.map((child) => child.id),
    ['anchor-two', 'alt-child'],
  )

  const moveBackResult = runtime.applyMoveElement({ elementKey: anchorMoveEvent && anchorMoveEvent.elementKey, parentSelector: '#anchor-host', beforeSelector: '#anchor-three' })
  eq('applyMoveElement ok', moveBackResult.ok, true)
  eq('applyMoveElement returns the current selector', moveBackResult.selector, '#anchor-two')
  eq('applyMoveElement re-parented the element', anchorTwo.parentNode, anchorHost)
  deepEq(
    'applyMoveElement restored the sibling order',
    anchorHost.children.map((child) => child.id),
    ['anchor-two', 'anchor-three'],
  )

  const insertHost = element('div', { id: 'insert-host', parent: document.body })
  element('span', { id: 'insert-anchor', text: 'anchor', parent: insertHost })
  const insertResult = runtime.applyInsert({ parentSelector: '#insert-host', beforeSelector: '#insert-anchor', html: '<b id="inserted-node">new</b>' })
  eq('applyInsert ok', insertResult.ok, true)
  eq('applyInsert returns the inserted selector', insertResult.selector, '#inserted-node')
  deepEq(
    'applyInsert inserted before the anchor',
    insertHost.children.map((child) => child.id),
    ['inserted-node', 'insert-anchor'],
  )
  const appendInsertResult = runtime.applyInsert({ targetParentSelector: '#insert-host', beforeSelector: '#not-a-child', html: '<i id="appended-node">tail</i>' })
  eq('applyInsert accepts targetParentSelector and appends a stale anchor', appendInsertResult.ok, true)
  deepEq(
    'applyInsert appends when the anchor is not a child',
    insertHost.children.map((child) => child.id),
    ['inserted-node', 'insert-anchor', 'appended-node'],
  )

  section('structure API refusals')
  const unknownInsert = runtime.applyInsert({ parentSelector: '#does-not-exist', html: '<span>x</span>' })
  eq('applyInsert unknown parent ok', unknownInsert.ok, false)
  eq('applyInsert unknown parent reason', unknownInsert.reason, 'not-found')
  const unknownMove = runtime.applyMoveElement({ elementKey: 'el_999999', parentSelector: '#insert-host' })
  eq('applyMoveElement unknown key ok', unknownMove.ok, false)
  eq('applyMoveElement unknown key reason', unknownMove.reason, 'not-found')
  const protectedInsert = runtime.applyInsert({ parentSelector: 'head', html: '<span>x</span>' })
  eq('applyInsert protected parent ok', protectedInsert.ok, false)
  eq('applyInsert protected parent reason', protectedInsert.reason, 'protected-element')
  const protectedMove = runtime.applyMoveElement({ elementKey: anchorMoveEvent && anchorMoveEvent.elementKey, parentSelector: 'head' })
  eq('applyMoveElement protected target ok', protectedMove.ok, false)
  eq('applyMoveElement protected target reason', protectedMove.reason, 'protected-element')
  const unsupportedInsert = runtime.applyInsert({ parentSelector: '#script', html: '<span>x</span>' })
  eq('applyInsert unsupported parent reason', unsupportedInsert.reason, 'unsupported-target-parent')
  const unsupportedMove = runtime.applyMoveElement({ elementKey: anchorMoveEvent && anchorMoveEvent.elementKey, parentSelector: '#script' })
  eq('applyMoveElement unsupported target reason', unsupportedMove.reason, 'unsupported-target-parent')
  ok('overlay root present for the own-node refusal', !!document.querySelector('[data-dsh-nudge-root]'))
  const ownInsert = runtime.applyInsert({ parentSelector: '[data-dsh-nudge-root]', html: '<span>x</span>' })
  eq('applyInsert own overlay node ok', ownInsert.ok, false)
  ok('applyInsert own overlay node reason', typeof ownInsert.reason === 'string' && ownInsert.reason.length > 0, ownInsert && ownInsert.reason)
  const ownMove = runtime.applyMoveElement({ elementKey: anchorMoveEvent && anchorMoveEvent.elementKey, parentSelector: '[data-dsh-nudge-root]' })
  eq('applyMoveElement own overlay node ok', ownMove.ok, false)
  ok('applyMoveElement own overlay node reason', typeof ownMove.reason === 'string' && ownMove.reason.length > 0, ownMove && ownMove.reason)
  const nullInsert = runtime.applyInsert(null)
  eq('applyInsert null spec does not throw', nullInsert.ok, false)
  const nullMove = runtime.applyMoveElement(null)
  eq('applyMoveElement null spec does not throw', nullMove.ok, false)
  eq('mode restored after anchor tests', runtime.setMode('browse'), true)

  section('selection-lost event')
  runtime.setSelection('#destroyable')
  eq('selection set before removal', runtime.getState().selection.id, 'destroyable')
  destroyable.remove()
  flushFrames()
  const lost = flushEvents(runtime).filter((event) => event.type === 'selection-lost')
  eq('selection-lost queued once', lost.length, 1)
  eq('selection-lost selector', lost[0].selector, '#destroyable')
  eq('selection cleared', runtime.getState().selection, null)

  section('click selection and annotation popover')
  runtime.setMode('annotate')
  flushEvents(runtime)
  dispatch(button, new FakeEvent('click', { target: button }))
  const clickEvents = flushEvents(runtime)
  ok('click queues select event', clickEvents.some((event) => event.type === 'select'))
  eq('click selection tag', runtime.getState().selection.tag, 'button')
  const rootAfterClick = document.querySelector('[data-dsh-nudge-root]')
  ok('overlay root exists', !!rootAfterClick)
  const popover = rootAfterClick && rootAfterClick.querySelector('[data-dsh-nudge="popover"]')
  ok('popover rendered', !!popover)
  ok('popover has textarea', !!rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]'))
  ok('annotation composer has no style shortcut', !rootAfterClick.querySelector('[data-dsh-nudge="popover"] button[aria-label="Adjust styles"]'))
  const textarea = rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]')
  textarea.value = '把按钮改成主色'
  dispatch(rootAfterClick.querySelector('[data-dsh-nudge="popover-add"]'), new FakeEvent('click', { target: rootAfterClick.querySelector('[data-dsh-nudge="popover-add"]') }))
  const addEvents = flushEvents(runtime)
  const addEvent = addEvents.find((event) => event.type === 'annotate-add')
  ok('annotate-add queued', !!addEvent)
  eq('annotation note', addEvent.annotation.note, '把按钮改成主色')
  eq('annotation selector', addEvent.annotation.selector, runtime.getState().selection.selector)
  eq('annotation stored', runtime.getState().annotations.length, 1)
  eq('popover closed after add', rootAfterClick.querySelector('[data-dsh-nudge="popover"]'), null)
  const renderedBadge = rootAfterClick.querySelector('[data-dsh-nudge="badge"]')
  ok('annotation badge rendered', !!renderedBadge)
  eq('annotation pin width', renderedBadge && renderedBadge.style.getPropertyValue('width'), '26px')

  // Clicking the already-annotated element reopens its editor instead of
  // starting a second annotation.
  dispatch(button, new FakeEvent('click', { target: button }))
  const annotatedPopover = rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]')
  eq('clicking an annotated element prefills its note', annotatedPopover && annotatedPopover.value, '把按钮改成主色')
  eq('clicking an annotated element does not create a duplicate', runtime.getState().annotations.length, 1)
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'Escape' }))
  ok('annotated element editor closes with escape', rootAfterClick.querySelector('[data-dsh-nudge="popover"]') === null)

  const floatingBar = rootAfterClick.querySelector('[data-dsh-nudge="bar"]')
  ok('floating annotation bar rendered', !!floatingBar && floatingBar.style.getPropertyValue('display') === 'flex')
  ok('page-side comment tray removed', rootAfterClick.querySelector('[data-dsh-nudge="tray"]') === null)
  ok('floating bar has the codex action cluster', !!floatingBar && floatingBar.querySelectorAll('button').length >= 6)
  ok('floating bar drag handle rendered', !!floatingBar && !!floatingBar.querySelector('button[aria-label="Move toolbar"]'))
  ok('floating bar hides markers action rendered', !!floatingBar && !!floatingBar.querySelector('button[aria-label="Hide markers"]'))
  const floatingBarSend = floatingBar && floatingBar.querySelector('button[aria-label="Send"]')
  ok('floating bar send button rendered', !!floatingBarSend)
  dispatch(floatingBarSend || floatingBar.querySelector('button'), new FakeEvent('click', { target: floatingBarSend || floatingBar.querySelector('button') }))
  ok('floating bar send queues event', flushEvents(runtime).some((event) => event.type === 'annotation-send'))

  // Host bar contract (fullscreen floating dock): the host owns the bar chrome,
  // the page hides its own bar and serves state/actions.
  ok('page bar can be hosted by the dock', runtime.setBarHosted(true) === true)
  ok('hosted page bar is hidden', floatingBar.style.getPropertyValue('display') === 'none')
  const barState = runtime.getBarState()
  ok('host bar state reports mode, count and marker visibility', !!barState && barState.annotating === true && typeof barState.count === 'number' && typeof barState.markersHidden === 'boolean')
  ok('host bar toggles marker visibility', runtime.toggleMarkers() === true)
  ok('host bar toggles markers back', runtime.toggleMarkers() === false)
  ok('host bar sends pending annotations', runtime.sendAnnotations() === true)
  ok('host bar send queues the annotation-send event', flushEvents(runtime).some((event) => event.type === 'annotation-send'))
  ok('page bar returns when the host releases it', runtime.setBarHosted(false) === true)
  ok('page bar visible again after release', floatingBar.style.getPropertyValue('display') === 'flex')

  // Hide markers collapses pins but keeps the toolbar; show markers restores them.
  dispatch(floatingBar.querySelector('button[aria-label="Hide markers"]'), new FakeEvent('click', { target: floatingBar.querySelector('button[aria-label="Hide markers"]') }))
  ok('hidden markers remove the pin', rootAfterClick.querySelector('[data-dsh-nudge="badge"]') === null)
  ok('hidden markers keep the bar', floatingBar.style.getPropertyValue('display') === 'flex')
  const showMarkers = floatingBar.querySelector('button[aria-label="Show markers"]')
  ok('bar swaps to the show-markers action', !!showMarkers)
  dispatch(showMarkers || floatingBar.querySelector('button'), new FakeEvent('click', { target: showMarkers || floatingBar.querySelector('button') }))
  ok('show markers restore the pin', !!rootAfterClick.querySelector('[data-dsh-nudge="badge"]'))

  // The host floating composer publishes its dock height as a bottom safe area:
  // the page keeps its full height, and its own floating UI stays above the dock.
  const barBottomBefore = parseFloat(floatingBar.style.getPropertyValue('bottom')) || 0
  ok('page safe area api accepts a positive inset', runtime.setBottomInset(120) === true)
  const barBottomWithInset = parseFloat(floatingBar.style.getPropertyValue('bottom')) || 0
  ok('annotation bar lifts above the reserved dock strip', barBottomWithInset >= 128)
  ok('page safe area clamps negative input', runtime.setBottomInset(-40) === true)
  const barBottomReset = parseFloat(floatingBar.style.getPropertyValue('bottom')) || 0
  ok('annotation bar returns to its pre-inset position', Math.abs(barBottomReset - barBottomBefore) <= 6)

  // Discard is a two-step action: arm, then clear.
  const discardButton = floatingBar.querySelector('button[aria-label="Discard annotations"]')
  ok('discard action rendered', !!discardButton)
  dispatch(discardButton, new FakeEvent('click', { target: discardButton }))
  ok('first discard click only arms the action', runtime.getState().annotations.length === 1)
  const armedDiscard = floatingBar.querySelector('button[aria-label="Click again to discard all annotations"]')
  ok('discard action arms with a second-step label', !!armedDiscard)
  dispatch(armedDiscard || discardButton, new FakeEvent('click', { target: armedDiscard || discardButton }))
  ok('second discard click clears every annotation', runtime.getState().annotations.length === 0)

  // Recreate one annotation so the downstream editor checks keep their fixture.
  dispatch(button, new FakeEvent('click', { target: button }))
  const restoredTextarea = rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]')
  restoredTextarea.value = '把按钮改成主色'
  dispatch(rootAfterClick.querySelector('[data-dsh-nudge="popover-add"]'), new FakeEvent('click', { target: rootAfterClick.querySelector('[data-dsh-nudge="popover-add"]') }))
  flushEvents(runtime)
  ok('annotation can be recreated after discard', runtime.getState().annotations.length === 1)
  const recreatedBadge = rootAfterClick.querySelector('[data-dsh-nudge="badge"]')
  dispatch(recreatedBadge, new FakeEvent('click', { target: recreatedBadge }))
  ok('badge click opens editor', !!rootAfterClick.querySelector('[data-dsh-nudge="popover"]'))
  eq('badge editor prefilled', rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]').value, '把按钮改成主色')
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'Escape' }))
  const annotationId = runtime.getState().annotations[0].id

  section('annotation editor and update/remove')
  const edited = runtime.openAnnotationEditor(annotationId)
  eq('openAnnotationEditor ok', edited.ok, true)
  const editorPopover = rootAfterClick.querySelector('[data-dsh-nudge="popover"]')
  ok('editor popover rendered', !!editorPopover)
  eq('editor prefilled', rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]').value, '把按钮改成主色')
  const editorTextarea = rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]')
  editorTextarea.value = '更新后的标注'
  dispatch(rootAfterClick.querySelector('[data-dsh-nudge="popover-add"]'), new FakeEvent('click', { target: rootAfterClick.querySelector('[data-dsh-nudge="popover-add"]') }))
  const updateEvents = flushEvents(runtime)
  ok('annotate-update queued', updateEvents.some((event) => event.type === 'annotate-update'))
  eq('annotation note updated', runtime.getState().annotations[0].note, '更新后的标注')
  const updated = runtime.updateAnnotation(annotationId, '侧栏更新')
  eq('updateAnnotation ok', updated.ok, true)
  eq('updateAnnotation returns annotation', updated.annotation.note, '侧栏更新')
  eq('updateAnnotation persisted', runtime.getState().annotations[0].note, '侧栏更新')
  eq('removeAnnotation returns true', runtime.removeAnnotation(annotationId), true)
  eq('annotation removed', runtime.getState().annotations.length, 0)
  eq('removeAnnotation unknown returns false', runtime.removeAnnotation(annotationId), false)
  eq('badge removed', rootAfterClick.querySelector('[data-dsh-nudge="badge"]'), null)

  section('escape closes popover')
  dispatch(hero, new FakeEvent('click', { target: hero }))
  ok('popover open before escape', !!rootAfterClick.querySelector('[data-dsh-nudge="popover"]'))
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'Escape' }))
  eq('escape closes popover', rootAfterClick.querySelector('[data-dsh-nudge="popover"]'), null)

  section('annotation arrow navigation')
  runtime.setMode('annotate')
  flushEvents(runtime)
  // Two annotations: button first, hero second.
  dispatch(button, new FakeEvent('click', { target: button }))
  rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]').value = '第一条批注'
  dispatch(rootAfterClick.querySelector('[data-dsh-nudge="popover-add"]'), new FakeEvent('click', { target: rootAfterClick.querySelector('[data-dsh-nudge="popover-add"]') }))
  dispatch(hero, new FakeEvent('click', { target: hero }))
  rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]').value = '第二条批注'
  dispatch(rootAfterClick.querySelector('[data-dsh-nudge="popover-add"]'), new FakeEvent('click', { target: rootAfterClick.querySelector('[data-dsh-nudge="popover-add"]') }))
  flushEvents(runtime)
  eq('two annotations prepared for arrow navigation', runtime.getState().annotations.length, 2)
  runtime.clearSelection()
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'ArrowDown', code: 'ArrowDown' }))
  ok('ArrowDown opens the first annotation editor', !!rootAfterClick.querySelector('[data-dsh-nudge="popover"]'))
  eq('ArrowDown lands on the first note', rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]').value, '第一条批注')
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'ArrowDown', code: 'ArrowDown' }))
  eq('second ArrowDown moves to the next note', rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]').value, '第二条批注')
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'ArrowDown', code: 'ArrowDown' }))
  eq('arrow navigation wraps to the first note', rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]').value, '第一条批注')
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'ArrowUp', code: 'ArrowUp' }))
  eq('ArrowUp moves to the previous note with wrap', rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]').value, '第二条批注')
  dispatch(rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]'), new FakeEvent('keydown', { target: rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]'), key: 'ArrowDown', code: 'ArrowDown' }))
  eq('arrows inside the note textarea keep native caret behavior', rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]').value, '第二条批注')
  eq('arrow navigation stays inside annotate mode', runtime.getState().mode, 'annotate')

  section('escape exits annotate and edit modes')
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'Escape' }))
  eq('first escape closes the editor overlay', rootAfterClick.querySelector('[data-dsh-nudge="popover"]'), null)
  eq('first escape keeps annotate mode', runtime.getState().mode, 'annotate')
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'Escape' }))
  eq('second escape exits annotate mode', runtime.getState().mode, 'browse')
  runtime.setMode('edit')
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'Escape' }))
  eq('escape exits edit mode', runtime.getState().mode, 'browse')
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'ArrowDown', code: 'ArrowDown' }))
  eq('arrow keys are not consumed outside annotate mode', rootAfterClick.querySelector('[data-dsh-nudge="popover"]'), null)
  runtime.setMode('annotate')
  runtime.discardAnnotations()
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'ArrowDown', code: 'ArrowDown' }))
  eq('arrow keys with no annotations fall through to page scrolling', rootAfterClick.querySelector('[data-dsh-nudge="popover"]'), null)
  eq('annotations cleared after arrow navigation checks', runtime.getState().annotations.length, 0)
  runtime.setMode('browse')

  section('region drag')
  runtime.setMode('annotate')
  flushEvents(runtime)
  dispatch(bodyTarget(), new FakeEvent('mousedown', { target: bodyTarget(), clientX: 700, clientY: 300, button: 0 }))
  dispatch(document, new FakeEvent('mousemove', { target: document, clientX: 760, clientY: 340 }))
  dispatch(document, new FakeEvent('mouseup', { target: document, clientX: 760, clientY: 340, button: 0 }))
  const regionEvents = flushEvents(runtime)
  const regionEvent = regionEvents.find((event) => event.type === 'region-select')
  ok('region-select queued', !!regionEvent)
  eq('region width', regionEvent.region.width, 60)
  eq('region height', regionEvent.region.height, 40)
  ok('region popover opened', !!rootAfterClick.querySelector('[data-dsh-nudge="popover"]'))
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'Escape' }))
  // A completed marquee suppresses the synthetic click that follows it.
  await new Promise((resolve) => setTimeout(resolve, 480))

  function bodyTarget() {
    return document.body
  }

  section('locate')
  runtime.setMode('browse')
  const locateResult = runtime.locate('#hero')
  eq('locate ok', locateResult.ok, true)
  const flashNode = rootAfterClick && rootAfterClick.querySelector('[data-dsh-nudge="flash"]')
  ok('locate draws a flash box', !!flashNode && flashNode.style.getPropertyValue('display') === 'block')
  eq('locate selects element', runtime.getState().selection.id, 'hero')

  section('Codex-style edit design card')
  runtime.setMode('edit')
  flushEvents(runtime)
  dispatch(button, new FakeEvent('click', { target: button }))
  const designRoot = document.querySelector('[data-dsh-nudge-root]')
  const designCardEl = designRoot.querySelector('[data-dsh-nudge="design"]')
  ok('design card rendered in edit mode', !!designCardEl)
  const sectionButtons = designCardEl.querySelectorAll('button')
  ok('design card exposes collapsible sections', sectionButtons.length >= 9)
  const textEditor = designCardEl.querySelector('[data-dsh-nudge="design-text"]')
  ok('text content is expanded by default', !!textEditor && textEditor.value === '按钮')
  ok('typography is expanded by default', designCardEl.textContent.includes('Font size') && designCardEl.textContent.includes('Line height'))
  ok('layout is collapsed by default', !designCardEl.textContent.includes('Width'))
  const layoutHeader = designCardEl.querySelectorAll('button').find((button) => button.textContent === 'Layout')
  ok('layout section header rendered', !!layoutHeader)
  dispatch(layoutHeader, new FakeEvent('click', { target: layoutHeader }))
  ok('layout section expands on click', designCardEl.textContent.includes('Width'))
  ok('appearance stays collapsed', !designCardEl.textContent.includes('Border'))
  ok('attributes section removed', !designCardEl.textContent.includes('Attributes'))
  textEditor.value = '立即购买'
  dispatch(textEditor, new FakeEvent('change', { target: textEditor }))
  ok('text edit queues a design-text event', flushEvents(runtime).some((event) => event.type === 'design-text' && event.after === '立即购买'))
  eq('text edit applies to the element', button.textContent, '立即购买')
  dispatch(document, new FakeEvent('keydown', { target: document, key: ' ', code: 'Space' }))
  ok('space does not pass through while the design card is open', designRoot.getAttribute('data-dsh-nudge-passthrough') !== 'true')
  dispatch(textEditor, new FakeEvent('keydown', { target: textEditor, key: ' ', code: 'Space' }))
  ok('space stays an input character inside the design card', designRoot.getAttribute('data-dsh-nudge-passthrough') !== 'true')
  // The injected cursor / page hover chrome must step aside on our own panel:
  // the style card is regular UI, so it keeps the native cursor and no selection
  // marker / metadata is painted over it.
  const cursorNode = designRoot.querySelector('[data-dsh-nudge="cursor"]')
  const hoverChrome = designRoot.querySelector('[data-dsh-nudge="hover"]')
  const metaChrome = designRoot.querySelector('[data-dsh-nudge="meta"]')
  eq('overlay chrome restores the native cursor', designRoot.style.getPropertyValue('cursor'), 'auto')
  dispatch(document, new FakeEvent('mousemove', { target: textEditor, clientX: 20, clientY: 20 }))
  flushFrames()
  eq('injected cursor hides while the pointer is on the panel', cursorNode.style.getPropertyValue('display'), 'none')
  eq('page hover chrome hides while the pointer is on the panel', hoverChrome.style.getPropertyValue('display'), 'none')
  eq('page metadata hides while the pointer is on the panel', metaChrome.style.getPropertyValue('display'), 'none')
  dispatch(document, new FakeEvent('mousemove', { target: button, clientX: 500, clientY: 500 }))
  flushFrames()
  eq('injected cursor returns once the pointer is back on the page', cursorNode.style.getPropertyValue('display'), 'block')
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'Escape' }))
  eq('escape closes design card', designRoot.querySelector('[data-dsh-nudge="design"]'), null)
  eq('cancel reverts the text edit', button.textContent, '按钮')
  // The sidebar DOM panel is backed by these runtime APIs.
  const domRoot = runtime.domChildren([])
  ok('domChildren lists the root children', Array.isArray(domRoot) && domRoot.length > 0)
  const bodyNode = domRoot.find((node) => node && node.tag === 'body')
  ok('domChildren exposes the body node', !!bodyNode)
  const bodyKids = bodyNode ? runtime.domChildren(bodyNode.path) : []
  ok('domChildren lists nested children lazily', Array.isArray(bodyKids) && bodyKids.length > 0)
  ok('domChildren entries carry a path and tag', bodyKids.every((node) => Array.isArray(node.path) && typeof node.tag === 'string'))
  const focused = runtime.focusDomPath(bodyNode ? bodyNode.path : [])
  eq('focusDomPath reports ok', focused.ok, true)
  eq('focusDomPath selects the node', runtime.getState().selection && runtime.getState().selection.tag, 'body')
  section('edit card without direct text')
  runtime.setMode('edit')
  flushEvents(runtime)
  dispatch(noTextHost, new FakeEvent('click', { target: noTextHost }))
  const emptyCard = document.querySelector('[data-dsh-nudge-root]').querySelector('[data-dsh-nudge="design"]')
  ok('design card renders for an element without text', !!emptyCard)
  ok('no text input when the element has no direct text', !!emptyCard && emptyCard.querySelector('[data-dsh-nudge="design-text"]') === null)
  ok('text content section hidden without text', !!emptyCard && emptyCard.textContent.indexOf('Text content') === -1)
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'Escape' }))
  runtime.setMode('browse')
  flushEvents(runtime)

  section('locale and theme')
  runtime.setLocale({ title: '添加标注', subtitle: '为选中元素', placeholder: '描述修改意见', cancel: '取消', add: '添加', region: '区域' })
  runtime.setTheme({ accent: '#ff5500', annotationAccent: '#00aa77', panelBg: '#111111', text: '#ffffff', border: '#333333', muted: '#999999', danger: '#ff0000', isDark: true })
  runtime.setMode('annotate')
  dispatch(sub, new FakeEvent('click', { target: sub }))
  const localePopover = rootAfterClick.querySelector('[data-dsh-nudge="popover"]')
  ok('localized popover rendered', !!localePopover)
  eq('localized title', rootAfterClick.querySelector('[data-dsh-nudge="popover-title"]').textContent, '添加标注')
  eq('localized cancel', rootAfterClick.querySelector('[data-dsh-nudge="popover-cancel"]').textContent, '取消')
  eq('localized add', rootAfterClick.querySelector('[data-dsh-nudge="popover-add"]').textContent, '添加')
  eq('popover uses Codex dark surface', localePopover.style.getPropertyValue('background'), '#2f2f2f')
  eq('themed selection outline uses annotation accent', rootAfterClick.querySelector('[data-dsh-nudge="selection"]').style.getPropertyValue('border-color'), '#00aa77')
  // The injected overlay follows the host's DSH light palette, and a live flip
  // repaints the already-open surfaces in place instead of only the popover shell.
  runtime.setTheme({ accent: '#ff5500', annotationAccent: '#00aa77', panelBg: '#ffffff', text: '#0f1115', border: '#d9dde6', muted: '#61666b', danger: '#ff0000', isDark: false })
  eq('open popover repaints to the light surface', localePopover.style.getPropertyValue('background'), '#ffffff')
  eq('open popover text repaints to light ink', localePopover.style.getPropertyValue('color'), '#0f1115')
  const lightAdd = rootAfterClick.querySelector('[data-dsh-nudge="popover-add"]')
  eq('disabled add keeps the light disabled fill', lightAdd && lightAdd.style.getPropertyValue('background'), 'rgba(15,17,21,0.08)')
  const shadowSheet = rootAfterClick.querySelector('style[data-dsh-nudge="style"]')
  ok('composer placeholder follows the light ink', !!shadowSheet && shadowSheet.textContent.indexOf('rgba(15,17,21,0.50)') !== -1)
  const lightTextarea = rootAfterClick.querySelector('[data-dsh-nudge="popover-textarea"]')
  lightTextarea.value = '浅色主题'
  dispatch(lightTextarea, new FakeEvent('input', { target: lightTextarea }))
  eq('enabled add switches to the light submit fill', lightAdd.style.getPropertyValue('background'), '#0069FB')
  eq('enabled add switches to the light submit ink', lightAdd.style.getPropertyValue('color'), '#ffffff')
  dispatch(lightAdd, new FakeEvent('click', { target: lightAdd }))
  flushEvents(runtime)
  eq('annotation saved for the bar theme check', runtime.getState().annotations.length, 1)
  const themedBar = rootAfterClick.querySelector('[data-dsh-nudge="bar"]')
  ok('annotate bar stays visible in light mode', !!themedBar && themedBar.style.getPropertyValue('display') === 'flex')
  eq('bottom annotate bar follows the light surface', themedBar && themedBar.style.getPropertyValue('background'), '#ffffff')
  eq('bottom annotate bar text follows light ink', themedBar && themedBar.style.getPropertyValue('color'), '#0f1115')
  // A live light -> dark flip must keep working (the host toggles the desktop theme).
  runtime.setTheme({ accent: '#ff5500', annotationAccent: '#00aa77', panelBg: '#111111', text: '#ffffff', border: '#333333', muted: '#999999', danger: '#ff0000', isDark: true })
  eq('bar returns to the dark surface after a flip', themedBar && themedBar.style.getPropertyValue('background'), '#262626')
  dispatch(sub, new FakeEvent('click', { target: sub }))
  const darkAgainPopover = rootAfterClick.querySelector('[data-dsh-nudge="popover"]')
  eq('popover returns to the dark surface after a flip', darkAgainPopover && darkAgainPopover.style.getPropertyValue('background'), '#2f2f2f')
  ok('composer placeholder returns to the dark ink', !!shadowSheet && shadowSheet.textContent.indexOf('rgba(255,255,255,0.42)') !== -1)
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'Escape' }))
  const themedAnnotationId = runtime.getState().annotations[0] && runtime.getState().annotations[0].id
  eq('theme-flip annotation cleaned up', runtime.removeAnnotation(themedAnnotationId), true)
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'Escape' }))

  section('Codex-style selection chrome')
  runtime.setMode('annotate')
  flushEvents(runtime)
  dispatch(button, new FakeEvent('click', { target: button }))
  const chromeRoot = document.querySelector('[data-dsh-nudge-root]')
  const selectionNode = chromeRoot && chromeRoot.querySelector('[data-dsh-nudge="selection"]')
  ok('selection chrome rendered', !!selectionNode)
  eq('selection border is 2px', selectionNode && selectionNode.style.getPropertyValue('border-width'), '2px')
  ok('selection fill is present', !!selectionNode && /0\.035/.test(selectionNode.style.getPropertyValue('background')))
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'Escape' }))
  flushEvents(runtime)

  section('space passthrough')
  dispatch(document, new FakeEvent('mousemove', { target: button, clientX: 420, clientY: 520 }))
  eq('annotation cursor style injected', document.querySelectorAll('style[data-dsh-nudge-cursor-style]').length, 1)
  dispatch(document, new FakeEvent('keydown', { target: document, key: ' ', code: 'Space' }))
  ok('passthrough attribute set', chromeRoot.getAttribute('data-dsh-nudge-passthrough') === 'true')
  eq('native cursor style removed in passthrough', document.querySelectorAll('style[data-dsh-nudge-cursor-style]').length, 0)
  dispatch(document, new FakeEvent('keyup', { target: document, key: ' ', code: 'Space' }))
  eq('passthrough attribute cleared', chromeRoot.getAttribute('data-dsh-nudge-passthrough'), 'false')
  eq('cursor style returns after release', document.querySelectorAll('style[data-dsh-nudge-cursor-style]').length, 1)
  dispatch(document, new FakeEvent('keydown', { target: document, key: ' ', code: 'Space', shiftKey: true }))
  eq('shift+space does not enter passthrough', chromeRoot.getAttribute('data-dsh-nudge-passthrough'), 'false')
  dispatch(document, new FakeEvent('keydown', { target: document, key: ' ', code: 'Space' }))
  eq('space re-enters passthrough', chromeRoot.getAttribute('data-dsh-nudge-passthrough'), 'true')
  dispatch(document, new FakeEvent('keydown', { target: document, key: 'Escape' }))
  eq('escape exits passthrough', chromeRoot.getAttribute('data-dsh-nudge-passthrough'), 'false')
  runtime.setMode('browse')
  flushEvents(runtime)

  section('re-injection is idempotent')
  const listenersBefore = listenerCount(document) + listenerCount(sandbox)
  const oldRuntime = runtime
  const secondStatus = vm.runInContext(source, sandbox, { filename: 'runtime.js' })
  eq("re-injection returns 'ok'", secondStatus, 'ok')
  const runtime2 = sandbox.__DSH_NUDGE__
  ok('namespace replaced', runtime2 !== oldRuntime)
  eq('version still 1', runtime2.version, 1)
  const listenersAfter = listenerCount(document) + listenerCount(sandbox)
  eq('listener count unchanged after re-injection', listenersAfter, listenersBefore)
  eq('old instance reports destroyed', oldRuntime.setMode('annotate'), false)
  runtime2.setMode('annotate')
  eq('single overlay root after re-injection', document.querySelectorAll('[data-dsh-nudge-root]').length, 1)
  runtime2.setMode('browse')
  eq('page-info queued after re-injection', runtime2.drainEvents().some((event) => event.type === 'page-info'), true)

  section('mode keyboard shortcuts')
  const keyInput = element('input', { id: 'key-input', parent: document.body })
  function pressKey(target, init) {
    const event = new FakeEvent('keydown', Object.assign({ target: target }, init))
    dispatch(target, event)
    return event
  }
  runtime2.setMode('annotate')
  flushEvents(runtime2)
  runtime2.setMode('annotate')
  eq('no mode-change for a same-mode call', flushEvents(runtime2).some((event) => event.type === 'mode-change'), false)
  runtime2.setMode('browse')
  flushEvents(runtime2)

  // Single-key activation: A enters annotate, E enters edit, Esc is the only
  // way out. Focus in an input or a modifier chord never activates a mode.
  const enterAnnotate = pressKey(document.body, { key: 'a', code: 'KeyA' })
  eq('A enters annotate mode', runtime2.getState().mode, 'annotate')
  eq('A activation prevents default', enterAnnotate.defaultPrevented, true)
  const annotateModeEvents = flushEvents(runtime2).filter((event) => event.type === 'mode-change')
  eq('A announces one mode-change', annotateModeEvents.length, 1)
  eq('A mode-change payload is annotate', annotateModeEvents[0] && annotateModeEvents[0].mode, 'annotate')
  const againA = pressKey(document.body, { key: 'a', code: 'KeyA' })
  eq('A while already annotating keeps annotate', runtime2.getState().mode, 'annotate')
  eq('A while already annotating is still consumed', againA.defaultPrevented, true)
  eq('A while already annotating announces nothing', flushEvents(runtime2).some((event) => event.type === 'mode-change'), false)
  const enterEdit = pressKey(document.body, { key: 'e', code: 'KeyE' })
  eq('E enters edit mode', runtime2.getState().mode, 'edit')
  eq('E activation prevents default', enterEdit.defaultPrevented, true)
  const editModeEvents = flushEvents(runtime2).filter((event) => event.type === 'mode-change')
  eq('E announces one mode-change', editModeEvents.length, 1)
  eq('E mode-change payload is edit', editModeEvents[0] && editModeEvents[0].mode, 'edit')
  const againE = pressKey(document.body, { key: 'e', code: 'KeyE' })
  eq('E while already editing keeps edit', runtime2.getState().mode, 'edit')
  eq('E while already editing is still consumed', againE.defaultPrevented, true)
  eq('E while already editing announces nothing', flushEvents(runtime2).some((event) => event.type === 'mode-change'), false)
  const inputE = pressKey(keyInput, { key: 'e', code: 'KeyE' })
  eq('mode keys inside an input leave the mode alone', runtime2.getState().mode, 'edit')
  eq('mode keys inside an input do not preventDefault', inputE.defaultPrevented, false)
  const metaE = pressKey(document.body, { key: 'e', code: 'KeyE', metaKey: true })
  eq('modifier+mode key does not activate', runtime2.getState().mode, 'edit')
  eq('modifier+mode key does not preventDefault', metaE.defaultPrevented, false)
  const plainTab = pressKey(document.body, { key: 'Tab' })
  eq('plain Tab is left to the browser', runtime2.getState().mode, 'edit')
  eq('plain Tab does not preventDefault', plainTab.defaultPrevented, false)
  flushEvents(runtime2)

  section('configurable page hotkeys')
  runtime2.setMode('browse')
  flushEvents(runtime2)
  eq(
    'setHotkeys returns true',
    runtime2.setHotkeys({ annotate: 'KeyB', edit: 'KeyR', prevAnnotation: 'KeyK', nextAnnotation: 'KeyJ' }),
    true,
  )
  eq('old mode key is no longer consumed', pressKey(document.body, { key: 'a', code: 'KeyA' }).defaultPrevented, false)
  eq('old mode key leaves browse alone', runtime2.getState().mode, 'browse')
  pressKey(document.body, { key: 'b', code: 'KeyB' })
  eq('custom annotate key enters annotate', runtime2.getState().mode, 'annotate')
  pressKey(document.body, { key: 'r', code: 'KeyR' })
  eq('custom edit key enters edit', runtime2.getState().mode, 'edit')
  pressKey(document.body, { key: 'Escape' })
  eq('custom bindings keep Esc as the exit', runtime2.getState().mode, 'browse')
  eq('setHotkeys ignores invalid values', runtime2.setHotkeys({ annotate: 42, edit: '' }), true)
  pressKey(document.body, { key: 'b', code: 'KeyB' })
  eq('invalid rebinding keeps the previous annotate key', runtime2.getState().mode, 'annotate')
  pressKey(document.body, { key: 'Escape' })
  pressKey(document.body, { key: 'r', code: 'KeyR' })
  eq('partial map keeps the previous edit key', runtime2.getState().mode, 'edit')
  pressKey(document.body, { key: 'Escape' })
  eq(
    'custom bindings restore to defaults',
    runtime2.setHotkeys({ annotate: 'KeyA', edit: 'KeyE', prevAnnotation: 'ArrowUp', nextAnnotation: 'ArrowDown' }),
    true,
  )
  runtime2.setMode('browse')
  flushEvents(runtime2)

  runtime2.setMode('annotate')
  flushEvents(runtime2)
  const escAnnotate = pressKey(document.body, { key: 'Escape' })
  eq('ESC from annotate returns to browse', runtime2.getState().mode, 'browse')
  eq('ESC prevents default when exiting a mode', escAnnotate.defaultPrevented, true)
  const escaperEvents = flushEvents(runtime2).filter((event) => event.type === 'mode-change')
  eq('ESC announces one mode-change', escaperEvents.length, 1)
  eq('ESC mode-change payload is browse', escaperEvents[0] && escaperEvents[0].mode, 'browse')
  const escBrowse = pressKey(document.body, { key: 'Escape' })
  eq('ESC in browse does not preventDefault', escBrowse.defaultPrevented, false)
  eq('ESC in browse announces nothing again', flushEvents(runtime2).some((event) => event.type === 'mode-change'), false)
  runtime2.setMode('edit')
  flushEvents(runtime2)
  pressKey(document.body, { key: 'Escape' })
  eq('ESC from edit returns to browse', runtime2.getState().mode, 'browse')
  flushEvents(runtime2)

  // Layering: design card -> popover -> drag -> mode.
  runtime2.setMode('edit')
  flushEvents(runtime2)
  runtime2.setSelection('#hero')
  dispatch(hero, new FakeEvent('click', { target: hero }))
  ok('layering: design card open before ESC', !!document.querySelector('[data-dsh-nudge="design"]'))
  const cardEscape = pressKey(document.body, { key: 'Escape' })
  eq('layering: first ESC closes the design card', document.querySelector('[data-dsh-nudge="design"]'), null)
  eq('layering: first ESC keeps edit mode', runtime2.getState().mode, 'edit')
  eq('layering: first ESC is consumed', cardEscape.defaultPrevented, true)
  flushEvents(runtime2)
  pressKey(document.body, { key: 'Escape' })
  eq('layering: second ESC leaves edit mode', runtime2.getState().mode, 'browse')
  flushEvents(runtime2)

  runtime2.setMode('annotate')
  flushEvents(runtime2)
  dispatch(button, new FakeEvent('click', { target: button }))
  ok('layering: annotation popover open before ESC', !!document.querySelector('[data-dsh-nudge="popover"]'))
  pressKey(document.body, { key: 'Escape' })
  eq('layering: first ESC closes the annotation popover', document.querySelector('[data-dsh-nudge="popover"]'), null)
  eq('layering: first ESC keeps annotate mode', runtime2.getState().mode, 'annotate')
  flushEvents(runtime2)
  pressKey(document.body, { key: 'Escape' })
  eq('layering: second ESC leaves annotate mode', runtime2.getState().mode, 'browse')
  flushEvents(runtime2)

  runtime2.setMode('annotate')
  flushEvents(runtime2)
  dispatch(hero, new FakeEvent('mousedown', { target: hero, clientX: 30, clientY: 60 }))
  pressKey(document.body, { key: 'Escape' })
  eq('layering: drag-clear ESC keeps annotate mode', runtime2.getState().mode, 'annotate')
  pressKey(document.body, { key: 'Escape' })
  eq('layering: following ESC leaves annotate mode', runtime2.getState().mode, 'browse')
  flushEvents(runtime2)


  section('destroy')
  runtime2.destroy()
  eq('namespace removed', sandbox.__DSH_NUDGE__, null)
  eq('overlay removed after destroy', document.querySelectorAll('[data-dsh-nudge-root]').length, 0)
  eq('listeners removed after destroy', listenerCount(document), 0)
  eq('window listeners removed after destroy', listenerCount(sandbox), 0)
  eq('theme media listener released after destroy', themeMedia.listenerCount(), 0)
  const destroyedInsert = runtime2.applyInsert({ parentSelector: 'body', html: '<span>x</span>' })
  eq('applyInsert after destroy ok', destroyedInsert.ok, false)
  eq('applyInsert after destroy reason', destroyedInsert.reason, 'destroyed')
  const destroyedMove = runtime2.applyMoveElement({ elementKey: 'el_1', parentSelector: 'body' })
  eq('applyMoveElement after destroy ok', destroyedMove.ok, false)
  eq('applyMoveElement after destroy reason', destroyedMove.reason, 'destroyed')

  process.stdout.write('\n' + checks + ' checks, ' + failures + ' failure(s)\n')
  if (failures > 0) {
    process.exitCode = 1
    return
  }
  process.stdout.write('ok\n')
}

run().catch((error) => {
  process.stderr.write('not ok - smoke test threw: ' + (error && error.stack ? error.stack : error) + '\n')
  process.exitCode = 1
})
