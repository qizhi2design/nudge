// @ts-nocheck
	var STYLE_FIELDS = [
		['display', 'display'],
		['position', 'position'],
		['width', 'width'],
		['height', 'height'],
		['color', 'color'],
		['backgroundColor', 'background-color'],
		['fontSize', 'font-size'],
		['fontFamily', 'font-family'],
		['fontWeight', 'font-weight'],
		['lineHeight', 'line-height'],
		['borderRadius', 'border-radius'],
		['border', 'border'],
		['opacity', 'opacity'],
		['zIndex', 'z-index'],
		['overflow', 'overflow'],
		['margin', 'margin'],
		['padding', 'padding'],
		['top', 'top'],
		['right', 'right'],
		['bottom', 'bottom'],
		['left', 'left'],
		['marginTop', 'margin-top'],
		['marginRight', 'margin-right'],
		['marginBottom', 'margin-bottom'],
		['marginLeft', 'margin-left'],
		['paddingTop', 'padding-top'],
		['paddingRight', 'padding-right'],
		['paddingBottom', 'padding-bottom'],
		['paddingLeft', 'padding-left'],
		['gap', 'gap'],
		['minWidth', 'min-width'],
		['minHeight', 'min-height'],
		['maxWidth', 'max-width'],
		['maxHeight', 'max-height'],
		['flexDirection', 'flex-direction'],
		['justifyContent', 'justify-content'],
		['alignItems', 'align-items'],
		['letterSpacing', 'letter-spacing'],
		['boxShadow', 'box-shadow'],
		['transform', 'transform'],
		['visibility', 'visibility'],
		['backgroundImage', 'background-image'],
		['textAlign', 'text-align']
	]
	function computedStylesOf(element) {
		var out = {},
			computed = null
		try {
			typeof win.getComputedStyle == 'function' && (computed = win.getComputedStyle(element))
		} catch {
			computed = null
		}
		for (var index = 0; index < STYLE_FIELDS.length; index += 1) {
			var key = STYLE_FIELDS[index][0],
				property = STYLE_FIELDS[index][1],
				value = ''
			try {
				computed && typeof computed.getPropertyValue == 'function' ? (value = computed.getPropertyValue(property)) : computed && computed[property] !== void 0 && (value = computed[property])
			} catch {
				value = ''
			}
			;(value == null && (value = ''), (out[key] = String(value)))
		}
		return out
	}
	function inlineStylesOf(element) {
		var out = {}
		try {
			var style = element.style
			if (!style || typeof style.length != 'number') return out
			for (var index = 0; index < style.length; index += 1) {
				var name = typeof style.item == 'function' ? style.item(index) : style[index]
				if (name) {
					var value = ''
					try {
						value = style.getPropertyValue(name)
					} catch {
						value = ''
					}
					value && (out[name.indexOf('--') === 0 ? name : camelPropertyName(name)] = String(value))
				}
			}
		} catch {
			return out
		}
		return out
	}
	function attributesOf(element) {
		var out = {}
		try {
			for (var attributes = element.attributes || [], count = 0, index = 0; index < attributes.length && count < 40; index += 1) {
				var attribute = attributes[index]
				if (!(!attribute || !attribute.name)) {
					var value = attribute.value === void 0 || attribute.value === null ? '' : String(attribute.value)
					;(value.length > 400 && (value = value.slice(0, 400) + '\u2026'), (out[attribute.name] = value), (count += 1))
				}
			}
		} catch {
			return out
		}
		return out
	}
	function firstDirectTextNode(element) {
		for (var children = (element && element.childNodes) || [], index = 0; index < children.length; index += 1) {
			var child = children[index]
			if (child && child.nodeType === 3 && String(child.nodeValue || '').trim() !== '') return child
		}
		return null
	}
	function directTextValue(element) {
		var node = firstDirectTextNode(element)
		return node ? String(node.nodeValue || '').trim() : ''
	}
	function visibleTextOf(element, limit) {
		var text = ''
		try {
			text = element.innerText
		} catch {
			text = ''
		}
		if (typeof text != 'string' || text === '')
			try {
				text = element.textContent || ''
			} catch {
				text = ''
			}
		if (((text = String(text).replace(/\s+/g, ' ').trim()), text === '')) {
			var tag = tagLower(element)
			if (tag === 'input' || tag === 'textarea')
				try {
					text = String(element.value || '')
				} catch {
					text = ''
				}
		}
		var max = Number(limit)
		if (!isFinite(max) || max <= 0) max = 300
		return (text.length > max && (text = text.slice(0, max)), text)
	}
	function rectOf(element) {
		var rect = null
		try {
			rect = element.getBoundingClientRect ? element.getBoundingClientRect() : null
		} catch {
			rect = null
		}
		if (!rect) return { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 }
		var left = typeof rect.left == 'number' ? rect.left : Number(rect.x) || 0,
			top = typeof rect.top == 'number' ? rect.top : Number(rect.y) || 0,
			width = Number(rect.width) || 0,
			height = Number(rect.height) || 0
		return { x: round2(left), y: round2(top), width: round2(width), height: round2(height), left, top, right: left + width, bottom: top + height }
	}
	function ancestryOf(element) {
		for (var out = [], node = element.parentElement, guard = 0; node && out.length < 6 && guard < 20; ) {
			var id = ''
			try {
				id = node.id || ''
			} catch {
				id = ''
			}
			;(out.push({ tag: localName(node), id, classes: classesOf(node).slice(0, 4), selector: cssPath(node) }), (node = node.parentElement), (guard += 1))
		}
		return out
	}
	function safeMatches(element, selector) {
		try {
			if (typeof element.matches == 'function') return element.matches(selector)
		} catch {
			return !1
		}
		return !1
	}
