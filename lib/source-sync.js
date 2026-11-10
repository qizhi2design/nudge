// src/host/domains/persistence/index.ts
import { isAbsolute as isAbsolute2, join as join2, resolve } from "node:path";

// src/host/domains/persistence/constants.ts
var OVERRIDE_STYLE_ID = "dsh-nudge-overrides";
var CSS_EXTENSIONS = /* @__PURE__ */ new Set(["css", "scss", "less"]);
var TEMPLATE_EXTENSIONS = /* @__PURE__ */ new Set(["vue", "svelte", "astro"]);
var MARKUP_EXTENSIONS = /* @__PURE__ */ new Set(["html", "htm", "vue", "svelte", "astro", "js", "jsx", "ts", "tsx", "mjs", "cjs"]);
var SEARCH_EXTENSIONS = /* @__PURE__ */ new Set(["html", "htm", "css", "scss", "less", "js", "jsx", "ts", "tsx", "vue", "svelte", "astro"]);
var SKIP_DIRECTORIES = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", ".dsh"]);
var VOID_ELEMENTS = /* @__PURE__ */ new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
var RAW_TEXT_ELEMENTS = /* @__PURE__ */ new Set(["script", "style", "textarea", "title"]);
var READ_LIMIT = 1e6;
var DEFAULT_SCAN_LIMIT = 400;
var SEARCH_DIRECTORY_BUDGET = 4e3;
var SEARCH_SCORE_THRESHOLD = 3;
var URL_ATTRIBUTES = /* @__PURE__ */ new Set(["href", "src", "action", "formaction", "poster", "xlink:href", "data", "srcset", "background"]);

// src/host/domains/persistence/css/selector.ts
function skipStringToken(text, index) {
  const quote = text[index];
  let cursor = index + 1;
  while (cursor < text.length) {
    const ch = text[cursor];
    if (ch === "\\") {
      cursor += 2;
      continue;
    }
    if (ch === quote) return cursor + 1;
    cursor += 1;
  }
  return text.length;
}
function canonicalSelector(text) {
  if (typeof text !== "string") return "";
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").replace(/\s*([>+~,])\s*/g, " $1 ").replace(/\s+/g, " ").trim();
}
function splitSelectorParts(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === "(" || ch === "[") {
      depth += 1;
      continue;
    }
    if (ch === ")" || ch === "]") {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      index = skipStringToken(text, index) - 1;
      continue;
    }
    if (ch === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}
function splitCompounds(selector) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (let index = 0; index < selector.length; index += 1) {
    const ch = selector[index];
    if (ch === "(" || ch === "[") {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ")" || ch === "]") {
      if (depth > 0) depth -= 1;
      current += ch;
      continue;
    }
    if (depth === 0 && (ch === " " || ch === "	" || ch === "\n" || ch === "\r" || ch === ">" || ch === "+" || ch === "~")) {
      if (current.trim() !== "") parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}
function lastCompound(selector) {
  const parts = splitCompounds(selector);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}
function stripPseudo(compound) {
  return compound.replace(/::?[A-Za-z-]+(?:\((?:[^()]|\([^()]*\))*\))?/g, "");
}
function compoundTokens(compound) {
  const cleaned = stripPseudo(compound);
  const ids = [];
  const classes = [];
  for (const match of cleaned.matchAll(/#([A-Za-z_][A-Za-z0-9_-]*)/g)) ids.push(match[1]);
  for (const match of cleaned.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) classes.push(match[1]);
  const tagMatch = /^([A-Za-z][A-Za-z0-9-]*)/.exec(cleaned);
  return { ids, classes, tag: tagMatch ? tagMatch[1].toLowerCase() : "" };
}
function compoundOverlap(left, right) {
  let score = 0;
  for (const id of left.ids) if (right.ids.includes(id)) score += 2;
  for (const cls of left.classes) if (right.classes.includes(cls)) score += 1;
  return score;
}

// src/host/domains/persistence/html/tokenizer.ts
function tokenizeHtml(html) {
  const tags = [];
  const skips = [];
  const length = html.length;
  let index = 0;
  while (index < length) {
    const lt = html.indexOf("<", index);
    if (lt < 0) break;
    if (html.startsWith("<!--", lt)) {
      const end2 = html.indexOf("-->", lt + 4);
      const stop = end2 < 0 ? length : end2 + 3;
      skips.push({ start: lt, end: stop });
      index = stop;
      continue;
    }
    if (html.startsWith("<![CDATA[", lt)) {
      const end2 = html.indexOf("]]>", lt + 9);
      const stop = end2 < 0 ? length : end2 + 3;
      skips.push({ start: lt, end: stop });
      index = stop;
      continue;
    }
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const end2 = html.indexOf(">", lt + 2);
      const stop = end2 < 0 ? length : end2 + 1;
      skips.push({ start: lt, end: stop });
      index = stop;
      continue;
    }
    if (html[lt + 1] === "/") {
      const match2 = /^<\/\s*([A-Za-z][A-Za-z0-9:._-]*)\s*>/.exec(html.slice(lt, Math.min(lt + 160, length)));
      if (!match2) {
        index = lt + 1;
        continue;
      }
      tags.push({
        name: match2[1].toLowerCase(),
        closing: true,
        start: lt,
        end: lt + match2[0].length,
        raw: match2[0],
        selfClosing: false,
        attrs: []
      });
      index = lt + match2[0].length;
      continue;
    }
    const match = /^<([A-Za-z][A-Za-z0-9:._-]*)/.exec(html.slice(lt, Math.min(lt + 160, length)));
    if (!match) {
      index = lt + 1;
      continue;
    }
    const name = match[1].toLowerCase();
    let cursor = lt + 1 + match[1].length;
    let quote = null;
    while (cursor < length) {
      const ch = html[cursor];
      if (quote !== null) {
        if (ch === "\\") {
          cursor += 2;
          continue;
        }
        if (ch === quote) quote = null;
        cursor += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        cursor += 1;
        continue;
      }
      if (ch === ">") break;
      cursor += 1;
    }
    if (cursor >= length) break;
    const end = cursor + 1;
    const raw = html.slice(lt, end);
    const selfClosing = /\/\s*>$/.test(raw);
    tags.push({ name, closing: false, start: lt, end, raw, selfClosing, attrs: parseAttributes(raw) });
    index = end;
    if (!selfClosing && RAW_TEXT_ELEMENTS.has(name)) {
      const closeRe = new RegExp("</\\s*" + name + "\\s*>", "i");
      const found = closeRe.exec(html.slice(end));
      if (found) {
        skips.push({ start: end, end: end + found.index });
        index = end + found.index;
      }
    }
  }
  return { tags, skips };
}
function parseAttributes(rawTag) {
  const attrs = [];
  const length = rawTag.length;
  let index = 1;
  while (index < length && !/[\s/>]/.test(rawTag[index])) index += 1;
  while (index < length) {
    while (index < length && /\s/.test(rawTag[index])) index += 1;
    if (index >= length) break;
    const ch = rawTag[index];
    if (ch === ">") break;
    if (ch === "/") {
      index += 1;
      continue;
    }
    const nameStart = index;
    while (index < length && !/[\s=/>]/.test(rawTag[index])) index += 1;
    const rawName = rawTag.slice(nameStart, index);
    if (rawName === "") {
      index += 1;
      continue;
    }
    const name = rawName.toLowerCase();
    let cursor = index;
    while (cursor < length && /\s/.test(rawTag[cursor])) cursor += 1;
    let value = null;
    let valueStart = -1;
    let valueEnd = -1;
    let quote = null;
    let equals = false;
    let end = index;
    if (cursor < length && rawTag[cursor] === "=") {
      equals = true;
      cursor += 1;
      while (cursor < length && /\s/.test(rawTag[cursor])) cursor += 1;
      if (cursor < length && (rawTag[cursor] === '"' || rawTag[cursor] === "'")) {
        quote = rawTag[cursor];
        valueStart = cursor + 1;
        const closeQuote = rawTag.indexOf(quote, valueStart);
        if (closeQuote < 0) {
          valueEnd = length;
          value = rawTag.slice(valueStart, length);
          end = length;
          index = length;
        } else {
          valueEnd = closeQuote;
          value = rawTag.slice(valueStart, closeQuote);
          end = closeQuote + 1;
          index = closeQuote + 1;
        }
      } else {
        valueStart = cursor;
        while (cursor < length && !/[\s>]/.test(rawTag[cursor])) cursor += 1;
        valueEnd = cursor;
        value = rawTag.slice(valueStart, valueEnd);
        end = cursor;
        index = cursor;
      }
    } else {
      end = index;
      index = cursor;
    }
    attrs.push({ name, rawName, nameStart, value, valueStart, valueEnd, quote, equals, end });
  }
  return attrs;
}
function attrValue(tag, name) {
  const lower = String(name).toLowerCase();
  const found = (tag.attrs || []).find((attr) => attr.name === lower);
  return found ? found.value : null;
}
function matchingCloseTagIndex(tags, openIndex, name) {
  let depth = 0;
  for (let index = openIndex; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag.name !== name) continue;
    if (tag.closing) {
      depth -= 1;
      if (depth === 0) return index;
    } else if (!tag.selfClosing) {
      depth += 1;
    }
  }
  return -1;
}
function elementRange(content, tags, openIndex) {
  const open = tags[openIndex];
  if (!open || open.closing) return null;
  if (open.selfClosing || VOID_ELEMENTS.has(open.name)) {
    return { tag: open, tagIndex: openIndex, innerStart: open.end, innerEnd: open.end, openStart: open.start, openEnd: open.end };
  }
  let depth = 1;
  for (let index = openIndex + 1; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag.name !== open.name) continue;
    if (tag.closing) {
      depth -= 1;
      if (depth === 0) {
        return {
          tag: open,
          tagIndex: openIndex,
          innerStart: open.end,
          innerEnd: tag.start,
          openStart: open.start,
          openEnd: open.end,
          closeStart: tag.start,
          closeEnd: tag.end
        };
      }
    } else if (!tag.selfClosing) {
      depth += 1;
    }
  }
  return null;
}
function findOpeningTagsByAttribute(tags, name, value) {
  const found = [];
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag.closing) continue;
    if (attrValue(tag, name) === value) found.push(index);
  }
  return found;
}
function textNodeRanges(container, tags, skips) {
  const blocked = [];
  for (const tag of tags) blocked.push([tag.start, tag.end]);
  for (const skip of skips) blocked.push([skip.start, skip.end]);
  blocked.sort((left, right) => left[0] - right[0]);
  const ranges = [];
  let cursor = 0;
  for (const [start, end] of blocked) {
    if (start > cursor) ranges.push({ start: cursor, end: start });
    if (end > cursor) cursor = end;
  }
  if (cursor < container.length) ranges.push({ start: cursor, end: container.length });
  return ranges;
}
function buildElementIndex(tags) {
  const parents = new Array(tags.length).fill(-1);
  const childrenOf = /* @__PURE__ */ new Map();
  childrenOf.set(-1, []);
  const stack = [];
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag.closing) {
      for (let cursor = stack.length - 1; cursor >= 0; cursor -= 1) {
        if (tags[stack[cursor]].name === tag.name) {
          stack.length = cursor;
          break;
        }
      }
      continue;
    }
    const parent = stack.length > 0 ? stack[stack.length - 1] : -1;
    parents[index] = parent;
    const bucket = childrenOf.get(parent);
    if (bucket) bucket.push(index);
    else childrenOf.set(parent, [index]);
    if (!tag.selfClosing && !VOID_ELEMENTS.has(tag.name)) stack.push(index);
  }
  return { parents, childrenOf };
}
function collectTagIndexes(tags, name) {
  const found = [];
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (!tag.closing && !tag.selfClosing && tag.name === name) found.push(index);
  }
  return found;
}
function attributeSignature(attrs) {
  return (attrs || []).map((attr) => attr.name + "=" + (attr.value === null || attr.value === void 0 ? "" : String(attr.value))).sort().join("");
}

// src/host/domains/persistence/shared/text.ts
function diffText(before, after) {
  if (typeof before !== "string" || typeof after !== "string") return null;
  let prefix = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  const maxSuffix = Math.min(before.length, after.length) - prefix;
  while (suffix < maxSuffix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  return {
    oldText: before.slice(prefix, before.length - suffix),
    newText: after.slice(prefix, after.length - suffix),
    prefix,
    suffix
  };
}
function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body) => {
    const decoded = decodeEntity("&" + body + ";");
    return decoded === null ? whole : decoded;
  });
}
function decodeEntitiesWithMap(raw) {
  const chars = [];
  const starts = [];
  const ends = [];
  let index = 0;
  while (index < raw.length) {
    if (raw[index] === "&") {
      const semi = raw.indexOf(";", index + 1);
      if (semi > index && semi - index <= 12) {
        const decoded = decodeEntity(raw.slice(index, semi + 1));
        if (decoded !== null) {
          for (const ch of decoded) {
            chars.push(ch);
            starts.push(index);
            ends.push(semi + 1);
          }
          index = semi + 1;
          continue;
        }
      }
    }
    chars.push(raw[index]);
    starts.push(index);
    ends.push(index + 1);
    index += 1;
  }
  return { text: chars.join(""), start: starts, end: ends };
}
function decodeEntity(entity) {
  const named = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": "\xA0"
  };
  if (Object.prototype.hasOwnProperty.call(named, entity)) return named[entity];
  const numeric = /^&#(x?)([0-9a-fA-F]+);$/.exec(entity);
  if (numeric) {
    const code = parseInt(numeric[2], numeric[1] ? 16 : 10);
    if (Number.isFinite(code) && code >= 0 && code <= 1114111) {
      try {
        return String.fromCodePoint(code);
      } catch {
        return null;
      }
    }
  }
  return null;
}
function escapeHtmlText(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttributeValue(value, quote) {
  const q = quote === "'" ? "'" : '"';
  let text = String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  text = q === '"' ? text.replace(/"/g, "&quot;") : text.replace(/'/g, "&#39;");
  return text;
}
function stripMarkup(fragment) {
  return decodeEntities(
    String(fragment).replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " ")
  );
}
function normalizeWhitespaceText(text) {
  return String(text).replace(/\s+/g, " ").trim();
}
function compactText(text) {
  return String(text).replace(/\s+/g, "");
}
function normalizeWhitespaceWithMap(text) {
  const chars = [];
  const map = [];
  let pendingSpace = -1;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const ch = text[index];
    const isSpace = code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11;
    if (isSpace) {
      if (pendingSpace < 0) pendingSpace = index;
      continue;
    }
    if (pendingSpace >= 0 && chars.length > 0) {
      chars.push(" ");
      map.push(pendingSpace);
    }
    pendingSpace = -1;
    chars.push(ch);
    map.push(index);
  }
  return { text: chars.join(""), map };
}
function normalizeSelector(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "" || text.length > 500) return null;
  if (/[;{}]/.test(text)) return null;
  if (text.includes("/*") || text.includes("*/") || text.includes("\0")) return null;
  if (/<\/?[A-Za-z]/.test(text)) return null;
  return text;
}
function normalizeProperty(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "" || text.length > 128) return null;
  if (/[;{}<>]/.test(text) || text.includes("/*") || text.includes("\0")) return null;
  if (text.startsWith("--")) return text;
  const kebab = text.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()).toLowerCase();
  if (!/^-?[a-z][a-z0-9-]*$/.test(kebab)) return null;
  return kebab;
}
function normalizeStyleValue(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "" || text.length > 1e3) return null;
  if (/[;{}<>]/.test(text) || text.includes("/*") || text.includes("\0")) return null;
  if (/<\/style/i.test(text)) return null;
  return text;
}

// src/host/domains/persistence/html/locate.ts
var REASON_UNRESOLVED = "unresolved-element";
var REASON_AMBIGUOUS = "ambiguous-element";
var REASON_PATH_MISMATCH = "path-mismatch";
function locateElementDetailed(content, edit) {
  const { tags } = tokenizeHtml(content);
  const descriptor = edit && typeof edit === "object" ? edit : {};
  const selector = typeof descriptor.selector === "string" ? descriptor.selector : "";
  const outerHTML = typeof descriptor.outerHTML === "string" ? descriptor.outerHTML : "";
  let ambiguous = false;
  const byId = locateById(content, tags, selector, outerHTML);
  if (byId.range) return { range: byId.range, reason: null };
  if (byId.ambiguous) ambiguous = true;
  if (outerHTML) {
    const byOuter = locateByOuterHtml(content, tags, outerHTML);
    if (byOuter.range) return { range: byOuter.range, reason: null };
    if (byOuter.ambiguous) ambiguous = true;
  }
  const byText = locateByTextBefore(content, tags, descriptor);
  if (byText.range) return { range: byText.range, reason: null };
  if (byText.ambiguous) ambiguous = true;
  const byPath = locateByPath(content, tags, descriptor);
  if (byPath.range) return { range: byPath.range, reason: null };
  if (byPath.reason === REASON_PATH_MISMATCH) return { range: null, reason: REASON_PATH_MISMATCH };
  return { range: null, reason: ambiguous ? REASON_AMBIGUOUS : REASON_UNRESOLVED };
}
function locateElement(content, edit) {
  return locateElementDetailed(content, edit).range;
}
function locateById(content, tags, selector, outerHTML) {
  const idCandidates = [];
  if (outerHTML) {
    const outerOpen = tokenizeHtml(outerHTML).tags.find((tag) => !tag.closing);
    if (outerOpen) {
      const id = attrValue(outerOpen, "id");
      if (id) idCandidates.push(id);
    }
  }
  const selectorTokens = compoundTokens(lastCompound(canonicalSelector(selector)));
  if (selectorTokens.ids.length > 0) idCandidates.push(selectorTokens.ids[selectorTokens.ids.length - 1]);
  const seenIds = /* @__PURE__ */ new Set();
  let ambiguous = false;
  for (const id of idCandidates) {
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const found = findOpeningTagsByAttribute(tags, "id", id);
    if (found.length > 1) ambiguous = true;
    if (found.length !== 1) continue;
    const range = elementRange(content, tags, found[0]);
    if (range) return { range, ambiguous: false };
  }
  return { range: null, ambiguous };
}
function locateByOuterHtml(content, tags, outerHTML) {
  const normalizedTarget = normalizeWhitespaceText(outerHTML);
  let ambiguous = false;
  if (normalizedTarget) {
    const normalizedContent = normalizeWhitespaceWithMap(content);
    const needles = [normalizedTarget];
    if (normalizedTarget.length > 200) needles.push(normalizedTarget.slice(0, 200));
    if (normalizedTarget.length > 80) needles.push(normalizedTarget.slice(0, 80));
    for (const needle of needles) {
      const first = normalizedContent.text.indexOf(needle);
      if (first < 0) continue;
      if (normalizedContent.text.indexOf(needle, first + 1) >= 0) {
        ambiguous = true;
        continue;
      }
      const rawIndex = normalizedContent.map[first];
      if (typeof rawIndex !== "number") continue;
      const tagIndex = tags.findIndex((tag) => !tag.closing && tag.start === rawIndex);
      if (tagIndex < 0) continue;
      const range = elementRange(content, tags, tagIndex);
      if (range) return { range, ambiguous: false };
    }
  }
  const outerOpen = tokenizeHtml(outerHTML).tags.find((tag) => !tag.closing);
  if (!outerOpen) return { range: null, ambiguous };
  const signature = attributeSignature(outerOpen.attrs);
  const matches = [];
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag.closing || tag.selfClosing || tag.name !== outerOpen.name) continue;
    if (attributeSignature(tag.attrs) === signature) matches.push(index);
  }
  if (matches.length === 1) {
    const range = elementRange(content, tags, matches[0]);
    if (range) return { range, ambiguous: false };
  }
  if (matches.length > 1) ambiguous = true;
  const outerText = normalizeWhitespaceText(stripMarkup(outerHTML)).slice(0, 40);
  if (outerText.length >= 8) {
    const pool = matches.length > 0 ? matches : collectTagIndexes(tags, outerOpen.name);
    const textMatches = [];
    for (const candidateIndex of pool) {
      const range = elementRange(content, tags, candidateIndex);
      if (!range) continue;
      const text = normalizeWhitespaceText(stripMarkup(content.slice(range.innerStart, range.innerEnd)));
      if (text.startsWith(outerText)) textMatches.push(candidateIndex);
      if (textMatches.length > 1) break;
    }
    if (textMatches.length === 1) {
      const range = elementRange(content, tags, textMatches[0]);
      if (range) return { range, ambiguous: false };
    }
    if (textMatches.length > 1) ambiguous = true;
  }
  return { range: null, ambiguous };
}
function locateByTextBefore(content, tags, edit) {
  const before = typeof edit.textBefore === "string" ? edit.textBefore : "";
  if (before.trim() === "") return { range: null, ambiguous: false };
  const target = normalizeWhitespaceText(before);
  const tokens = compoundTokens(lastCompound(canonicalSelector(typeof edit.selector === "string" ? edit.selector : "")));
  const strong = [];
  const weak = [];
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag.closing || tag.selfClosing || VOID_ELEMENTS.has(tag.name)) continue;
    const id = attrValue(tag, "id");
    const classAttr = attrValue(tag, "class");
    const classes = classAttr ? classAttr.split(/\s+/).filter(Boolean) : [];
    const tokenMatch = tokens.ids.length === 0 && tokens.classes.length === 0 ? true : id !== null && tokens.ids.includes(id) || tokens.classes.some((cls) => classes.includes(cls));
    if (!tokenMatch) continue;
    const range = elementRange(content, tags, index);
    if (!range) continue;
    const text = normalizeWhitespaceText(stripMarkup(content.slice(range.innerStart, range.innerEnd)));
    if (text === target) strong.push(index);
    else if (text.includes(target)) weak.push(index);
  }
  if (strong.length === 1) {
    const range = elementRange(content, tags, strong[0]);
    if (range) return { range, ambiguous: false };
  }
  if (strong.length === 0 && weak.length === 1) {
    const range = elementRange(content, tags, weak[0]);
    if (range) return { range, ambiguous: false };
  }
  return { range: null, ambiguous: strong.length > 1 || weak.length > 1 };
}
function locateByPath(content, tags, edit) {
  const rawPath = Array.isArray(edit.path) ? edit.path : null;
  if (!rawPath || rawPath.length === 0) return { range: null, reason: null };
  const steps = [];
  for (const raw of rawPath) {
    const step = Number(raw);
    if (!Number.isFinite(step) || Math.floor(step) !== step) return { range: null, reason: null };
    if (step < 0) return { range: null, reason: null };
    steps.push(step);
  }
  const index = buildElementIndex(tags);
  const roots = index.childrenOf.get(-1) || [];
  let current = roots.find((rootIndex) => tags[rootIndex].name === "html");
  if (current === void 0) return { range: null, reason: null };
  for (const step of steps) {
    const children = index.childrenOf.get(current) || [];
    if (step >= children.length) return { range: null, reason: null };
    current = children[step];
  }
  const range = elementRange(content, tags, current);
  if (!range) return { range: null, reason: null };
  if (!structureMatchesOuterHtml(content, range, edit.outerHTML)) return { range: null, reason: REASON_PATH_MISMATCH };
  return { range, reason: null };
}
function structureMatchesOuterHtml(content, range, outerHTML) {
  if (typeof outerHTML !== "string" || outerHTML.trim() === "") return true;
  const outerOpen = tokenizeHtml(outerHTML).tags.find((tag) => !tag.closing);
  if (outerOpen && range.tag && range.tag.name !== outerOpen.name) return false;
  const truncated = /\u2026$/.test(outerHTML);
  const targetText = normalizeWhitespaceText(stripMarkup(truncated ? outerHTML.slice(0, -1) : outerHTML));
  const candidateText = normalizeWhitespaceText(stripMarkup(content.slice(range.innerStart, range.innerEnd)));
  if (targetText === "" || candidateText === "") return true;
  if (targetText.length < 8 || candidateText.length < 8) return true;
  if (candidateText.indexOf(targetText) >= 0 || targetText.indexOf(candidateText) >= 0) return true;
  if (truncated) {
    const head = targetText.slice(0, Math.min(60, targetText.length));
    if (head.length >= 8 && candidateText.indexOf(head) >= 0) return true;
  }
  return false;
}

// src/host/domains/persistence/shared/paths.ts
import { isAbsolute, relative, sep } from "node:path";
function lineAt(text, index) {
  if (typeof index !== "number" || !Number.isFinite(index) || index < 0) return void 0;
  const limit = Math.min(text.length, Math.floor(index));
  let line = 1;
  for (let cursor = 0; cursor < limit; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}
function newlineOf(content) {
  return content.includes("\r\n") ? "\r\n" : "\n";
}
function extensionOf(path) {
  const base = String(path).split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}
function editId(edit) {
  return String((edit && edit.id) !== void 0 && (edit && edit.id) !== null ? edit.id : "");
}
function pathOf(fs, target) {
  try {
    if (target && typeof fs.processPath === "function") return fs.processPath(target);
  } catch {
  }
  if (target && typeof target === "object" && typeof target.path === "string") return target.path;
  return String(target);
}
async function statOrUndefined(fs, target) {
  try {
    return await fs.stat(target);
  } catch {
    return void 0;
  }
}
function workspaceRelative(ctx, target) {
  return relativePosix(ctx.cwdPath, pathOf(ctx.fs, target));
}
function relativePosix(from, to) {
  if (typeof from !== "string" || typeof to !== "string") return "";
  const rel = relative(from, to);
  if (!rel || rel === "" || rel.startsWith("..") || isAbsolute(rel)) return "";
  return rel.split(sep).join("/");
}
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function reasonOf(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

// src/host/domains/persistence/edits/markup.ts
function applyMarkupTextEdit(content, edit) {
  const textAfter = typeof edit.textAfter === "string" ? edit.textAfter : typeof edit.after === "string" ? edit.after : null;
  if (textAfter === null) return { ok: false, reason: "invalid-edit" };
  const located = locateElementDetailed(content, edit);
  if (!located.range) return { ok: false, reason: located.reason || "unresolved-element" };
  const element = located.range;
  const innerStart = element.innerStart;
  const innerEnd = element.innerEnd;
  const inner = content.slice(innerStart, innerEnd);
  const { tags: innerTags, skips: innerSkips } = tokenizeHtml(inner);
  const hasChildTags = innerTags.some((tag) => !tag.closing);
  const beforeText = typeof edit.textBefore === "string" ? edit.textBefore : "";
  if (!hasChildTags) {
    const decoded = decodeEntities(inner);
    if (beforeText !== "" && normalizeWhitespaceText(decoded) !== normalizeWhitespaceText(beforeText)) {
      return { ok: false, reason: "unresolved-element" };
    }
    const leading = /^[ \t\r\n]*/.exec(inner)[0];
    const trailing = /[ \t\r\n]*$/.exec(inner)[0];
    const newInner = leading + escapeHtmlText(textAfter) + trailing;
    return finishTextEdit(content, innerStart, innerEnd, inner, newInner);
  }
  const textNodes = textNodeRanges(inner, innerTags, innerSkips);
  if (beforeText !== "") {
    const diff = diffText(beforeText, textAfter);
    if (diff && diff.oldText === "" && diff.newText === "") return { ok: true, content, changed: false, lineIndex: innerStart };
    if (diff && diff.oldText !== "") {
      const collectHits = (needle, flexible) => {
        const hits2 = [];
        const pattern = flexible ? new RegExp(escapeRegExp(needle).replace(/ /g, "\\s+"), "g") : null;
        for (const node of textNodes) {
          const rawNode = inner.slice(node.start, node.end);
          if (!rawNode.trim()) continue;
          const decoded = decodeEntitiesWithMap(rawNode);
          if (!flexible) {
            let found = decoded.text.indexOf(needle);
            while (found >= 0) {
              const lastIndex = found + needle.length - 1;
              hits2.push({ rawStart: node.start + decoded.start[found], rawEnd: node.start + decoded.end[lastIndex] });
              if (hits2.length > 1) break;
              found = decoded.text.indexOf(needle, found + 1);
            }
          } else {
            pattern.lastIndex = 0;
            let match = pattern.exec(decoded.text);
            while (match) {
              const lastIndex = match.index + match[0].length - 1;
              hits2.push({ rawStart: node.start + decoded.start[match.index], rawEnd: node.start + decoded.end[lastIndex] });
              if (hits2.length > 1) break;
              match = pattern.exec(decoded.text);
            }
          }
          if (hits2.length > 1) break;
        }
        return hits2;
      };
      let hits = collectHits(diff.oldText, false);
      if (hits.length === 0) hits = collectHits(diff.oldText, true);
      if (hits.length === 1) {
        const hit = hits[0];
        const newInner = inner.slice(0, hit.rawStart) + escapeHtmlText(diff.newText) + inner.slice(hit.rawEnd);
        return finishTextEdit(content, innerStart, innerEnd, inner, newInner);
      }
    }
    if (diff && diff.oldText === "" && diff.newText !== "") {
      let consumed = 0;
      let rawPosition = -1;
      for (const node of textNodes) {
        const rawNode = inner.slice(node.start, node.end);
        const decoded = decodeEntitiesWithMap(rawNode);
        const nodeLength = decoded.text.length;
        if (diff.prefix <= consumed + nodeLength) {
          const offset = diff.prefix - consumed;
          rawPosition = offset < nodeLength ? node.start + decoded.start[offset] : node.end;
          break;
        }
        consumed += nodeLength;
      }
      if (rawPosition >= 0 && rawPosition <= inner.length) {
        const newInner = inner.slice(0, rawPosition) + escapeHtmlText(diff.newText) + inner.slice(rawPosition);
        const proposed = compactText(stripMarkup(newInner));
        if (proposed === compactText(textAfter)) {
          return finishTextEdit(content, innerStart, innerEnd, inner, newInner);
        }
      }
    }
  }
  const meaningful = textNodes.filter((node) => inner.slice(node.start, node.end).trim() !== "");
  if (meaningful.length === 1) {
    const node = meaningful[0];
    const rawNode = inner.slice(node.start, node.end);
    const decoded = decodeEntities(rawNode);
    if (beforeText === "" || normalizeWhitespaceText(decoded) === normalizeWhitespaceText(beforeText)) {
      const leading = /^[ \t\r\n]*/.exec(rawNode)[0];
      const trailing = /[ \t\r\n]*$/.exec(rawNode)[0];
      const newInner = inner.slice(0, node.start) + leading + escapeHtmlText(textAfter) + trailing + inner.slice(node.end);
      return finishTextEdit(content, innerStart, innerEnd, inner, newInner);
    }
  }
  if (beforeText !== "") {
    const target = normalizeWhitespaceText(beforeText);
    const whole = textNodes.filter((node) => normalizeWhitespaceText(decodeEntities(inner.slice(node.start, node.end))) === target);
    if (whole.length === 1) {
      const node = whole[0];
      const rawNode = inner.slice(node.start, node.end);
      const leading = /^[ \t\r\n]*/.exec(rawNode)[0];
      const trailing = /[ \t\r\n]*$/.exec(rawNode)[0];
      const newInner = inner.slice(0, node.start) + leading + escapeHtmlText(textAfter) + trailing + inner.slice(node.end);
      return finishTextEdit(content, innerStart, innerEnd, inner, newInner);
    }
  }
  return { ok: false, reason: "unresolved-element" };
}
function finishTextEdit(content, innerStart, innerEnd, oldInner, newInner) {
  const next = content.slice(0, innerStart) + newInner + content.slice(innerEnd);
  const leading = /^[ \t\r\n]*/.exec(newInner);
  return {
    ok: true,
    content: next,
    changed: next !== content,
    lineIndex: innerStart + (leading ? leading[0].length : 0)
  };
}
function applyMarkupAttrEdit(content, edit) {
  const name = typeof edit.attrName === "string" ? edit.attrName.trim() : "";
  if (!name) return { ok: false, reason: "invalid-edit" };
  const lowerName = name.toLowerCase();
  if (lowerName.startsWith("on")) return { ok: false, reason: "unsafe-attribute" };
  if (lowerName === "style") return { ok: false, reason: "unsupported-attribute" };
  if (lowerName === "srcdoc") return { ok: false, reason: "unsafe-attribute" };
  const removal = edit.attrAfter === null;
  if (!removal && typeof edit.attrAfter !== "string") return { ok: false, reason: "invalid-edit" };
  if (!removal && URL_ATTRIBUTES.has(lowerName) && isScriptUrl(edit.attrAfter)) return { ok: false, reason: "unsafe-attribute" };
  const located = locateElementDetailed(content, edit);
  if (!located.range) return { ok: false, reason: located.reason || "unresolved-element" };
  const element = located.range;
  const tag = element.tag;
  const existing = (tag.attrs || []).find((attr) => attr.name === lowerName);
  if (existing) {
    const absoluteNameStart = tag.start + existing.nameStart;
    const absoluteEnd = tag.start + existing.end;
    if (removal) {
      let removeStart = absoluteNameStart;
      while (removeStart > tag.start && /\s/.test(content[removeStart - 1])) removeStart -= 1;
      return {
        ok: true,
        content: content.slice(0, removeStart) + content.slice(absoluteEnd),
        changed: true,
        lineIndex: removeStart
      };
    }
    if (existing.equals && existing.value !== null) {
      const quote = existing.quote === "'" ? "'" : '"';
      const escaped = escapeAttributeValue(edit.attrAfter, quote);
      const valueStart = tag.start + existing.valueStart;
      const valueEnd = tag.start + existing.valueEnd;
      return {
        ok: true,
        content: content.slice(0, valueStart) + escaped + content.slice(valueEnd),
        changed: escaped !== existing.value,
        lineIndex: valueStart
      };
    }
    const insertion2 = '="' + escapeAttributeValue(edit.attrAfter, '"') + '"';
    return {
      ok: true,
      content: content.slice(0, absoluteEnd) + insertion2 + content.slice(absoluteEnd),
      changed: true,
      lineIndex: absoluteEnd
    };
  }
  if (removal) return { ok: true, content, changed: false, lineIndex: tag.start };
  let insertAt = tag.end - 1;
  const rawTag = tag.raw;
  let cursor = rawTag.length - 2;
  while (cursor >= 0 && /\s/.test(rawTag[cursor])) cursor -= 1;
  if (rawTag[cursor] === "/") insertAt = tag.start + cursor;
  const needsSpace = insertAt > tag.start && !/\s/.test(content[insertAt - 1]);
  const insertion = (needsSpace ? " " : "") + name + '="' + escapeAttributeValue(edit.attrAfter, '"') + '"';
  return {
    ok: true,
    content: content.slice(0, insertAt) + insertion + content.slice(insertAt),
    changed: true,
    lineIndex: insertAt
  };
}
function isScriptUrl(value) {
  const text = String(value).replace(/[\u0000-\u0020]+/g, "").toLowerCase();
  return text.startsWith("javascript:") || text.startsWith("vbscript:") || text.startsWith("data:text/html") || text.startsWith("data:image/svg+xml");
}
var STRUCTURE_PROTECTED_TAGS = /* @__PURE__ */ new Set(["html", "head", "body"]);
var STRUCTURE_UNSUPPORTED_PARENT_TAGS = /* @__PURE__ */ new Set(["html", "head", "script", "style", "textarea", "title"]);
function structureExtent(range) {
  const end = typeof range.closeEnd === "number" ? range.closeEnd : range.openEnd;
  return { start: range.openStart, end };
}
function lineStartAt(content, index) {
  const found = content.lastIndexOf("\n", Math.max(0, index - 1));
  return found < 0 ? 0 : found + 1;
}
function lineEndAt(content, index) {
  const found = content.indexOf("\n", index);
  return found < 0 ? content.length : found;
}
function indentAt(content, index) {
  const start = lineStartAt(content, index);
  const prefix = content.slice(start, index);
  return /^[ \t]*$/.test(prefix) ? prefix : "";
}
function cutWithLineCleanup(content, start, end) {
  const startLine = lineStartAt(content, start);
  const endLine = lineEndAt(content, end);
  const prefixBlank = /^[ \t\r]*$/.test(content.slice(startLine, start));
  const suffixBlank = /^[ \t\r]*$/.test(content.slice(end, endLine));
  if (prefixBlank && suffixBlank) {
    const removeEnd = endLine < content.length ? endLine + 1 : endLine;
    return {
      content: content.slice(0, startLine) + content.slice(removeEnd),
      start: startLine,
      end: removeEnd,
      lineIndex: startLine
    };
  }
  let trimStart = start;
  while (trimStart > startLine && /[ \t]/.test(content[trimStart - 1])) trimStart -= 1;
  let trimEnd = end;
  while (trimEnd < endLine && /[ \t]/.test(content[trimEnd])) trimEnd += 1;
  let cutStart = start;
  let cutEnd = end;
  if (trimStart < start && trimEnd > end) {
    cutStart = trimStart + 1;
    cutEnd = trimEnd;
  }
  return {
    content: content.slice(0, cutStart) + content.slice(cutEnd),
    start: cutStart,
    end: cutEnd,
    lineIndex: cutStart
  };
}
function elementParentIndexes(tags) {
  const parents = new Array(tags.length).fill(-1);
  const stack = [];
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag.closing) {
      for (let cursor = stack.length - 1; cursor >= 0; cursor -= 1) {
        if (tags[stack[cursor]].name === tag.name) {
          stack.length = cursor;
          break;
        }
      }
      continue;
    }
    parents[index] = stack.length > 0 ? stack[stack.length - 1] : -1;
    if (!tag.selfClosing && !VOID_ELEMENTS.has(tag.name)) stack.push(index);
  }
  return parents;
}
function nextSiblingIndexOf(tags, parents, index) {
  const parent = parents[index];
  for (let cursor = index + 1; cursor < tags.length; cursor += 1) {
    if (parents[cursor] !== parent) continue;
    if (tags[cursor].closing) continue;
    return cursor;
  }
  return -1;
}
function reindentSnippet(snippet, fromIndent, toIndent) {
  if (snippet.indexOf("\n") < 0 || fromIndent === toIndent) return snippet;
  const lines = snippet.split("\n");
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") {
      lines[index] = "";
      continue;
    }
    if (fromIndent !== "" && line.indexOf(fromIndent) === 0) lines[index] = toIndent + line.slice(fromIndent.length);
    else if (fromIndent === "") lines[index] = toIndent + line;
  }
  return lines.join("\n");
}
function applyMarkupRemoveEdit(content, edit) {
  const located = locateElementDetailed(content, edit);
  if (!located.range) return { ok: false, reason: located.reason || "unresolved-element" };
  const range = located.range;
  const tag = range.tag && range.tag.name ? range.tag.name : "";
  if (STRUCTURE_PROTECTED_TAGS.has(tag)) return { ok: false, reason: "protected-element" };
  const extent = structureExtent(range);
  const cut = cutWithLineCleanup(content, extent.start, extent.end);
  return { ok: true, content: cut.content, changed: cut.content !== content, lineIndex: cut.lineIndex };
}
function applyMarkupMoveEdit(content, edit) {
  const sourceLocated = locateElementDetailed(content, edit);
  if (!sourceLocated.range) return { ok: false, reason: sourceLocated.reason || "unresolved-element" };
  const sourceRange = sourceLocated.range;
  const sourceTag = sourceRange.tag && sourceRange.tag.name ? sourceRange.tag.name : "";
  if (STRUCTURE_PROTECTED_TAGS.has(sourceTag)) return { ok: false, reason: "protected-element" };
  const { tags } = tokenizeHtml(content);
  const parents = elementParentIndexes(tags);
  const sourceIndex = sourceRange.tagIndex;
  const sourceParentIndex = parents[sourceIndex];
  const parentSpec = {
    selector: typeof edit.targetParentSelector === "string" ? edit.targetParentSelector : "",
    outerHTML: typeof edit.targetParentOuterHTML === "string" ? edit.targetParentOuterHTML : "",
    textBefore: typeof edit.targetParentTextBefore === "string" ? edit.targetParentTextBefore : ""
  };
  const parentRange = locateElement(content, parentSpec);
  if (!parentRange) return { ok: false, reason: "unresolved-target-parent" };
  const parentTag = parentRange.tag && parentRange.tag.name ? parentRange.tag.name : "";
  if (parentTag === "html") return { ok: false, reason: "protected-element" };
  if (STRUCTURE_UNSUPPORTED_PARENT_TAGS.has(parentTag)) return { ok: false, reason: "unsupported-target-parent" };
  if (typeof parentRange.closeStart !== "number") return { ok: false, reason: "unsupported-target-parent" };
  const parentIndex = parentRange.tagIndex;
  if (parentIndex === sourceIndex) return { ok: false, reason: "invalid-move-target" };
  for (let cursor = parentIndex; cursor >= 0; cursor = parents[cursor]) {
    if (cursor === sourceIndex) return { ok: false, reason: "invalid-move-target" };
  }
  const beforeSelector = typeof edit.beforeSelector === "string" ? edit.beforeSelector.trim() : "";
  let anchorRange = null;
  let anchorIndex = -1;
  if (beforeSelector !== "") {
    const anchorSpec = {
      selector: beforeSelector,
      outerHTML: typeof edit.beforeOuterHTML === "string" ? edit.beforeOuterHTML : "",
      textBefore: typeof edit.beforeTextBefore === "string" ? edit.beforeTextBefore : ""
    };
    anchorRange = locateElement(content, anchorSpec);
    if (!anchorRange) return { ok: false, reason: "unresolved-target-anchor" };
    anchorIndex = anchorRange.tagIndex;
    if (anchorIndex === sourceIndex) return { ok: true, content, changed: false, lineIndex: sourceRange.openStart };
    if (parents[anchorIndex] !== parentIndex) return { ok: false, reason: "invalid-move-target" };
  } else if (sourceParentIndex === parentIndex && nextSiblingIndexOf(tags, parents, sourceIndex) < 0) {
    return { ok: true, content, changed: false, lineIndex: sourceRange.openStart };
  }
  if (anchorIndex >= 0 && sourceParentIndex === parentIndex && nextSiblingIndexOf(tags, parents, sourceIndex) === anchorIndex) {
    return { ok: true, content, changed: false, lineIndex: sourceRange.openStart };
  }
  const extent = structureExtent(sourceRange);
  const snippet = content.slice(extent.start, extent.end);
  const sourceIndent = indentAt(content, extent.start);
  let destIndent = "";
  let insertAt = 0;
  let insertionText = "";
  if (anchorRange) {
    destIndent = indentAt(content, anchorRange.openStart);
    const anchorLineStart = lineStartAt(content, anchorRange.openStart);
    const anchorLinePrefix = content.slice(anchorLineStart, anchorRange.openStart);
    const reindented = reindentSnippet(snippet, sourceIndent, destIndent);
    if (/^[ \t]*$/.test(anchorLinePrefix)) {
      insertAt = anchorLineStart;
      insertionText = destIndent + reindented + "\n";
    } else {
      insertAt = anchorRange.openStart;
      insertionText = reindented;
    }
  } else {
    let firstChild = -1;
    for (let cursor = 0; cursor < tags.length; cursor += 1) {
      if (parents[cursor] !== parentIndex) continue;
      if (tags[cursor].closing) continue;
      firstChild = cursor;
      break;
    }
    const closeLineStart = lineStartAt(content, parentRange.closeStart);
    const closeIndent = indentAt(content, parentRange.closeStart);
    const closeLinePrefix = content.slice(closeLineStart, parentRange.closeStart);
    destIndent = firstChild >= 0 ? indentAt(content, tags[firstChild].start) : closeIndent + "  ";
    const reindented = reindentSnippet(snippet, sourceIndent, destIndent);
    if (/^[ \t]*$/.test(closeLinePrefix)) {
      insertAt = closeLineStart;
      insertionText = destIndent + reindented + "\n";
    } else {
      insertAt = parentRange.closeStart;
      insertionText = reindented;
    }
  }
  const cut = cutWithLineCleanup(content, extent.start, extent.end);
  let mapped = insertAt;
  if (mapped >= cut.end) mapped = insertAt - (cut.end - cut.start);
  else if (mapped > cut.start) mapped = cut.start;
  const next = cut.content.slice(0, mapped) + insertionText + cut.content.slice(mapped);
  if (next === content) return { ok: true, content, changed: false, lineIndex: sourceRange.openStart };
  return { ok: true, content: next, changed: true, lineIndex: Math.min(cut.lineIndex, mapped) };
}

// src/host/domains/persistence/css/patch.ts
function deleteDeclarations(body, property) {
  const segments = scanDeclarationSegments(body);
  const matches = [];
  for (const segment of segments) {
    const colon = findTopLevelColon(body, segment.start, segment.end);
    if (colon < 0) continue;
    if (!sameProperty(body.slice(segment.start, colon).trim(), property)) continue;
    matches.push(segment);
  }
  if (matches.length === 0) return { body, changed: false, index: 0 };
  let text = body;
  let firstIndex = 0;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const segment = matches[index];
    let end = segment.end;
    if (text[end] === ";") end += 1;
    text = text.slice(0, segment.start) + text.slice(end);
    firstIndex = segment.start;
  }
  return { body: text, changed: true, index: firstIndex };
}
function removeCssDeclaration(cssText, selectorText, property) {
  const rules = scanCssRules(cssText);
  const target = canonicalSelector(selectorText);
  const exact = [];
  for (let index = 0; index < rules.length; index += 1) {
    if (canonicalSelector(rules[index].selector) === target) exact.push(index);
  }
  if (exact.length === 0) return { ok: true, text: cssText, changed: false, index: 0 };
  let text = cssText;
  let changed = false;
  let firstIndex = 0;
  for (let k = exact.length - 1; k >= 0; k -= 1) {
    const rule = rules[exact[k]];
    const bodyStart = rule.openBrace + 1;
    const bodyEnd = rule.closeBrace;
    const body = text.slice(bodyStart, bodyEnd);
    const removed = deleteDeclarations(body, property);
    if (k === 0) firstIndex = bodyStart + removed.index;
    if (!removed.changed) continue;
    changed = true;
    const stripped = removed.body.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (stripped === "") {
      text = text.slice(0, rule.selectorStart) + text.slice(bodyEnd + 1);
    } else {
      text = text.slice(0, bodyStart) + removed.body + text.slice(bodyEnd);
    }
  }
  return { ok: true, text, changed, index: firstIndex };
}
function applyCssRule(cssText, selectorText, property, value, options = {}) {
  const nl = options.nl || "\n";
  const rules = scanCssRules(cssText);
  const target = canonicalSelector(selectorText);
  const exactRules = [];
  for (let index2 = 0; index2 < rules.length; index2 += 1) {
    if (canonicalSelector(rules[index2].selector) === target) exactRules.push(index2);
  }
  if (exactRules.length > 0) {
    let text2 = cssText;
    let changed = false;
    let firstIndex = -1;
    for (let k = exactRules.length - 1; k >= 0; k -= 1) {
      const rule = rules[exactRules[k]];
      const bodyStart = rule.openBrace + 1;
      const bodyEnd = rule.closeBrace;
      const ruleBody = text2.slice(bodyStart, bodyEnd);
      const updated = updateDeclarations(ruleBody, property, value, nl);
      if (updated.changed) changed = true;
      if (k === 0) firstIndex = bodyStart + updated.index;
      text2 = text2.slice(0, bodyStart) + updated.body + text2.slice(bodyEnd);
    }
    return { ok: true, text: text2, changed, index: firstIndex };
  }
  if (options.allowCompound !== false) {
    const targetTokens = compoundTokens(lastCompound(target));
    const candidates = [];
    for (let index2 = 0; index2 < rules.length; index2 += 1) {
      const parts = splitSelectorParts(rules[index2].selector);
      if (parts.length !== 1) continue;
      const ruleTokens = compoundTokens(lastCompound(canonicalSelector(parts[0])));
      const score = compoundOverlap(ruleTokens, targetTokens);
      if (score > 0) candidates.push({ index: index2, score });
    }
    if (candidates.length > 0) {
      candidates.sort((left, right) => right.score - left.score);
      if (candidates.length > 1 && candidates[0].score === candidates[1].score) return { ok: false, reason: "ambiguous-selector" };
      const rule = rules[candidates[0].index];
      const bodyStart = rule.openBrace + 1;
      const bodyEnd = rule.closeBrace;
      const ruleBody = cssText.slice(bodyStart, bodyEnd);
      const updated = updateDeclarations(ruleBody, property, value, nl);
      return {
        ok: true,
        text: cssText.slice(0, bodyStart) + updated.body + cssText.slice(bodyEnd),
        changed: updated.changed,
        index: bodyStart + updated.index
      };
    }
  }
  if (options.mode === "block") {
    let text2 = cssText;
    if (text2.length > 0 && !text2.endsWith("\n")) text2 += nl;
    else if (text2.length === 0) text2 = nl;
    const index2 = text2.length + 2;
    text2 += "  " + selectorText.trim() + " { " + property + ": " + value + "; }" + nl;
    return { ok: true, text: text2, changed: true, index: index2 };
  }
  let text = cssText;
  if (text.length > 0 && !text.endsWith("\n")) text += nl;
  if (text.length > 0) text += nl;
  text += "/* dsh-nudge: added rule */" + nl;
  const index = text.length;
  text += selectorText.trim() + " {" + nl + "  " + property + ": " + value + ";" + nl + "}" + nl;
  return { ok: true, text, changed: true, index };
}
function scanCssRules(css) {
  const rules = [];
  const length = css.length;
  let index = 0;
  let boundary = 0;
  let depth = 0;
  let openBrace = -1;
  let selectorStart = 0;
  while (index < length) {
    const ch = css[index];
    if (ch === "/" && css[index + 1] === "*") {
      const end = css.indexOf("*/", index + 2);
      index = end < 0 ? length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      index = skipStringToken(css, index);
      continue;
    }
    if (ch === "{") {
      if (depth === 0) {
        openBrace = index;
        selectorStart = boundary;
        depth = 1;
      } else {
        depth += 1;
      }
      index += 1;
      continue;
    }
    if (ch === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && openBrace >= 0) {
          rules.push({ selectorStart, selector: css.slice(selectorStart, openBrace), openBrace, closeBrace: index });
          boundary = index + 1;
          openBrace = -1;
        }
      }
      index += 1;
      continue;
    }
    if (ch === ";" && depth === 0) {
      boundary = index + 1;
      index += 1;
      continue;
    }
    index += 1;
  }
  return rules;
}
function scanDeclarationSegments(body) {
  const segments = [];
  const length = body.length;
  let index = 0;
  let start = 0;
  let depth = 0;
  while (index < length) {
    const ch = body[index];
    if (ch === "/" && body[index + 1] === "*") {
      const end = body.indexOf("*/", index + 2);
      index = end < 0 ? length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      index = skipStringToken(body, index);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (depth > 0) depth -= 1;
      index += 1;
      continue;
    }
    if (ch === ";" && depth === 0) {
      segments.push({ start, end: index });
      start = index + 1;
      index += 1;
      continue;
    }
    index += 1;
  }
  if (start < length) segments.push({ start, end: length });
  return segments;
}
function findTopLevelColon(text, from, to) {
  let index = from;
  let depth = 0;
  while (index < to) {
    const ch = text[index];
    if (ch === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end < 0 ? to : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      index = skipStringToken(text, index);
      if (index > to) return -1;
      continue;
    }
    if (ch === "(" || ch === "[") {
      depth += 1;
      index += 1;
      continue;
    }
    if (ch === ")" || ch === "]") {
      if (depth > 0) depth -= 1;
      index += 1;
      continue;
    }
    if (ch === ":" && depth === 0) return index;
    index += 1;
  }
  return -1;
}
function updateDeclarations(body, property, value, nl) {
  const segments = scanDeclarationSegments(body);
  const matches = [];
  for (const segment of segments) {
    const colon = findTopLevelColon(body, segment.start, segment.end);
    if (colon < 0) continue;
    const name = body.slice(segment.start, colon).trim();
    if (!name) continue;
    if (!sameProperty(name, property)) continue;
    matches.push({ segment, colon });
  }
  if (matches.length === 0) {
    const trimmedEnd = body.replace(/[ \t\r\n]+$/, "").length;
    if (body.trim() === "") {
      const newBody = nl + "  " + property + ": " + value + ";" + nl;
      return { body: newBody, changed: true, index: nl.length + 2 };
    }
    const multiline = body.includes("\n");
    let indent = "  ";
    const indentMatch = /(?:^|\n)([ \t]+)\S/.exec(body);
    if (indentMatch) indent = indentMatch[1];
    const insertion = multiline ? nl + indent + property + ": " + value + ";" : " " + property + ": " + value + ";";
    const index = trimmedEnd + (multiline ? nl.length + indent.length : 1);
    return {
      body: body.slice(0, trimmedEnd) + insertion + body.slice(trimmedEnd),
      changed: true,
      index
    };
  }
  const first = matches[0];
  const valueStart = first.colon + 1;
  const rawOld = body.slice(valueStart, first.segment.end);
  const leading = /^[ \t\r\n]*/.exec(rawOld)[0];
  const nextRaw = leading + value;
  const delta = nextRaw.length - rawOld.length;
  const changedValue = rawOld.trim() !== value;
  let result = body.slice(0, valueStart) + nextRaw + body.slice(first.segment.end);
  for (let k = matches.length - 1; k >= 1; k -= 1) {
    const segment = matches[k].segment;
    let removeStart = segment.start + (segment.start > valueStart ? delta : 0);
    let removeEnd = segment.end + (segment.start > valueStart ? delta : 0);
    if (result[removeEnd] === ";") removeEnd += 1;
    while (removeStart > 0 && /[ \t\r\n]/.test(result[removeStart - 1])) removeStart -= 1;
    result = result.slice(0, removeStart) + result.slice(removeEnd);
  }
  return { body: result, changed: changedValue || matches.length > 1, index: valueStart + leading.length };
}
function sameProperty(name, property) {
  if (property.startsWith("--")) return name === property;
  return name.toLowerCase() === property.toLowerCase();
}

// src/host/domains/persistence/edits/style.ts
function styleEditParts(edit) {
  const hints = edit.sourceHints && typeof edit.sourceHints === "object" ? edit.sourceHints : {};
  const selectorSource = typeof hints.styleSelector === "string" && hints.styleSelector.trim() !== "" ? hints.styleSelector : edit.selector;
  const selector = normalizeSelector(selectorSource);
  const property = normalizeProperty(edit.property);
  const rawValue = typeof edit.value === "string" ? edit.value : typeof edit.after === "string" ? edit.after : "";
  const value = rawValue.trim() === "" ? "" : normalizeStyleValue(rawValue);
  if (!selector || !property || value === null) return null;
  return { selector, property, value };
}
function applyCssRuleEdit(content, edit) {
  const parts = styleEditParts(edit);
  if (!parts || parts.value === "") return { ok: false, reason: "invalid-edit" };
  const applied = applyCssRule(content, parts.selector, parts.property, parts.value, {
    nl: newlineOf(content),
    mode: "sheet",
    allowCompound: true
  });
  if (!applied.ok) return applied;
  return { ok: true, content: applied.text, changed: applied.changed, lineIndex: applied.index };
}
function applyHtmlOverrideEdit(content, edit) {
  const selector = normalizeSelector(edit.selector);
  const property = normalizeProperty(edit.property);
  const rawValue = typeof edit.value === "string" ? edit.value : typeof edit.after === "string" ? edit.after : "";
  const value = normalizeStyleValue(rawValue);
  const removal = !value;
  if (!selector || !property) return { ok: false, reason: "invalid-edit" };
  const nl = newlineOf(content);
  const { tags } = tokenizeHtml(content);
  let styleIndex = -1;
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    if (tag.closing || tag.name !== "style") continue;
    if (attrValue(tag, "id") === OVERRIDE_STYLE_ID) {
      styleIndex = index;
      break;
    }
  }
  if (styleIndex >= 0) {
    const closeIndex = matchingCloseTagIndex(tags, styleIndex, "style");
    if (closeIndex < 0) return { ok: false, reason: "unresolved-element" };
    const open = tags[styleIndex];
    const close = tags[closeIndex];
    const blockBody = content.slice(open.end, close.start);
    const applied = removal ? removeCssDeclaration(blockBody, selector, property) : applyCssRule(blockBody, selector, property, value, { nl, mode: "block", allowCompound: true });
    if (!applied.ok) return applied;
    return {
      ok: true,
      content: content.slice(0, open.end) + applied.text + content.slice(close.start),
      changed: applied.changed,
      lineIndex: open.end + applied.index
    };
  }
  if (removal) return { ok: true, content, changed: false, lineIndex: 0 };
  let insertAt = content.length;
  for (const tag of tags) {
    if (tag.closing && tag.name === "head") {
      insertAt = tag.start;
      break;
    }
  }
  if (insertAt === content.length) {
    for (const tag of tags) {
      if (tag.closing && tag.name === "body") {
        insertAt = tag.start;
        break;
      }
    }
  }
  const prefixNewline = insertAt > 0 && content[insertAt - 1] !== "\n" ? nl : "";
  const openText = '<style id="' + OVERRIDE_STYLE_ID + '">';
  const block = openText + nl + "  " + selector + " { " + property + ": " + value + "; }" + nl + "</style>" + nl;
  const lineIndex = insertAt + prefixNewline.length + openText.length + nl.length + 2;
  return {
    ok: true,
    content: content.slice(0, insertAt) + prefixNewline + block + content.slice(insertAt),
    changed: true,
    lineIndex
  };
}
function applyTemplateStyleEdit(content, edit) {
  const selector = normalizeSelector(edit.selector);
  const property = normalizeProperty(edit.property);
  const rawValue = typeof edit.value === "string" ? edit.value : typeof edit.after === "string" ? edit.after : "";
  const value = normalizeStyleValue(rawValue);
  if (!selector || !property || !value) return { ok: false, reason: "invalid-edit" };
  const nl = newlineOf(content);
  const { tags } = tokenizeHtml(content);
  let styleIndex = -1;
  for (let index = 0; index < tags.length; index += 1) {
    if (!tags[index].closing && tags[index].name === "style") {
      styleIndex = index;
      break;
    }
  }
  if (styleIndex >= 0) {
    const closeIndex = matchingCloseTagIndex(tags, styleIndex, "style");
    if (closeIndex >= 0) {
      const open = tags[styleIndex];
      const close = tags[closeIndex];
      const blockBody = content.slice(open.end, close.start);
      const applied = applyCssRule(blockBody, selector, property, value, { nl, mode: "block", allowCompound: true });
      if (!applied.ok) return applied;
      return {
        ok: true,
        content: content.slice(0, open.end) + applied.text + content.slice(close.start),
        changed: applied.changed,
        lineIndex: open.end + applied.index
      };
    }
  }
  let prefix = content;
  if (prefix.length > 0 && !prefix.endsWith("\n")) prefix += nl;
  const lead = prefix.length > 0 ? nl : "";
  const block = "<style>" + nl + "  " + selector + " { " + property + ": " + value + "; }" + nl + "</style>" + nl;
  return {
    ok: true,
    content: prefix + lead + block,
    changed: true,
    lineIndex: prefix.length + lead.length + "<style>".length + nl.length + 2
  };
}

// src/host/domains/persistence/planning/mapping.ts
import { dirname, join } from "node:path";
function derivePageMapping(page, urlRoot) {
  const rawUrl = page && typeof page.url === "string" ? page.url.trim() : "";
  if (!rawUrl) return { eligible: false, relativePath: null };
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { eligible: false, relativePath: null };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { eligible: false, relativePath: null };
  const configured = typeof urlRoot === "string" ? urlRoot.trim() : "";
  let prefixPath = "";
  if (configured) {
    let rootUrl = null;
    try {
      const candidate = new URL(configured);
      if (candidate.protocol === "http:" || candidate.protocol === "https:") rootUrl = candidate;
    } catch {
      rootUrl = null;
    }
    if (rootUrl) {
      if (parsed.origin !== rootUrl.origin) return { eligible: false, relativePath: null };
      prefixPath = rootUrl.pathname.replace(/\/+$/, "");
    } else {
      if (!isLoopbackHostname(parsed.hostname)) return { eligible: false, relativePath: null };
      const prefix = configured.startsWith("/") ? configured : "/" + configured;
      prefixPath = prefix.replace(/\/+$/, "");
    }
    if (prefixPath !== "" && parsed.pathname !== prefixPath && !parsed.pathname.startsWith(prefixPath + "/")) {
      return { eligible: false, relativePath: null };
    }
  } else if (!isLoopbackHostname(parsed.hostname)) {
    return { eligible: false, relativePath: null };
  }
  const rest = prefixPath ? parsed.pathname.slice(prefixPath.length) : parsed.pathname;
  if (rest === "" || rest === "/") return { eligible: true, relativePath: "index.html" };
  let decoded;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return { eligible: false, relativePath: null };
  }
  const clean = sanitizeRelativePath(decoded);
  if (!clean) return { eligible: false, relativePath: null };
  return { eligible: true, relativePath: clean };
}
function isLoopbackHostname(hostname) {
  const value = String(hostname || "").toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "[::1]" || value === "::1";
}
function sanitizeRelativePath(input) {
  if (typeof input !== "string") return null;
  let text = input.trim();
  if (text === "") return null;
  text = text.replace(/\\/g, "/");
  const query = text.indexOf("?");
  if (query >= 0) text = text.slice(0, query);
  const hash = text.indexOf("#");
  if (hash >= 0) text = text.slice(0, hash);
  if (text.includes("\0")) return null;
  text = text.replace(/^\/+/, "");
  while (text.startsWith("./")) text = text.slice(2);
  const segments = text.split("/");
  const output = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return null;
    if (segment.includes(":") || segment.includes("\0")) return null;
    output.push(segment);
  }
  if (output.length === 0) return null;
  return output.join("/");
}
function hintToRelativePath(hint) {
  if (typeof hint !== "string") return null;
  let text = hint.trim();
  if (text === "") return null;
  if (/^https?:\/\//i.test(text)) {
    try {
      text = new URL(text).pathname;
    } catch {
      return null;
    }
  }
  try {
    text = decodeURIComponent(text);
  } catch {
    return null;
  }
  return sanitizeRelativePath(text);
}
async function resolveSourceFile(ctx, relativePath, options = {}) {
  return resolveFileUnderRoot(ctx, ctx.sourceRootTarget, ctx.sourceRootPath, relativePath, options);
}
async function resolveFileUnderRoot(ctx, rootTarget, rootPath, relativePath, options = {}) {
  const rel = typeof relativePath === "string" ? relativePath.replace(/^\/+/, "") : "";
  if (!rel) return { ok: false, reason: "no-source-mapping", relativePath: "" };
  const absolute = join(rootPath, ...rel.split("/"));
  let target;
  try {
    target = await ctx.fs.resolve(absolute);
  } catch (error) {
    return { ok: false, reason: "no-source-mapping", message: reasonOf(error), relativePath: rel };
  }
  if (!target || !ctx.fs.contains(ctx.cwdTarget, target)) return { ok: false, reason: "outside-workspace", relativePath: rel };
  if (!ctx.fs.contains(rootTarget, target)) return { ok: false, reason: "outside-source-root", relativePath: rel };
  const ext = extensionOf(rel);
  let info;
  try {
    info = await ctx.fs.stat(target);
  } catch {
    info = void 0;
  }
  if (info === void 0) {
    if (options.allowCreate) {
      const parent = await ctx.fs.resolve(dirname(absolute));
      const parentInfo = parent ? await statOrUndefined(ctx.fs, parent) : void 0;
      if (!parentInfo || parentInfo.type !== "directory") return { ok: false, reason: "no-source-mapping", relativePath: rel };
      return { ok: true, target, ext, relativePath: rel, create: true };
    }
    return { ok: false, reason: "missing", target, ext, relativePath: rel };
  }
  if (info.type === "directory") {
    if (rel === "index.html" || rel.endsWith("/index.html")) return { ok: false, reason: "unsupported-source-type", relativePath: rel };
    return resolveFileUnderRoot(ctx, rootTarget, rootPath, rel + "/index.html", options);
  }
  if (info.type !== "file") return { ok: false, reason: "unsupported-source-type", relativePath: rel };
  if (typeof info.size === "number" && info.size > ctx.readLimit) {
    return { ok: false, reason: "file-too-large", target, ext, size: info.size, relativePath: rel };
  }
  return { ok: true, target, info, ext, relativePath: rel };
}
function tooLargeFailure(ctx, resolved) {
  const targetFile = resolved && resolved.target ? workspaceRelative(ctx, resolved.target) : "";
  return {
    reason: "file-too-large",
    message: "the source file is larger than the " + Math.floor(ctx.readLimit / 1e3) + " kB read limit",
    file: targetFile || resolved && resolved.relativePath || void 0
  };
}

// src/host/domains/persistence/planning/validate.ts
function strategyFor(kind, ext) {
  if (kind === "style") {
    if (CSS_EXTENSIONS.has(ext)) return "css-rule";
    if (ext === "html" || ext === "htm") return "html-override";
    if (TEMPLATE_EXTENSIONS.has(ext)) return "template-style";
    return null;
  }
  if (kind === "text" || kind === "attr") {
    if (MARKUP_EXTENSIONS.has(ext)) return kind === "text" ? "html-text" : "html-attr";
    return null;
  }
  if (kind === "remove" || kind === "move") {
    if (MARKUP_EXTENSIONS.has(ext)) return kind === "remove" ? "html-remove" : "html-move";
    return null;
  }
  return null;
}
function normalizeKind(value) {
  if (value === "style" || value === "text" || value === "attr") return value;
  if (value === "remove" || value === "move") return value;
  return null;
}
function validateEditShape(kind, edit) {
  if (kind === "style") {
    const parts = styleEditParts(edit);
    return parts !== null;
  }
  if (kind === "text") {
    return typeof edit.textAfter === "string" || typeof edit.after === "string";
  }
  if (kind === "attr") {
    if (typeof edit.attrName !== "string" || edit.attrName.trim() === "") return false;
    if (edit.attrAfter === null) return true;
    return typeof edit.attrAfter === "string";
  }
  if (kind === "remove") return true;
  if (kind === "move") {
    if (typeof edit.targetParentSelector !== "string" || edit.targetParentSelector.trim() === "") return false;
    if (edit.beforeSelector === void 0 || edit.beforeSelector === null) return true;
    return typeof edit.beforeSelector === "string" && edit.beforeSelector.trim() !== "";
  }
  return false;
}

// src/host/domains/persistence/planning/search.ts
async function listCandidates(ctx) {
  if (ctx.candidateCache) return ctx.candidateCache;
  const found = [];
  const queue = [ctx.sourceRootTarget];
  const visited = /* @__PURE__ */ new Set();
  let budget = SEARCH_DIRECTORY_BUDGET;
  while (queue.length > 0 && found.length < ctx.scanLimit && budget > 0) {
    const dir = queue.shift();
    budget -= 1;
    const key = pathOf(ctx.fs, dir);
    if (visited.has(key)) continue;
    visited.add(key);
    let entries;
    try {
      entries = await ctx.fs.listDir(dir);
    } catch {
      continue;
    }
    if (!Array.isArray(entries)) continue;
    const sorted = entries.slice().sort((left, right) => String(left && left.name || "").localeCompare(String(right && right.name || "")));
    for (const entry of sorted) {
      if (found.length >= ctx.scanLimit) break;
      if (!entry || typeof entry.name !== "string" || !entry.target) continue;
      if (entry.type === "directory") {
        if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
        queue.push(entry.target);
        continue;
      }
      if (entry.type !== "file") continue;
      const ext = extensionOf(entry.name);
      if (!SEARCH_EXTENSIONS.has(ext)) continue;
      if (typeof entry.size === "number" && entry.size > ctx.readLimit) {
        ctx.addWarning("skipped a source file larger than the read limit: " + entry.name);
        continue;
      }
      found.push({ target: entry.target, ext, name: entry.name, size: entry.size });
    }
  }
  ctx.candidateCache = found;
  return found;
}
async function searchForEdit(ctx, edit, kind) {
  const tokens = selectorSearchTokens(edit.selector);
  const snippet = normalizeWhitespaceText(typeof edit.textSnippet === "string" ? edit.textSnippet : "");
  const key = kind + "\0" + tokens.ids.join(",") + "\0" + tokens.classes.join(",") + "\0" + snippet.slice(0, 96);
  if (ctx.searchMemo.has(key)) return ctx.searchMemo.get(key);
  const candidates = (await listCandidates(ctx)).filter((file) => strategyFor(kind, file.ext) !== null);
  let best = null;
  let ties = 0;
  for (const candidate of candidates) {
    let content;
    try {
      content = await ctx.fs.readText(candidate.target);
    } catch {
      continue;
    }
    if (typeof content !== "string" || content.indexOf("\0") >= 0) continue;
    const score = scoreFileContent(content, candidate.ext, tokens, snippet);
    if (score <= 0) continue;
    if (best === null || score > best.score) {
      best = { score, file: candidate };
      ties = 1;
    } else if (score === best.score) {
      ties += 1;
    }
  }
  let outcome = null;
  if (best && best.score >= SEARCH_SCORE_THRESHOLD) {
    outcome = best;
    if (ties > 1) ctx.addWarning("the source search matched more than one file for one edit; used the best-scoring candidate");
  }
  ctx.searchMemo.set(key, outcome);
  return outcome;
}
function selectorSearchTokens(selector) {
  const text = typeof selector === "string" ? selector : "";
  const ids = /* @__PURE__ */ new Set();
  const classes = /* @__PURE__ */ new Set();
  for (const match of text.matchAll(/#([A-Za-z_][A-Za-z0-9_-]+)/g)) if (match[1].length >= 2) ids.add(match[1]);
  for (const match of text.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]+)/g)) if (match[1].length >= 2) classes.add(match[1]);
  return { ids: [...ids], classes: [...classes] };
}
function scoreFileContent(content, ext, tokens, snippet) {
  let score = 0;
  if (CSS_EXTENSIONS.has(ext)) {
    for (const id of tokens.ids) if (content.includes("#" + id)) score += 5;
    for (const cls of tokens.classes) {
      if (new RegExp("\\." + escapeRegExp(cls) + "(?![\\w-])").test(content)) score += 3;
    }
  } else {
    for (const id of tokens.ids) {
      if (new RegExp(`\\bid\\s*=\\s*(["\\'])` + escapeRegExp(id) + "\\1").test(content)) score += 5;
    }
    for (const cls of tokens.classes) {
      if (new RegExp("(?:^|[\\s\"'`])" + escapeRegExp(cls) + "(?=[\\s\"'`]|$)").test(content)) score += 3;
    }
  }
  if (snippet.length >= 8) {
    const text = normalizeWhitespaceText(content.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " "));
    if (text.includes(snippet)) score += 4;
    else if (snippet.length >= 16 && text.includes(snippet.slice(0, 40))) score += 2;
  }
  return score;
}
async function findBasenameCandidates(ctx, baseName) {
  const candidates = await listCandidates(ctx);
  return candidates.filter((file) => file.name === baseName);
}
async function inspectSearchTarget(ctx, target, fallbackExt) {
  let canonical;
  try {
    canonical = await ctx.fs.resolve(pathOf(ctx.fs, target));
  } catch {
    return null;
  }
  if (!canonical || !ctx.fs.contains(ctx.cwdTarget, canonical) || !ctx.fs.contains(ctx.sourceRootTarget, canonical)) return null;
  const info = await statOrUndefined(ctx.fs, canonical);
  if (!info || info.type !== "file") return null;
  if (typeof info.size === "number" && info.size > ctx.readLimit) return null;
  const canonicalPath = pathOf(ctx.fs, canonical);
  const rel = relativePosix(ctx.sourceRootPath, canonicalPath);
  if (!rel) return null;
  return { target: canonical, info, ext: extensionOf(rel) || fallbackExt, relativePath: rel };
}

// src/host/domains/persistence/index.ts
async function syncEdits(deps) {
  const editList = deps && Array.isArray(deps.edits) ? deps.edits : [];
  const results = new Array(editList.length);
  const files = [];
  const warnings = [];
  const warningSet = /* @__PURE__ */ new Set();
  const addWarning = (text) => {
    const value = String(text);
    if (warningSet.has(value)) return;
    warningSet.add(value);
    warnings.push(value);
  };
  if (editList.length === 0) return { results: [], files, warnings };
  const fs = deps && deps.fs;
  if (!fs || typeof fs.resolve !== "function" || typeof fs.readText !== "function" || typeof fs.writeText !== "function" || typeof fs.stat !== "function" || typeof fs.contains !== "function") {
    const message = "the host fs service is unavailable";
    for (let index = 0; index < editList.length; index += 1) {
      results[index] = { id: editId(editList[index]), status: "failed", reason: "fs-unavailable", message };
    }
    return { results, files, warnings };
  }
  const policyInput = deps.policy && typeof deps.policy === "object" ? deps.policy : {};
  const mode = typeof policyInput.mode === "string" ? policyInput.mode : "read-only";
  if (mode === "read-only") {
    for (let index = 0; index < editList.length; index += 1) {
      results[index] = { id: editId(editList[index]), status: "preview", reason: "read-only-policy" };
    }
    return { results, files, warnings };
  }
  const policy = { ...policyInput, mode };
  let workspaceCwd = typeof deps.cwd === "string" ? deps.cwd.trim() : "";
  if (!workspaceCwd && typeof policy.workspaceRoot === "string") workspaceCwd = policy.workspaceRoot.trim();
  if (!workspaceCwd) {
    const message = "the session working directory is unknown";
    for (let index = 0; index < editList.length; index += 1) {
      results[index] = { id: editId(editList[index]), status: "failed", reason: "workspace-unavailable", message };
    }
    return { results, files, warnings };
  }
  if (!isAbsolute2(workspaceCwd)) workspaceCwd = resolve(workspaceCwd);
  let cwdTarget;
  try {
    cwdTarget = await fs.resolve(workspaceCwd);
  } catch (error) {
    const message = reasonOf(error);
    for (let index = 0; index < editList.length; index += 1) {
      results[index] = { id: editId(editList[index]), status: "failed", reason: "workspace-unavailable", message };
    }
    return { results, files, warnings };
  }
  const cwdPath = pathOf(fs, cwdTarget);
  const configuredRoot = typeof deps.sourceRoot === "string" ? deps.sourceRoot.trim() : "";
  let sourceRootTarget = cwdTarget;
  if (configuredRoot) {
    try {
      const candidateAbsolute = isAbsolute2(configuredRoot) ? configuredRoot : join2(workspaceCwd, configuredRoot);
      const candidate = await fs.resolve(candidateAbsolute);
      if (candidate && fs.contains(cwdTarget, candidate)) {
        const info = await statOrUndefined(fs, candidate);
        if (info && info.type === "directory") sourceRootTarget = candidate;
      }
    } catch {
    }
  }
  const sourceRootPath = pathOf(fs, sourceRootTarget);
  const configuredLimit = Number(deps.maxFileBytes);
  const readLimit = Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.min(Math.floor(configuredLimit), READ_LIMIT) : READ_LIMIT;
  const configuredScan = Number(deps.maxScanFiles);
  const scanLimit = Number.isFinite(configuredScan) && configuredScan > 0 ? Math.max(20, Math.min(5e3, Math.floor(configuredScan))) : DEFAULT_SCAN_LIMIT;
  const mapping = derivePageMapping(deps.page, deps.urlRoot);
  const ctx = {
    fs,
    cwdTarget,
    cwdPath,
    sourceRootTarget,
    sourceRootPath,
    readLimit,
    scanLimit,
    policy,
    addWarning,
    candidateCache: null,
    searchMemo: /* @__PURE__ */ new Map()
  };
  const groups = /* @__PURE__ */ new Map();
  for (let index = 0; index < editList.length; index += 1) {
    const edit = editList[index] && typeof editList[index] === "object" ? editList[index] : {};
    try {
      const outcome = await planEdit(ctx, edit, mapping);
      if (outcome.plan) {
        const plan = outcome.plan;
        const key = pathOf(fs, plan.target);
        let group = groups.get(key);
        if (!group) {
          group = { target: plan.target, relativePath: plan.relativePath, edits: [] };
          groups.set(key, group);
        }
        if (plan.allowCreate) group.allowCreate = true;
        group.edits.push({ index, edit, strategy: plan.strategy, via: plan.via });
        continue;
      }
      if (outcome.failed) {
        results[index] = { id: editId(edit), status: "failed", ...outcome.failed };
        continue;
      }
      results[index] = { id: editId(edit), status: "preview", ...outcome.preview || { reason: "no-source-mapping" } };
    } catch (error) {
      results[index] = { id: editId(edit), status: "failed", reason: "internal-error", message: reasonOf(error) };
    }
  }
  for (const group of groups.values()) {
    try {
      await processGroup(ctx, group, results, files);
    } catch (error) {
      const file = workspaceRelative(ctx, group.target) || group.relativePath;
      for (const item of group.edits) {
        if (results[item.index] === void 0) {
          results[item.index] = { id: editId(item.edit), status: "failed", reason: "internal-error", message: reasonOf(error), file };
        }
      }
    }
  }
  for (let index = 0; index < editList.length; index += 1) {
    if (results[index] === void 0) {
      results[index] = { id: editId(editList[index]), status: "failed", reason: "internal-error", message: "the edit could not be planned" };
    }
  }
  return { results, files, warnings };
}
async function planEdit(ctx, edit, mapping) {
  const kind = normalizeKind(edit.kind);
  if (!kind) return { preview: { reason: "unsupported-edit-kind" } };
  const selector = typeof edit.selector === "string" ? edit.selector.trim() : "";
  if (!selector) return { preview: { reason: "unresolved-element" } };
  if (!validateEditShape(kind, edit)) return { preview: { reason: "invalid-edit" } };
  const hints = edit.sourceHints && typeof edit.sourceHints === "object" ? edit.sourceHints : {};
  let sawUnsupported = false;
  let oversized = null;
  const consider = (resolved, via, allowCreate) => {
    if (!resolved || resolved.ok !== true) {
      if (resolved && resolved.reason === "file-too-large") oversized = resolved;
      return null;
    }
    const strategy = strategyFor(kind, resolved.ext);
    if (!strategy) {
      sawUnsupported = true;
      return null;
    }
    return {
      plan: {
        target: resolved.target,
        info: resolved.info,
        ext: resolved.ext,
        relativePath: resolved.relativePath,
        allowCreate: Boolean(resolved.create || allowCreate),
        strategy,
        via
      }
    };
  };
  const tryHintCandidate = async (relativePath, allowCreate, hintOptions = {}) => {
    const primary = await resolveSourceFile(ctx, relativePath, { allowCreate: false });
    const planned = consider(primary, "hint", false);
    if (planned) return planned;
    if (oversized) return null;
    if (primary.reason === "missing" && ctx.sourceRootPath !== ctx.cwdPath) {
      const fallback = await resolveFileUnderRoot(ctx, ctx.cwdTarget, ctx.cwdPath, relativePath, { allowCreate: false });
      const fallbackPlanned = consider(fallback, "hint", false);
      if (fallbackPlanned) return fallbackPlanned;
      if (oversized) return null;
    }
    if (hintOptions.basenameFallback) {
      const baseName = relativePath.split("/").pop();
      if (baseName) {
        const matches = await findBasenameCandidates(ctx, baseName);
        if (matches.length === 1) {
          const inspected = await inspectSearchTarget(ctx, matches[0].target, matches[0].ext);
          if (inspected) {
            const plannedByName = consider(
              { ok: true, target: inspected.target, info: inspected.info, ext: inspected.ext, relativePath: inspected.relativePath },
              "hint",
              false
            );
            if (plannedByName) return plannedByName;
          }
        }
        if (matches.length > 1) return null;
      }
    }
    if (allowCreate) {
      const created = await resolveSourceFile(ctx, relativePath, { allowCreate: true });
      return consider(created, "hint", true);
    }
    return null;
  };
  if (kind === "style" && typeof hints.styleHref === "string" && hints.styleHref.trim()) {
    const rel = hintToRelativePath(hints.styleHref);
    if (rel) {
      const planned = await tryHintCandidate(rel, true, { basenameFallback: true });
      if (planned) return planned;
      if (oversized) return { failed: tooLargeFailure(ctx, oversized) };
    }
  }
  if (typeof hints.file === "string" && hints.file.trim()) {
    const rel = hintToRelativePath(hints.file);
    if (rel) {
      const planned = await tryHintCandidate(rel, false);
      if (planned) return planned;
      if (oversized) return { failed: tooLargeFailure(ctx, oversized) };
    }
  }
  if (mapping && mapping.eligible && mapping.relativePath) {
    const resolved = await resolveSourceFile(ctx, mapping.relativePath, { allowCreate: false });
    const planned = consider(resolved, "url", false);
    if (planned) return planned;
    if (oversized) return { failed: tooLargeFailure(ctx, oversized) };
    const found = await searchForEdit(ctx, edit, kind);
    if (found) {
      const inspected = await inspectSearchTarget(ctx, found.file.target, found.file.ext);
      if (inspected) {
        const strategy = strategyFor(kind, inspected.ext);
        if (strategy) {
          return {
            plan: {
              target: inspected.target,
              info: inspected.info,
              ext: inspected.ext,
              relativePath: inspected.relativePath,
              allowCreate: false,
              strategy,
              via: "search"
            }
          };
        }
      }
    }
  }
  if (oversized) return { failed: tooLargeFailure(ctx, oversized) };
  if (sawUnsupported) return { preview: { reason: "unsupported-source-type" } };
  return { preview: { reason: "no-source-mapping" } };
}
async function processGroup(ctx, group, results, files) {
  if (!group.edits.length) return;
  const fileRelative = workspaceRelative(ctx, group.target) || group.relativePath;
  const failGroup = (reason, message) => {
    for (const item of group.edits) {
      if (results[item.index] === void 0) {
        results[item.index] = { id: editId(item.edit), status: "failed", reason, message, file: fileRelative };
      }
    }
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const info = await statOrUndefined(ctx.fs, group.target);
    if (info !== void 0 && info.type !== "file") {
      failGroup("unsupported-source-type", "the mapped source path is not a regular file");
      return;
    }
    if (info === void 0 && !group.allowCreate) {
      failGroup("file-missing", "the mapped source file no longer exists");
      return;
    }
    if (info !== void 0 && typeof info.size === "number" && info.size > ctx.readLimit) {
      failGroup("file-too-large", tooLargeFailure(ctx, { relativePath: fileRelative }).message);
      return;
    }
    let raw = "";
    if (info !== void 0) {
      try {
        raw = await ctx.fs.readText(group.target);
      } catch (error) {
        failGroup("read-failed", reasonOf(error));
        return;
      }
      if (typeof raw !== "string") raw = "";
      if (raw.length > ctx.readLimit) {
        failGroup("file-too-large", tooLargeFailure(ctx, { relativePath: fileRelative }).message);
        return;
      }
    }
    const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
    const body = bom ? raw.slice(1) : raw;
    let current = body;
    const applied = [];
    for (const item of group.edits) {
      let outcome;
      try {
        outcome = applyEditToContent(current, item);
      } catch (error) {
        outcome = { ok: false, reason: "internal-error", message: reasonOf(error) };
      }
      if (!outcome || outcome.ok !== true) {
        if (results[item.index] === void 0) {
          results[item.index] = {
            id: editId(item.edit),
            status: "preview",
            reason: outcome && outcome.reason || "unresolved-element",
            file: fileRelative
          };
        }
        continue;
      }
      current = outcome.content;
      applied.push({ item, changed: outcome.changed, lineIndex: outcome.lineIndex });
    }
    if (applied.length === 0) return;
    const nextRaw = bom + current;
    const bomOffset = bom ? 1 : 0;
    if (nextRaw === raw) {
      for (const appliedItem of applied) {
        results[appliedItem.item.index] = {
          id: editId(appliedItem.item.edit),
          status: "synced",
          file: fileRelative,
          strategy: "no-op",
          line: lineAt(nextRaw, typeof appliedItem.lineIndex === "number" ? appliedItem.lineIndex + bomOffset : void 0)
        };
      }
      return;
    }
    const expected = info === void 0 ? { kind: "createIfAbsent" } : { kind: "replaceIfVersion", version: info.version };
    try {
      await ctx.fs.writeText(group.target, nextRaw, expected, void 0, ctx.policy);
    } catch (error) {
      const code = error && typeof error.code === "string" ? error.code : "";
      const stale = code === "FS_STALE_VERSION" || code === "FS_EXISTS" || /STALE|EXISTS/.test(code);
      if (attempt === 0 && stale) continue;
      for (const appliedItem of applied) {
        results[appliedItem.item.index] = {
          id: editId(appliedItem.item.edit),
          status: "failed",
          reason: stale ? "stale-version" : "write-failed",
          message: reasonOf(error),
          file: fileRelative
        };
      }
      return;
    }
    if (!files.includes(fileRelative)) files.push(fileRelative);
    for (const appliedItem of applied) {
      const isSearch = appliedItem.item.via === "search";
      results[appliedItem.item.index] = {
        id: editId(appliedItem.item.edit),
        status: "synced",
        file: fileRelative,
        strategy: appliedItem.changed ? isSearch ? "search" : appliedItem.item.strategy : "no-op",
        line: lineAt(nextRaw, typeof appliedItem.lineIndex === "number" ? appliedItem.lineIndex + bomOffset : void 0)
      };
      if (appliedItem.item.strategy === "template-style" && appliedItem.changed) {
        ctx.addWarning("style rules were written into the component <style> block; scoped component styles may need :global() to match at runtime");
      }
    }
    return;
  }
}
function applyEditToContent(content, item) {
  switch (item.strategy) {
    case "css-rule":
      return applyCssRuleEdit(content, item.edit);
    case "html-override":
      return applyHtmlOverrideEdit(content, item.edit);
    case "template-style":
      return applyTemplateStyleEdit(content, item.edit);
    case "html-text":
      return applyMarkupTextEdit(content, item.edit);
    case "html-attr":
      return applyMarkupAttrEdit(content, item.edit);
    case "html-remove":
      return applyMarkupRemoveEdit(content, item.edit);
    case "html-move":
      return applyMarkupMoveEdit(content, item.edit);
    default:
      return { ok: false, reason: "unsupported-source-type" };
  }
}
export {
  syncEdits
};
