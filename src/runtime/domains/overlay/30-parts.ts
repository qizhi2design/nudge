// @ts-nocheck
	function ensureOverlay() {
		if (!root) createOverlay()
		else if (!root.parentNode)
			try {
				;(doc.documentElement || doc.body).appendChild(root)
			} catch {}
		return layer
	}
	function layerAppend(node) {
		layer || ensureOverlay()
		try {
			layer.appendChild(node)
		} catch {}
	}
	function visualNeeded() {
		return !!(selectionEl || hoverEl || annotations.length > 0 || popover || designCard || drag || flashTarget)
	}
	function regionBox(region) {
		return region ? { left: Number(region.x) || 0, top: Number(region.y) || 0, width: Math.max(0, Number(region.width) || 0), height: Math.max(0, Number(region.height) || 0), right: (Number(region.x) || 0) + (Number(region.width) || 0), bottom: (Number(region.y) || 0) + (Number(region.height) || 0) } : null
	}
	function positionPart(node, box, color, borderWidth) {
		if (node) {
			if (!box || (box.width <= 0 && box.height <= 0)) {
				node.style.setProperty('display', 'none')
				return
			}
			;(node.style.setProperty('display', 'block'),
				node.style.setProperty('left', box.left + 'px'),
				node.style.setProperty('top', box.top + 'px'),
				node.style.setProperty('width', Math.max(0, box.width) + 'px'),
				node.style.setProperty('height', Math.max(0, box.height) + 'px'),
				color && node.style.setProperty('border-color', color),
				borderWidth && node.style.setProperty('border-width', borderWidth + 'px'))
		}
	}
	function hidePart(node) {
		node && node.style.setProperty('display', 'none')
	}
