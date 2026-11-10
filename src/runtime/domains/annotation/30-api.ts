// @ts-nocheck
	function normalizeRegion(region) {
		if (!region) return null
		var x = Number(region.x) || 0,
			y = Number(region.y) || 0,
			width = Math.max(0, Number(region.width) || 0),
			height = Math.max(0, Number(region.height) || 0)
		return { x: round2(x), y: round2(y), width: round2(width), height: round2(height) }
	}
	function openAnnotationEditor(annotationId, options) {
		if (destroyed) return { ok: !1, reason: 'destroyed' }
		var annotation = findAnnotation(annotationId)
		if (!annotation) return { ok: !1, reason: 'not-found' }
		var element = annotationElement(annotation)
		return (element && selectElement(element, !1), popover && closePopover(), openPopover({ mode: 'edit', annotationId: annotation.id, note: annotation.note, element: element || null, region: annotation.region || null, textSelection: annotation.textSelection || null, focusTextarea: !(options && options.focusTextarea === !1) }), { ok: !0, annotation: cloneAnnotation(annotation) })
	}
	/**
	 * Cycle annotate-mode focus to the previous (-1) or next (+1) annotation,
	 * wrapping around. The target is located (scroll + flash + select) and its
	 * editor reopened without stealing focus, so repeated presses keep cycling.
	 * Returns false when nothing can be shown so the page key falls through.
	 */
	function focusAdjacentAnnotation(direction) {
		if (destroyed || mode !== 'annotate' || annotations.length === 0) return !1
		var total = annotations.length,
			step = direction > 0 ? 1 : -1,
			current = -1,
			index = 0
		if (popover && popover.draft && popover.draft.annotationId)
			for (index = 0; index < total; index += 1)
				if (annotations[index].id === popover.draft.annotationId) {
					current = index
					break
				}
		// No editor open: fall back to the selected element (last match wins for
		// duplicate annotations on one element), then to the selection selector.
		if (current < 0 && selectionEl)
			for (index = total - 1; index >= 0; index -= 1)
				if (annotationElement(annotations[index]) === selectionEl) {
					current = index
					break
				}
		if (current < 0 && selectionSelector)
			for (index = total - 1; index >= 0; index -= 1)
				if (annotations[index].selector === selectionSelector) {
					current = index
					break
				}
		var annotation = annotations[current < 0 ? (direction > 0 ? 0 : total - 1) : (current + step + total) % total]
		if (!annotation) return !1
		var selector = annotation.selector || (annotation.textSelection && annotation.textSelection.selector),
			found = selector ? locate(selector) : null
		if (!found || !found.ok) {
			var element = annotationElement(annotation)
			element && locate(cssPath(element))
		}
		var editor = openAnnotationEditor(annotation.id, { focusTextarea: !1 })
		;(updateVisuals(), scheduleFrame())
		return !!(editor && editor.ok === !0)
	}
	function updateAnnotation(annotationId, note) {
		if (destroyed) return { ok: !1, annotation: null }
		var annotation = findAnnotation(annotationId)
		if (!annotation) return { ok: !1, annotation: null }
		if (((annotation.note = note == null ? '' : String(note)), (annotation.updatedAt = Date.now()), popover && popover.draft && popover.draft.annotationId === annotation.id))
			try {
				popover.textarea.value = annotation.note
			} catch {}
		return (updateVisuals(), { ok: !0, annotation: cloneAnnotation(annotation) })
	}
	function removeAnnotation(annotationId) {
		if (destroyed) return !1
		for (var index = -1, cursor = 0; cursor < annotations.length; cursor += 1)
			if (annotations[cursor].id === annotationId) {
				index = cursor
				break
			}
		return index < 0
			? !1
			: (annotations.splice(index, 1),
				delete annotationEls[annotationId],
				parts && (parts.badges[annotationId] && (removeNode(parts.badges[annotationId]), delete parts.badges[annotationId]), parts.regions[annotationId] && (removeNode(parts.regions[annotationId]), delete parts.regions[annotationId])),
				popover && popover.draft && popover.draft.annotationId === annotationId && closePopover(),
				queueEvent('annotate-remove', { id: annotationId }),
				updateVisuals(),
				scheduleFrame(),
				!0)
	}
