// @ts-nocheck
	/** Host takes the annotate bar surface; the page hides its own bar. */
	function setBarHosted(hosted) {
		if (destroyed) return !1
		barHosted = !!hosted
		updateVisuals()
		return !0
	}
	/** Small snapshot the host bar mirrors (count / marker visibility). */
	function getBarState() {
		if (destroyed) return null
		return { annotating: mode === 'annotate', count: annotations.length, markersHidden: markersHidden }
	}
	function toggleMarkers() {
		if (destroyed) return null
		markersHidden = !markersHidden
		updateVisuals()
		scheduleFrame()
		return markersHidden
	}
	function discardAnnotations() {
		if (destroyed) return !1
		annotations.slice().forEach(function (annotation) {
			removeAnnotation(annotation.id)
		})
		updateVisuals()
		scheduleFrame()
		return !0
	}
	function sendAnnotations() {
		if (destroyed || annotations.length === 0) return !1
		queueEvent('annotation-send', {})
		return !0
	}
	function exitAnnotate() {
		if (destroyed) return !1
		queueEvent('annotation-exit', {})
		api.setMode('browse')
		return !0
	}
	function locateLastAnnotation() {
		if (destroyed) return !1
		for (var index = annotations.length - 1; index >= 0; index -= 1) {
			var annotation = annotations[index]
			if (annotation && annotation.selector) {
				locate(annotation.selector)
				return !0
			}
		}
		return !1
	}

	/**
	 * Host overlay-safe area, in CSS pixels, measured from the page bottom.
	 * The floating composer dock covers that strip while it is visible; the
	 * page's own floating UI (annotation composer, style card, draft bar) is
	 * clamped above it instead of being painted under the host input box.
	 */
	function setBottomInset(value) {
		if (destroyed) return !1
		var next = Number(value == null ? 0 : value)
		if (!isFinite(next) || next < 0) next = 0
		next = Math.min(Math.round(next), Math.max(0, Math.round(viewportHeight() * 0.6)))
		if (next === safeBottom) return !0
		// Keep the draggable bar visually attached to its previous spot while the
		// reserved strip appears/disappears.
		barOffsetY += next - safeBottom
		safeBottom = next
		applyBarPosition()
		if (popover) positionPopover()
		if (designCard) positionDesignCard()
		return !0
	}
	var api = {
		version: VERSION,
		setMode: function (nextMode) {
			if (destroyed) return !1
			var normalized = String(nextMode == null ? '' : nextMode)
			if (!MODES[normalized]) return !1
			if (mode === normalized) {
				if (normalized === 'browse') {
					;(designCard && closeDesignCard(!1), (hoverEl = null), setPassthrough(!1), removeCursorStyle(), root && updateVisuals())
				}
				return !0
			}
			;((mode = normalized), (hoverEl = null), (passthrough = !1), (suppressClickUntil = 0))
			drag && ((drag = null), parts && parts.marquee && hidePart(parts.marquee), parts && parts.drop && hidePart(parts.drop))
			popover && closePopover()
			designCard && closeDesignCard(!1)
			mode !== 'browse' && ensureOverlay()
			;(updateVisuals(), scheduleFrame())
			// The hosted tab mirrors the page mode from this event instead of
			// inferring it from a specific annotation action.
			queueEvent('mode-change', { mode: mode })
			return !0
		},
		setSelection,
		clearSelection,
		setSelectionByPath,
		getDescriptor,
		getAncestry,
		domChildren,
		focusDomPath,
		drainEvents,
		getState,
		applyStyle,
		applyText,
		applyAttr,
		reapply,
		locate,
		setLocale,
		setTheme,
		setBottomInset,
		setBarHosted,
		getBarState,
		toggleMarkers,
		discardAnnotations,
		sendAnnotations,
		exitAnnotate,
		locateLastAnnotation,
		openAnnotationEditor,
		updateAnnotation,
		removeAnnotation,
		reinit,
		destroy
	}
	win.__DSH_NUDGE__ = api
	try {
		boot()
	} catch {}
