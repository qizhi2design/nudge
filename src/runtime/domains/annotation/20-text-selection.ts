// @ts-nocheck
	function caretAtPoint(x, y) {
		var range = null
		try {
			if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(x, y)
			else if (doc.caretPositionFromPoint) {
				var pos = doc.caretPositionFromPoint(x, y)
				if (pos) {
					range = doc.createRange()
					range.setStart(pos.offsetNode, pos.offset)
					range.collapse(!0)
				}
			}
		} catch {}
		var node = range && range.startContainer
		if (!node || node.nodeType !== 3 || !node.nodeValue || String(node.nodeValue).trim() === '') return null
		var element = node.parentElement
		if (!element || isOwnNode(element)) return null
		try {
			var word = doc.createRange()
			;(word.setStart(node, range.startOffset), word.setEnd(node, range.endOffset), typeof word.expand == 'function' && word.expand('word'))
			var rects = word.getClientRects()
			for (var index = 0; index < rects.length; index += 1) {
				var rect = rects[index]
				if (rect && rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return node
			}
		} catch {}
		return null
	}
	function textSelectionOf() {
		var selection = null
		try {
			selection = win.getSelection ? win.getSelection() : null
		} catch {
			selection = null
		}
		if (!selection || !selection.rangeCount || selection.isCollapsed) return null
		var text = String(selection.toString() || '').trim()
		if (text.length === 0) return null
		var range = null
		try {
			range = selection.getRangeAt(0)
		} catch {
			return null
		}
		var node = range.commonAncestorContainer
		var element = node && node.nodeType === 1 ? node : node && node.parentElement
		if (!element || isOwnNode(element)) return null
		var rects = []
		try {
			var list = range.getClientRects()
			for (var index = 0; index < list.length && index < 24; index += 1) {
				var item = list[index]
				if (item && item.width > 0 && item.height > 0) rects.push({ x: round2(item.left), y: round2(item.top), width: round2(item.width), height: round2(item.height) })
			}
		} catch {}
		if (rects.length === 0) return null
		var left = Math.min.apply(null, rects.map(function (r) { return r.x })),
			top = Math.min.apply(null, rects.map(function (r) { return r.y })),
			right = Math.max.apply(null, rects.map(function (r) { return r.x + r.width })),
			bottom = Math.max.apply(null, rects.map(function (r) { return r.y + r.height }))
		return {
			text: text.length > 2000 ? text.slice(0, 2000) : text,
			rect: { x: round2(left), y: round2(top), width: round2(right - left), height: round2(bottom - top) },
			rects: rects,
			selector: cssPath(element),
			path: pathOf(element),
			range: range
		}
	}
	function refreshTextSelectionDraft() {
		if (!popover || !popover.draft || !popover.draft.textSelection || !popover.draft.textSelection.range) return
		var range = popover.draft.textSelection.range
		try {
			var list = range.getClientRects(),
				rects = []
			for (var index = 0; index < list.length && index < 24; index += 1) {
				var item = list[index]
				if (item && item.width > 0 && item.height > 0) rects.push({ x: round2(item.left), y: round2(item.top), width: round2(item.width), height: round2(item.height) })
			}
			if (rects.length === 0) return
			var left = Math.min.apply(null, rects.map(function (r) { return r.x })),
				top = Math.min.apply(null, rects.map(function (r) { return r.y })),
				right = Math.max.apply(null, rects.map(function (r) { return r.x + r.width })),
				bottom = Math.max.apply(null, rects.map(function (r) { return r.y + r.height }))
			;(popover.draft.textSelection.rects = rects), (popover.draft.textSelection.rect = { x: round2(left), y: round2(top), width: round2(right - left), height: round2(bottom - top) })
		} catch {}
	}
	function updateTextLayer() {
		if (!parts || !parts.textLayer) return
		while (parts.textLayer.firstChild) parts.textLayer.removeChild(parts.textLayer.firstChild)
		var text = popover && popover.draft && popover.draft.textSelection ? popover.draft.textSelection : null
		if (!text || passthrough) return
		var rects = text.rects && text.rects.length ? text.rects : text.rect ? [text.rect] : []
		for (var index = 0; index < rects.length; index += 1) {
			var item = rects[index],
				node = doc.createElement('div')
			setStyleMap(node, { position: 'fixed', left: item.x + 'px', top: item.y + 'px', width: item.width + 'px', height: item.height + 'px', borderRadius: '2px', background: '#128dff66', pointerEvents: 'none', margin: '0px', padding: '0px' })
			parts.textLayer.appendChild(node)
		}
	}
	function openTextSelection(textSelection) {
		if (!textSelection || !textSelection.rect) return !1
		var element = null
		try {
			element = resolveSelector(textSelection.selector)
		} catch {}
		if (!element) {
			var node = textSelection.range && textSelection.range.commonAncestorContainer
			element = node && node.nodeType === 1 ? node : node && node.parentElement
		}
		if (!element) return !1
		try {
			var selection = win.getSelection ? win.getSelection() : null
			selection && selection.removeAllRanges()
		} catch {}
		;(selectElement(element, !0), openPopover({ element, textSelection }))
		updateVisuals()
		scheduleFrame()
		return !0
	}
