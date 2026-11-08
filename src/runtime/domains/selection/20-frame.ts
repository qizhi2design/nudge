// @ts-nocheck
	function scheduleFrame() {
		if (!(destroyed || suspended || frameQueued)) {
			frameQueued = !0
			var request = win.requestAnimationFrame
			if (typeof request == 'function') ((rafUsesTimeout = !1), (rafId = request.call(win, onFrame)))
			else {
				rafUsesTimeout = !0
				var timer = win.setTimeout || setTimeout
				rafId = timer.call(win, onFrame, 16)
			}
		}
	}
	function onFrame() {
		;((frameQueued = !1), (rafId = 0), !destroyed && (updateVisuals(), visualNeeded() && scheduleFrame()))
	}
	function selectElement(element, emitEvent) {
		return !element || element.nodeType !== 1 || isOwnNode(element) ? !1 : ((selectionEl = element), (selectionSelector = cssPath(element)), ensureOverlay(), updateVisuals(), scheduleFrame(), emitEvent && queueEvent('select', { descriptor: descriptorOf(element) }), !0)
	}
	function setSelection(selector) {
		if (destroyed) return null
		var element = typeof selector == 'string' ? resolveSelector(selector) : null
		return !element || (popover && closePopover(), designCard && closeDesignCard(!1), !selectElement(element, !1)) ? null : descriptorOf(element)
	}
	function clearSelection() {
		return destroyed ? !1 : ((selectionEl = null), (selectionSelector = ''), (hoverEl = null), popover && closePopover(), designCard && closeDesignCard(!1), updateVisuals(), scheduleFrame(), !0)
	}
	function setSelectionByPath(path) {
		if (destroyed) return null
		var element = resolvePath(path)
		return !element || element.nodeType !== 1 || isOwnNode(element) || (popover && closePopover(), designCard && closeDesignCard(!1), !selectElement(element, !1)) ? null : descriptorOf(element)
	}
	function locate(selector) {
		if (destroyed) return { ok: !1, reason: 'destroyed' }
		var element = resolveSelector(selector)
		if (!element) return { ok: !1, reason: 'not-found' }
		try {
			typeof element.scrollIntoView == 'function' && element.scrollIntoView({ block: 'center', inline: 'nearest' })
		} catch {
			try {
				element.scrollIntoView()
			} catch {}
		}
		if ((selectElement(element, !1), (flashTarget = element), ensureOverlay(), flashTimer !== null)) {
			try {
				;(win.clearTimeout || clearTimeout)(flashTimer)
			} catch {}
			flashTimer = null
		}
		if (parts && parts.flash) {
			;(positionPart(parts.flash, rectOf(element), annotationAccentColor(), 2), parts.flash.style.setProperty('background', alphaColor(annotationAccentColor(), 0.18)), parts.flash.style.setProperty('display', 'block'))
			var timer = win.setTimeout || setTimeout
			flashTimer = timer.call(
				win,
				function () {
					;((flashTimer = null), (flashTarget = null), parts && parts.flash && parts.flash.style.setProperty('display', 'none'))
				},
				650
			)
		}
		return (updateVisuals(), scheduleFrame(), { ok: !0, selector: selectionSelector })
	}
