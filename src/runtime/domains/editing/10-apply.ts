// @ts-nocheck
	function applyStyleTo(element, property, value, important) {
		var before = null
		if (!element) return { ok: !1, before: null, after: null, applied: !1, reason: 'not-found' }
		var cssProperty = cssPropertyName(property)
		if (!cssProperty || !/^(?:--[A-Za-z0-9_-]+|[A-Za-z][A-Za-z0-9-]*)$/.test(cssProperty)) return { ok: !1, before: null, after: null, applied: !1, reason: 'invalid-property' }
		try {
			before = computedValue(element, cssProperty)
		} catch {
			before = ''
		}
		var raw = value == null ? '' : String(value),
			useImportant = important !== !1,
			importantMatch = /^(.*?)\s*!important\s*$/i.exec(raw)
		if ((importantMatch && ((raw = importantMatch[1]), (useImportant = !0)), raw === '' || raw.trim() === '')) {
			try {
				element.style.removeProperty(cssProperty)
			} catch {}
			return { ok: !0, before, after: computedValue(element, cssProperty), applied: inlineValue(element, cssProperty) !== '', removed: !0 }
		}
		if (/[;{}]|<\/?script/i.test(raw)) return { ok: !1, before, after: before, applied: !1, reason: 'invalid-value' }
		try {
			element.style.setProperty(cssProperty, raw, useImportant ? 'important' : '')
		} catch {
			return { ok: !1, before, after: before, applied: !1, reason: 'invalid-value' }
		}
		var applied = inlineValue(element, cssProperty) !== ''
		return applied ? { ok: !0, before, after: computedValue(element, cssProperty), applied: !0 } : { ok: !1, before, after: before, applied: !1, reason: 'invalid-value' }
	}
	function inlineValue(element, cssProperty) {
		try {
			return String(element.style.getPropertyValue(cssProperty) || '')
		} catch {
			return ''
		}
	}
	function computedValue(element, cssProperty) {
		try {
			if (typeof win.getComputedStyle == 'function') {
				var computed = win.getComputedStyle(element)
				if (computed && typeof computed.getPropertyValue == 'function') return String(computed.getPropertyValue(cssProperty) || '')
			}
		} catch {}
		return inlineValue(element, cssProperty)
	}
	function applyTextTo(element, text) {
		var before = element ? visibleTextOf(element) : null
		if (!element) return { ok: !1, before: null, after: null, reason: 'not-found' }
		var direct = firstDirectTextNode(element)
		if (!direct) return { ok: !1, before, after: visibleTextOf(element), directText: directTextValue(element), reason: 'no-text-node' }
		var next = text == null ? '' : String(text)
		try {
			direct.nodeValue = next
		} catch {
			return { ok: !1, before, after: visibleTextOf(element), reason: 'write-failed' }
		}
		return { ok: !0, before, after: visibleTextOf(element), directText: next, applied: !0 }
	}
	function isSafeHref(value) {
		var text = String(value == null ? '' : value).trim()
		if (text === '' || /[\u0000-\u001f\u007f]/.test(text)) return !1
		if (text.charAt(0) === '#') return !0
		var scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(text)
		if (scheme) {
			var protocol = scheme[1].toLowerCase()
			return protocol === 'http' || protocol === 'https' || protocol === 'mailto' || protocol === 'tel'
		}
		return !0
	}
	function applyAttrTo(element, name, value) {
		if (!element) return { ok: !1, before: null, after: null, reason: 'not-found' }
		var attribute = String(name == null ? '' : name).trim()
		if (!attribute || !/^[A-Za-z_:][A-Za-z0-9.:_-]*$/.test(attribute)) return { ok: !1, before: null, after: null, reason: 'invalid-attribute' }
		var lower = attribute.toLowerCase(),
			tag = tagLower(element)
		if (lower === 'style' || lower === 'srcdoc' || /^on/.test(lower)) return { ok: !1, before: attributeValue(element, attribute), after: attributeValue(element, attribute), reason: 'forbidden-attribute' }
		if (lower === 'src' && tag === 'script') return { ok: !1, before: attributeValue(element, attribute), after: attributeValue(element, attribute), reason: 'forbidden-attribute' }
		if (lower === 'href' && (tag === 'script' || tag === 'link')) return { ok: !1, before: attributeValue(element, attribute), after: attributeValue(element, attribute), reason: 'forbidden-attribute' }
		var before = attributeValue(element, attribute),
			next = value == null ? '' : String(value)
		if (lower === 'href' && tag === 'a' && next !== '' && !isSafeHref(next)) return { ok: !1, before, after: before, reason: 'unsafe-href' }
		if (next === '') {
			try {
				element.removeAttribute(attribute)
			} catch {
				return { ok: !1, before, after: before, reason: 'write-failed' }
			}
			return { ok: !0, before, after: attributeValue(element, attribute), applied: !1, removed: !0 }
		}
		try {
			element.setAttribute(attribute, next)
		} catch {
			return { ok: !1, before, after: before, reason: 'write-failed' }
		}
		return { ok: !0, before, after: attributeValue(element, attribute), applied: !0 }
	}
	function attributeValue(element, name) {
		try {
			var value = element.getAttribute(name)
			return value === void 0 ? null : value
		} catch {
			return null
		}
	}
	function resolveEditElement(edit) {
		if (!edit) return null
		var element = resolveSelector(edit.selector)
		return (!element && Array.isArray(edit.path) && (element = resolvePath(edit.path)), element && isOwnNode(element) && (element = null), element)
	}
	function applyStyle(selector, property, value, important) {
		return destroyed ? { ok: !1, before: null, after: null, applied: !1, reason: 'destroyed' } : applyStyleTo(resolveSelector(selector), property, value, important)
	}
	function applyText(selector, text) {
		return destroyed ? { ok: !1, before: null, after: null, reason: 'destroyed' } : applyTextTo(resolveSelector(selector), text)
	}
	function applyAttr(selector, name, value) {
		return destroyed ? { ok: !1, before: null, after: null, reason: 'destroyed' } : applyAttrTo(resolveSelector(selector), name, value)
	}
	function reapply(edits) {
		for (var list = Array.isArray(edits) ? edits : [], applied = 0, failed = 0, results = [], index = 0; index < list.length; index += 1) {
			var edit = list[index] || {},
				element = resolveEditElement(edit),
				outcome = null,
				kind = String(edit.kind || '')
			;(kind === 'style' ? (outcome = applyStyleTo(element, edit.property, edit.value, edit.important !== !1)) : kind === 'text' ? (outcome = applyTextTo(element, edit.value)) : kind === 'attr' ? (outcome = applyAttrTo(element, edit.attrName || edit.name, edit.value)) : (outcome = { ok: !1, reason: 'unknown-kind' }),
				outcome && outcome.ok ? (applied += 1) : (failed += 1),
				results.push({ index, kind, ok: !!(outcome && outcome.ok), reason: outcome && outcome.reason ? outcome.reason : void 0 }))
		}
		return { applied, failed, results }
	}
