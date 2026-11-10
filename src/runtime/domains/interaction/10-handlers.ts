// @ts-nocheck
	/**
	 * Resolve the structural drop for a pointer position: the middle band of a
	 * container means "nest inside"; the top/bottom band of an element means
	 * "reorder next to it" inside that element's parent.
	 */
	function structureDropAt(source, x, y) {
		for (var node = elementAtPoint(x, y), guard = 0; node && node.nodeType === 1 && node !== doc.documentElement && guard < 60; guard += 1) {
			if (isOwnNode(node)) return null
			if (node === source || (source.contains && source.contains(node))) return null
			var tag = tagLower(node)
			if (tag === 'html' || tag === 'head') return null
			var box = rectOf(node),
				children = elementChildrenOf(node),
				vertical = box.height > 0 ? (y - box.top) / box.height : 0.5
			if (!STRUCTURE_NO_CHILDREN[tag] && (children.length > 0 || (box.width >= 80 && box.height >= 40)) && vertical > 0.32 && vertical < 0.68) return { parent: node, before: null, mode: 'inside', box: box }
			var parent = node.parentElement
			if (!parent || parent.nodeType !== 1 || parent === doc.documentElement || isOwnNode(parent)) return null
			if (parent === source || (source.contains && source.contains(parent))) return null
			var before = vertical < 0.5 ? node : structureNextSiblingOf(node)
			if (before === source) return null
			if (!before) return { parent: parent, before: null, mode: 'append', line: { left: box.left, top: box.bottom, width: box.width } }
			return { parent: parent, before: before, mode: 'before', line: { left: box.left, top: vertical < 0.5 ? box.top : box.bottom, width: box.width } }
		}
		return null
	}
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
		if (overOverlay) {
			// The pointer is on our own panel: it keeps the native cursor and must
			// not keep the page hover chrome around the previously hovered element.
			hidePart(parts && parts.meta)
			scheduleFrame()
		} else if (hoverEl && !passthrough && !popover && mode !== 'browse') updateMeta()
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
					if (drag.structure) drag.drop = structureDropAt(drag.target, drag.x, drag.y)
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
		if (isOverlayEvent(event) || (typeof event.button == 'number' && event.button !== 0)) return
		var target = composedTarget(event)
		if (!target) return
		var x = Number(event.clientX) || 0,
			y = Number(event.clientY) || 0
		if (mode === 'annotate') {
			drag = { startX: x, startY: y, x: x, y: y, active: !1, target: target, textStart: !!caretAtPoint(x, y) }
			return
		}
		// Edit mode: a press-and-drag over the page reorders / re-parents the
		// pressed element; a plain click keeps its existing "open the card" path.
		if (mode === 'edit' && !isEditableTarget(target)) drag = { startX: x, startY: y, x: x, y: y, active: !1, target: target, textStart: !1, structure: !0, drop: null }
	}
	function onDocumentMouseUp(event) {
		if (destroyed || !event) return
		if (passthrough) {
			drag = null
			parts && parts.marquee && hidePart(parts.marquee)
			parts && parts.drop && hidePart(parts.drop)
			scheduleFrame()
			return
		}
		if (!(destroyed || !drag)) {
			var current = drag
			;((drag = null), parts && parts.marquee && hidePart(parts.marquee), parts && parts.drop && hidePart(parts.drop))
			if (current.structure) {
				if (!current.active) {
					scheduleFrame()
					return
				}
				try {
					event && (event.preventDefault(), event.stopPropagation())
				} catch {}
				suppressClickUntil = Date.now() + 450
				if (current.drop) structureMove(current.target, current.drop.parent, current.drop.before || null)
				updateVisuals()
				scheduleFrame()
				return
			}
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
		// Leaving the window mid-drag would otherwise leave the press state (and
		// its drop indicator) alive without a mouseup to finish it.
		if (drag) {
			drag = null
			parts && parts.marquee && hidePart(parts.marquee)
			parts && parts.drop && hidePart(parts.drop)
		}
		syncPointerCursor()
		root && updateVisuals()
		scheduleFrame()
	}
	/**
	 * Match a page hotkey against a KeyboardEvent. The physical `code` wins so
	 * the binding stays layout-independent; synthetic events without a code fall
	 * back to `key` (accepting both 'a' and 'KeyA' spellings for letters).
	 */
	function hotkeyMatches(event, hotkey) {
		if (!event || !hotkey) return !1
		var code = typeof event.code == 'string' ? event.code : '',
			key = typeof event.key == 'string' ? event.key : ''
		if (code !== '') return code === hotkey
		if (key === hotkey) return !0
		return key.length === 1 && /^[a-z]$/i.test(key) && 'Key' + key.toUpperCase() === hotkey
	}
	function onKeyDown(event) {
		if (destroyed || !event) return
		var key = event.key || '',
			code = event.code || ''
		if ((key === ' ' || code === 'Space') && !popover && !designCard && !isOverlayEvent(event) && !isEditableEvent(event)) {
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
			if (drag) {
				;((drag = null), parts && parts.marquee && hidePart(parts.marquee), parts && parts.drop && hidePart(parts.drop), scheduleFrame())
				return
			}
			// Nothing left to close: leave annotate/edit for the browse surface. Esc
			// is the only way out of a mode; the host follows through the
			// mode-change event api.setMode queues.
			if (mode !== 'browse') {
				try {
					;(event.preventDefault(), event.stopPropagation())
				} catch {}
				api.setMode('browse')
			}
			return
		}
		// Single-key mode activation on the page: A enters annotate, E enters edit
		// (or whatever the host bound through api.setHotkeys). Modifier chords,
		// key repeats, text fields and our own overlay never activate a mode.
		if (!passthrough && !drag && !popover && !designCard && !event.repeat && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !isEditableEvent(event) && !isOverlayEvent(event)) {
			if (hotkeyMatches(event, hotkeys.annotate)) {
				try {
					;(event.preventDefault(), event.stopPropagation())
				} catch {}
				mode !== 'annotate' && api.setMode('annotate')
				return
			}
			if (hotkeyMatches(event, hotkeys.edit)) {
				try {
					;(event.preventDefault(), event.stopPropagation())
				} catch {}
				mode !== 'edit' && api.setMode('edit')
				return
			}
		}
		if ((key === 'Delete' || key === 'Backspace') && mode === 'edit' && selectionEl && !popover && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditableEvent(event) && !isOverlayEvent(event)) {
			try {
				;(event.preventDefault(), event.stopPropagation())
			} catch {}
			structureRemove(selectionEl)
			return
		}
		// In annotate mode the bound previous/next keys (default ↑/↓) cycle through
		// existing annotations with wrap-around, reopening each editor without focus
		// so repeats keep cycling. This stays active while the editor is open; any
		// other target falls through so the page keeps its own scrolling/keys.
		if (mode === 'annotate' && !passthrough && !drag && !event.repeat && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !isEditableEvent(event) && !isOverlayEvent(event)) {
			var direction = hotkeyMatches(event, hotkeys.prevAnnotation) ? -1 : hotkeyMatches(event, hotkeys.nextAnnotation) ? 1 : 0
			if (direction !== 0 && focusAdjacentAnnotation(direction)) {
				try {
					;(event.preventDefault(), event.stopPropagation())
				} catch {}
				return
			}
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
		drag = null
		parts && parts.marquee && hidePart(parts.marquee)
		parts && parts.drop && hidePart(parts.drop)
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
