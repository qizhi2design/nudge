// @ts-nocheck
	function normalizeRegion(region) {
		if (!region) return null
		var x = Number(region.x) || 0,
			y = Number(region.y) || 0,
			width = Math.max(0, Number(region.width) || 0),
			height = Math.max(0, Number(region.height) || 0)
		return { x: round2(x), y: round2(y), width: round2(width), height: round2(height) }
	}
	function openAnnotationEditor(annotationId) {
		if (destroyed) return { ok: !1, reason: 'destroyed' }
		var annotation = findAnnotation(annotationId)
		if (!annotation) return { ok: !1, reason: 'not-found' }
		var element = annotationElement(annotation)
		return (element && selectElement(element, !1), popover && closePopover(), openPopover({ mode: 'edit', annotationId: annotation.id, note: annotation.note, element: element || null, region: annotation.region || null, textSelection: annotation.textSelection || null }), { ok: !0, annotation: cloneAnnotation(annotation) })
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
