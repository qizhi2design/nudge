// @ts-nocheck
	function eventPath(event) {
		if (!event) return []
		try {
			if (typeof event.composedPath == 'function') {
				var path = event.composedPath()
				if (path && path.length) return path
			}
		} catch {}
		for (var nodes = [], node = event.target || null, guard = 0; node && guard < 100; ) (nodes.push(node), (node = node.parentNode || node.host || null), (guard += 1))
		return nodes
	}
	function isOverlayEvent(event) {
		for (var path = eventPath(event), index = 0; index < path.length; index += 1) {
			var node = path[index]
			if (node && ((root && (node === root || node === layer)) || (node.nodeType === 1 && node.getAttribute && node.getAttribute(ROOT_ATTR) !== null))) return !0
		}
		return !1
	}
	function composedTarget(event) {
		for (var path = eventPath(event), index = 0; index < path.length; index += 1) {
			var node = path[index]
			if (node && node.nodeType === 1) return isOwnNode(node) ? null : node
		}
		return null
	}
	function elementAtPoint(x, y) {
		var element = null
		try {
			element = doc.elementFromPoint ? doc.elementFromPoint(x, y) : null
		} catch {
			element = null
		}
		for (var guard = 0; element && element.shadowRoot && element.shadowRoot.elementFromPoint && guard < 8; ) {
			var inner = null
			try {
				inner = element.shadowRoot.elementFromPoint(x, y)
			} catch {
				inner = null
			}
			if (!inner || inner === element) break
			;((element = inner), (guard += 1))
		}
		return element
	}
