// @ts-nocheck
	function onDocumentClick(event) {
		if (!(destroyed || !event) && !isOverlayEvent(event)) {
			if (passthrough) return
			if (mode === 'browse') {
				popover && closePopover()
				return
			}
			if (!(typeof event.button == 'number' && event.button !== 0)) {
				if (Date.now() < suppressClickUntil) {
					try {
						;(event.preventDefault(), event.stopPropagation())
					} catch {}
					return
				}
				if (mode === 'annotate') {
					var textInfo = textSelectionOf()
					if (textInfo) {
						try {
							;(event.preventDefault(), event.stopPropagation())
						} catch {}
						suppressClickUntil = Date.now() + 450
						openTextSelection(textInfo)
						return
					}
				}
				var target = composedTarget(event)
				if (target) {
					try {
						;(event.preventDefault(), event.stopPropagation())
					} catch {}
					if (designCard) {
						;(selectElement(target, !0), openDesignCard(target))
					} else if (mode === 'annotate') {
						var existing = annotationForElement(target)
						selectElement(target, !0)
						existing ? openAnnotationEditor(existing.id) : openPopover({ element: target })
					} else {
						;(selectElement(target, !0), mode === 'edit' ? openDesignCard(target) : popover && closePopover())
					}
				}
			}
		}
	}
	function onDocumentMouseMove(event) {
		if (destroyed || !event) return
		pointerX = Number(event.clientX) || 0
		pointerY = Number(event.clientY) || 0
		pointerSeen = !0
		var overOverlay = isOverlayEvent(event)
		if (!passthrough && !popover && !overOverlay) syncPointerCursor()
		else hidePart(parts && parts.cursor)
		if (overOverlay) hidePart(parts && parts.meta)
		else if (hoverEl && !passthrough && !popover && mode !== 'browse') updateMeta()
		if (mode === 'browse' || passthrough) {
			if (passthrough && hoverEl) {
				hoverEl = null
				updateVisuals()
			}
			return
		}
		if (!(mode === 'browse' || !event)) {
			if (drag) {
				;((drag.x = Number(event.clientX) || 0), (drag.y = Number(event.clientY) || 0))
				if (drag.textStart) return
				if (!drag.active) {
					var dx = drag.x - drag.startX,
						dy = drag.y - drag.startY
					Math.sqrt(dx * dx + dy * dy) > 8 && ((drag.active = !0), ensureOverlay())
				}
				if (drag.active) {
					try {
						event.preventDefault()
					} catch {}
					;(updateVisuals(), scheduleFrame())
				}
				return
			}
			if (!isOverlayEvent(event)) {
				var target = composedTarget(event)
				target !== hoverEl && ((hoverEl = target), ensureOverlay(), updateVisuals(), scheduleFrame())
			}
		}
	}
	function onDocumentMouseDown(event) {
		if (destroyed || passthrough || !event) return
		if (!(destroyed || mode !== 'annotate' || !event) && !isOverlayEvent(event) && !(typeof event.button == 'number' && event.button !== 0)) {
			var target = composedTarget(event)
			target && ((drag = { startX: Number(event.clientX) || 0, startY: Number(event.clientY) || 0, x: Number(event.clientX) || 0, y: Number(event.clientY) || 0, active: !1, target, textStart: !!caretAtPoint(Number(event.clientX) || 0, Number(event.clientY) || 0) }))
		}
	}
	function onDocumentMouseUp(event) {
		if (destroyed || !event) return
		if (passthrough) {
			drag = null
			parts && parts.marquee && hidePart(parts.marquee)
			scheduleFrame()
			return
		}
		if (!(destroyed || !drag)) {
			var current = drag
			;((drag = null), parts && hidePart(parts.marquee))
			if (current.textStart) {
				var selected = textSelectionOf()
				if (selected) {
					try {
						event && (event.preventDefault(), event.stopPropagation())
					} catch {}
					suppressClickUntil = Date.now() + 450
					openTextSelection(selected)
					return
				}
				var textDx = current.x - current.startX,
					textDy = current.y - current.startY
				if (Math.sqrt(textDx * textDx + textDy * textDy) <= 8) {
					scheduleFrame()
					return
				}
				current.active = !0
			}
			if (!current.active) {
				scheduleFrame()
				return
			}
			try {
				event && (event.preventDefault(), event.stopPropagation())
			} catch {}
			suppressClickUntil = Date.now() + 450
			var left = Math.min(current.startX, current.x),
				top = Math.min(current.startY, current.y),
				width = Math.abs(current.x - current.startX),
				height = Math.abs(current.y - current.startY)
			if (width < 2 || height < 2) {
				scheduleFrame()
				return
			}
			var region = normalizeRegion({ x: left, y: top, width, height }),
				element = elementAtPoint(left + width / 2, top + height / 2) || current.target || doc.body
			;(element && isOwnNode(element) && (element = current.target || doc.body), queueEvent('region-select', { region, selector: element ? cssPath(element) : '', descriptor: element ? descriptorOf(element) : null }), openPopover({ element, region }), updateVisuals(), scheduleFrame())
		}
	}
	function onDocumentMouseOut(event) {
		if (destroyed || !event || event.relatedTarget) return
		hoverEl = null
		pointerSeen = !1
		syncPointerCursor()
		root && updateVisuals()
	}
	function onKeyDown(event) {
		if (destroyed || !event) return
		var key = event.key || '',
			code = event.code || ''
		if ((key === ' ' || code === 'Space') && !popover && !isEditableEvent(event)) {
			if (event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
			if (mode !== 'browse') {
				try {
					;(event.preventDefault(), event.stopPropagation())
				} catch {}
				setPassthrough(!0)
				return
			}
		}
		if (key === 'Escape' && passthrough) {
			try {
				;(event.preventDefault(), event.stopPropagation())
			} catch {}
			setPassthrough(!1)
			return
		}
		if (key === 'Escape') {
			if (designCard) {
				try {
					;(event.preventDefault(), event.stopPropagation())
				} catch {}
				closeDesignCard(!0)
				return
			}
			if (popover) {
				try {
					;(event.preventDefault(), event.stopPropagation())
				} catch {}
				closePopover()
				return
			}
			drag && ((drag = null), parts && hidePart(parts.marquee), scheduleFrame())
		}
	}
	function onKeyUp(event) {
		if (destroyed || !event) return
		if ((event.key === ' ' || event.code === 'Space') && passthrough) {
			try {
				;(event.preventDefault(), event.stopPropagation())
			} catch {}
			setPassthrough(!1)
		}
	}
	function onWindowBlur() {
		if (destroyed) return
		passthrough = !1
		pointerSeen = !1
		hoverEl = null
		removeCursorStyle()
		syncPointerCursor()
		root && updateVisuals()
	}
	function onScroll() {
		destroyed || (visualNeeded() && scheduleFrame())
	}
	function onResize() {
		destroyed || (visualNeeded() && scheduleFrame())
	}
	function listen(target, type, handler, capture) {
		if (!(!target || typeof target.addEventListener != 'function'))
			try {
				;(target.addEventListener(type, handler, capture === !0),
					listenerOffs.push(function () {
						try {
							target.removeEventListener(type, handler, capture === !0)
						} catch {}
					}))
			} catch {}
	}
