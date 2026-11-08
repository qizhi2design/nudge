// @ts-nocheck
	function queueEvent(type, payload) {
		var event = { type }
		if (payload) for (var key in payload) hasOwn(payload, key) && (event[key] = payload[key])
		;(events.push(event), events.length > MAX_EVENTS && events.splice(0, events.length - MAX_EVENTS))
	}
	function cloneAnnotation(annotation) {
		if (!annotation) return null
		var copy = { id: annotation.id, selector: annotation.selector, note: annotation.note, element: annotation.element, createdAt: annotation.createdAt, updatedAt: annotation.updatedAt }
		return (annotation.region && (copy.region = { x: annotation.region.x, y: annotation.region.y, width: annotation.region.width, height: annotation.region.height }), annotation.textSelection && (copy.textSelection = { text: annotation.textSelection.text, rect: annotation.textSelection.rect, rects: annotation.textSelection.rects, selector: annotation.textSelection.selector, path: annotation.textSelection.path }), copy)
	}
	function findAnnotation(id) {
		for (var index = 0; index < annotations.length; index += 1) if (annotations[index].id === id) return annotations[index]
		return null
	}
	function makeAnnotationId() {
		return 'ann_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
	}
	function checkPageInfo() {
		if (!destroyed) {
			var url = locationHref(),
				title = pageTitle()
			;(url === lastUrl && title === lastPageTitle) || ((lastUrl = url), (lastPageTitle = title), queueEvent('page-info', { url, title }))
		}
	}
	function schedulePageCheck() {
		if (!(destroyed || navTimer !== null)) {
			var timer = win.setTimeout || setTimeout
			navTimer = timer.call(
				win,
				function () {
					;((navTimer = null), checkPageInfo())
				},
				0
			)
		}
	}
	function makePart(tag, name, styles) {
		var node = doc.createElement(tag)
		try {
			;(node.setAttribute(PART_ATTR, name), node.setAttribute('aria-hidden', 'true'))
		} catch {}
		return (setStyleMap(node, styles), layer.appendChild(node), node)
	}
	function isEditableEvent(event) {
		for (var path = eventPath(event), index = 0; index < path.length; index += 1) {
			if (isEditableTarget(path[index])) return !0
		}
		return isEditableTarget(event && event.target)
	}
	function isEditableTarget(node) {
		for (var current = node, guard = 0; current && current.nodeType === 1 && guard < 12; ) {
			var name = tagLower(current)
			if (name === 'input' || name === 'textarea' || name === 'select') return !0
			if (current.isContentEditable === !0) return !0
			try {
				var role = current.getAttribute && current.getAttribute('role')
				if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return !0
			} catch {}
			current = current.parentElement
			guard += 1
		}
		return !1
	}
