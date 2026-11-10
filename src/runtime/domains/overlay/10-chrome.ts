// @ts-nocheck
	function ensureCursorStyle() {
		if (cursorStyleEl && cursorStyleEl.parentNode) return cursorStyleEl
		if (cursorSheet) return cursorSheet
		try {
			var Sheet = win.CSSStyleSheet || (typeof CSSStyleSheet == 'function' ? CSSStyleSheet : null)
			if (Sheet && doc.adoptedStyleSheets && typeof Sheet.prototype.replaceSync == 'function') {
				var sheet = new Sheet()
				;(sheet.replaceSync(CURSOR_CSS), (doc.adoptedStyleSheets = doc.adoptedStyleSheets.concat([sheet])), (cursorSheet = sheet))
				return sheet
			}
		} catch {}
		try {
			var style = doc.createElement('style')
			style.setAttribute(CURSOR_STYLE_ATTR, '')
			style.textContent = CURSOR_CSS
			;(doc.head || doc.documentElement).appendChild(style)
			cursorStyleEl = style
		} catch {
			cursorStyleEl = null
		}
		return cursorStyleEl
	}
	function removeCursorStyle() {
		if (cursorSheet) {
			try {
				doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(function (sheet) { return sheet !== cursorSheet })
			} catch {}
			cursorSheet = null
		}
		if (!cursorStyleEl) return
		try {
			cursorStyleEl.parentNode && cursorStyleEl.parentNode.removeChild(cursorStyleEl)
		} catch {}
		cursorStyleEl = null
	}
	function radiusOf(element) {
		if (!element || element.nodeType !== 1) return '3px'
		try {
			var computed = win.getComputedStyle(element),
				candidates = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'],
				value = 0
			for (var index = 0; index < candidates.length; index += 1) {
				var parsed = parseFloat(computed[candidates[index]])
				parsed > value && (value = parsed)
			}
			return Math.min(24, Math.max(0, Math.round(value))) + 'px'
		} catch {
			return '3px'
		}
	}
	function overlayIcon(name, size) {
		// Glyph geometry is generated from the Lucide icon sources at build time.
		var nodes = (typeof LUCIDE_ICON_NODES != 'undefined' && (LUCIDE_ICON_NODES[name] || LUCIDE_ICON_NODES.message)) || []
		var createSvg = typeof doc.createElementNS == 'function'
			? function (tag) { return doc.createElementNS('http://www.w3.org/2000/svg', tag) }
			: function (tag) { return doc.createElement(tag) }
		var svg = createSvg('svg')
		;(svg.setAttribute('viewBox', '0 0 24 24'), svg.setAttribute('width', String(size || 14)), svg.setAttribute('height', String(size || 14)), svg.setAttribute('fill', 'none'), svg.setAttribute('stroke', 'currentColor'), svg.setAttribute('stroke-width', '2'), svg.setAttribute('stroke-linecap', 'round'), svg.setAttribute('stroke-linejoin', 'round'), svg.setAttribute('aria-hidden', 'true'))
		nodes.forEach(function (node) {
			if (!node || !node[0]) return
			var child = createSvg(node[0]),
				attrs = node[1] || {}
			for (var key in attrs) hasOwn(attrs, key) && child.setAttribute(key, String(attrs[key]))
			svg.appendChild(child)
		})
		return svg
	}
	function overlayIconButton(iconName, label, size) {
		var button = doc.createElement('button')
		;(button.setAttribute('type', 'button'), button.setAttribute('aria-label', label), button.setAttribute('title', label))
		setStyleMap(button, {
			width: '28px',
			height: '28px',
			flex: 'none',
			display: 'inline-flex',
			alignItems: 'center',
			justifyContent: 'center',
			padding: '0px',
			border: '0px',
			borderRadius: '8px',
			background: 'transparent',
			color: overlayPalette().muted,
			cursor: 'pointer',
			margin: '0px'
		})
		var icon = overlayIcon(iconName, size || 15)
		try {
			icon.style.setProperty('display', 'block')
		} catch {}
		button.appendChild(icon)
		button.addEventListener('mouseenter', function () {
			try {
				var palette = overlayPalette()
				;(button.style.setProperty('background', palette.hover), button.style.setProperty('color', palette.text))
			} catch {}
		})
		button.addEventListener('mouseleave', function () {
			try {
				;(button.style.setProperty('background', 'transparent'), button.style.setProperty('color', overlayPalette().muted))
			} catch {}
		})
		return button
	}
	function overlayTextButton(label, iconName, primary, onClick) {
		var button = doc.createElement('button')
		;(button.setAttribute('type', 'button'), button.setAttribute('aria-label', label), button.setAttribute('title', label))
		var palette = overlayPalette()
		setStyleMap(button, {
			height: '30px',
			display: 'inline-flex',
			alignItems: 'center',
			justifyContent: 'center',
			gap: '5px',
			padding: primary ? '0 12px' : '0 8px',
			border: '1px solid ' + (primary ? 'transparent' : palette.border),
			borderRadius: '999px',
			background: primary ? palette.accent : 'transparent',
			color: primary ? palette.onAccent : palette.muted,
			font: '600 11.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
			cursor: 'pointer',
			whiteSpace: 'nowrap',
			margin: '0px'
		})
		if (iconName) button.appendChild(overlayIcon(iconName, 13))
		if (label) {
			var text = doc.createElement('span')
			;(text.textContent = label, button.appendChild(text))
		}
		button.addEventListener('click', function (event) {
			;(event && (event.preventDefault(), event.stopPropagation()), onClick())
		})
		return button
	}
	function setPassthrough(next) {
		if (destroyed) return !1
		var value = !!next && mode !== 'browse' && !popover
		if (passthrough === value) return !0
		passthrough = value
		if (value) {
			;((hoverEl = null), (drag = null), parts && parts.marquee && hidePart(parts.marquee), parts && parts.drop && hidePart(parts.drop), removeCursorStyle(), hidePart(parts && parts.cursor), hidePart(parts && parts.meta))
		}
		try {
			root && root.setAttribute(PASSTHROUGH_ATTR, value ? 'true' : 'false')
		} catch {}
		syncPointerCursor()
		updateVisuals()
		scheduleFrame()
		return !0
	}
	function syncPointerCursor() {
		if (!parts) return
		var visible = (mode === 'annotate' || mode === 'edit') && !passthrough && !popover && pointerSeen && !(drag && drag.active)
		if (visible) {
			ensureCursorStyle()
			parts.cursor && parts.cursor.style.setProperty('display', 'block')
			positionPointerCursor()
		} else {
			removeCursorStyle()
			hidePart(parts.cursor)
		}
	}
	function positionPointerCursor() {
		if (!parts || !parts.cursor) return
		var size = 26,
			left = Math.max(0, Math.min(pointerX, Math.max(0, viewportWidth() - size))),
			top = Math.max(0, Math.min(pointerY - size, Math.max(0, viewportHeight() - size)))
		parts.cursor.style.setProperty('left', left + 'px')
		parts.cursor.style.setProperty('top', top + 'px')
	}
	/** Shadow CSS shared by the injected chrome; re-applied on every theme flip. */
	function overlayShadowStyleText() {
		return '@keyframes dshViPopIn{from{opacity:0;transform:translateY(5px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}' +
			'[data-dsh-nudge="popover"]{animation:dshViPopIn 180ms cubic-bezier(0.23,1,0.32,1);transform-origin:top left}' +
			'[data-dsh-nudge="popover"] textarea{outline:none}' +
			'[data-dsh-nudge="popover"] textarea:focus{border-color:transparent}' +
			'[data-dsh-nudge="bar"] svg,[data-dsh-nudge="popover"] svg,[data-dsh-nudge="design"] svg{display:block}' +
			'[data-dsh-nudge="popover"] textarea::placeholder{color:' + overlayPlaceholderColor() + '}' +
			'@media(prefers-reduced-motion:reduce){[data-dsh-nudge="popover"]{animation:none}[data-dsh-nudge="hover"],[data-dsh-nudge="badge"],[data-dsh-nudge="draft"]{transition:none!important}}'
	}
	function ensureShadowStyle() {
		if (!layer || typeof layer.querySelector != 'function') return
		try {
			var style = layer.querySelector('style[' + PART_ATTR + '="style"]')
			if (!style) {
				style = doc.createElement('style')
				style.setAttribute(PART_ATTR, 'style')
				layer.appendChild(style)
			}
			style.textContent = overlayShadowStyleText()
		} catch {}
	}
	/**
	 * Enabled/disabled send pill, expressed with palette tokens only. The disabled
	 * state keeps a readable ink instead of fading the whole button with opacity.
	 */
	function applyBarSendTheme() {
		if (!parts || !parts.barSend) return
		var palette = overlayPalette(),
			disabled = annotations.length === 0
		try {
			;(parts.barSend.style.setProperty('background', disabled ? palette.accentDisabled : palette.accent),
				parts.barSend.style.setProperty('color', disabled ? palette.onAccentDisabled : palette.onAccent),
				typeof parts.barSend.style.removeProperty == 'function' && parts.barSend.style.removeProperty('opacity'),
				parts.barSend.setAttribute('aria-disabled', disabled ? 'true' : 'false'),
				parts.barSend.style.setProperty('cursor', disabled ? 'default' : 'pointer'))
		} catch {}
	}
	/**
	 * Idempotent restyle of the bottom annotate bar (built once in createOverlay,
	 * so it needs an explicit repaint when the host theme flips). Safe when the bar
	 * has not been built yet, and preserves the armed-discard danger colour.
	 */
	function applyBarTheme() {
		if (!parts || !parts.bar) return
		var palette = overlayPalette()
		try {
			;(parts.bar.style.setProperty('border-color', palette.border),
				parts.bar.style.setProperty('background', palette.bgStrong),
				parts.bar.style.setProperty('color', palette.text),
				parts.bar.style.setProperty('box-shadow', palette.barShadow),
				parts.barGrip && parts.barGrip.style.setProperty('color', palette.muted),
				parts.barCount && parts.barCount.style.setProperty('color', palette.text),
				parts.barSend && applyBarSendTheme(),
				parts.barExit && parts.barExit.style.setProperty('color', palette.muted),
				parts.barLocate && parts.barLocate.style.setProperty('color', palette.muted),
				parts.barMarkers && parts.barMarkers.style.setProperty('color', palette.muted),
				parts.barDiscard && parts.barDiscard.style.setProperty('color', discardArmed ? theme.danger : palette.muted))
		} catch {}
	}
