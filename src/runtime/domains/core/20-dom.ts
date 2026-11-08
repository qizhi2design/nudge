// @ts-nocheck
	function hasOwn(object, key) {
		return Object.prototype.hasOwnProperty.call(object, key)
	}
	function isElement(node) {
		return !!node && node.nodeType === 1
	}
	function isConnected(node) {
		if (!node) return !1
		try {
			if (typeof node.isConnected == 'boolean') return node.isConnected
		} catch {}
		try {
			return !!(doc.documentElement && doc.documentElement.contains && doc.documentElement.contains(node))
		} catch {
			return !1
		}
	}
	function localName(node) {
		if (!node) return ''
		var name = node.localName || node.tagName || ''
		return String(name)
	}
	function tagLower(node) {
		return localName(node).toLowerCase()
	}
	function clamp(value, min, max) {
		return value < min ? min : value > max ? max : value
	}
	function round2(value) {
		var n = Number(value)
		return isFinite(n) ? Math.round(n * 100) / 100 : 0
	}
	function cssPropertyName(name) {
		var text = String(name == null ? '' : name).trim()
		return text === ''
			? ''
			: text.indexOf('--') === 0 || text.indexOf('-') !== -1
				? text
				: text.replace(/[A-Z]/g, function (letter) {
						return '-' + letter.toLowerCase()
					})
	}
	function camelPropertyName(name) {
		var text = String(name || '')
		return text.indexOf('--') === 0
			? text
			: text.replace(/-([a-z])/g, function (match, letter) {
					return letter.toUpperCase()
				})
	}
	function setStyleMap(node, values, important) {
		if (!(!node || !node.style || !values)) {
			for (var key in values)
				if (hasOwn(values, key))
					try {
						node.style.setProperty(cssPropertyName(key), String(values[key]), important ? 'important' : '')
					} catch {}
		}
	}
	function setStyle(node, property, value, important) {
		if (!(!node || !node.style))
			try {
				node.style.setProperty(cssPropertyName(property), String(value), important ? 'important' : '')
			} catch {}
	}
	function removeNode(node) {
		if (node)
			try {
				node.parentNode && node.parentNode.removeChild(node)
			} catch {}
	}
	function viewportWidth() {
		return Number(win.innerWidth) || (doc.documentElement && Number(doc.documentElement.clientWidth)) || 1024
	}
	function viewportHeight() {
		return Number(win.innerHeight) || (doc.documentElement && Number(doc.documentElement.clientHeight)) || 768
	}
	function locationHref() {
		try {
			return String((win.location && win.location.href) || '')
		} catch {
			return ''
		}
	}
	function pageTitle() {
		try {
			return String(doc.title || '')
		} catch {
			return ''
		}
	}
	function alphaColor(color, alpha) {
		var text = String(color == null ? '' : color).trim(),
			match = /^#([0-9a-f]{3})$/i.exec(text)
		if (match) {
			var chars = match[1],
				r = parseInt(chars.charAt(0) + chars.charAt(0), 16),
				g = parseInt(chars.charAt(1) + chars.charAt(1), 16),
				b = parseInt(chars.charAt(2) + chars.charAt(2), 16)
			return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')'
		}
		if (((match = /^#([0-9a-f]{6})$/i.exec(text)), match)) {
			var hex = match[1]
			return 'rgba(' + parseInt(hex.slice(0, 2), 16) + ',' + parseInt(hex.slice(2, 4), 16) + ',' + parseInt(hex.slice(4, 6), 16) + ',' + alpha + ')'
		}
		if (((match = /^rgba?\(([^)]+)\)$/i.exec(text)), match)) {
			var channels = match[1].split(',')
			if (channels.length >= 3) return 'rgba(' + String(channels[0]).trim() + ',' + String(channels[1]).trim() + ',' + String(channels[2]).trim() + ',' + alpha + ')'
		}
		return 'rgba(79,140,255,' + alpha + ')'
	}
	function cssEscape(value) {
		var text = String(value == null ? '' : value)
		if (win.CSS && typeof win.CSS.escape == 'function')
			try {
				return win.CSS.escape(text)
			} catch {}
		var escaped = text.replace(/[^a-zA-Z0-9_-]/g, function (character) {
			return '\\' + character
		})
		return (/^[0-9]/.test(escaped) && (escaped = '\\3' + escaped.charAt(0) + ' ' + escaped.slice(1)), escaped)
	}
	function classesOf(node) {
		var raw = ''
		try {
			raw = node.getAttribute ? node.getAttribute('class') || '' : node.className || ''
		} catch {
			raw = ''
		}
		typeof raw != 'string' && (raw = String(raw || ''))
		for (var pieces = raw.split(/\s+/), out = [], index = 0; index < pieces.length; index += 1) {
			var name = pieces[index]
			name && out.indexOf(name) === -1 && out.length < 16 && out.push(name)
		}
		return out
	}
	function isOwnNode(node) {
		if (!node) return !1
		if (root && node === root) return !0
		for (var current = node, guard = 0; current && guard < 64; ) {
			if (root && current === root) return !0
			if (current.nodeType === 11 && current.host) {
				;((current = current.host), (guard += 1))
				continue
			}
			if (current.nodeType === 1 && current.getAttribute && current.getAttribute(ROOT_ATTR) !== null) return !0
			;((current = current.parentNode || current.host || null), (guard += 1))
		}
		return !1
	}
