// @ts-nocheck
	var api = {
		version: VERSION,
		setMode: function (nextMode) {
			if (destroyed) return !1
			var normalized = String(nextMode == null ? '' : nextMode)
			return MODES[normalized]
				? mode === normalized
					? (normalized === 'browse' && (designCard && closeDesignCard(!1), (hoverEl = null), setPassthrough(!1), removeCursorStyle(), root && updateVisuals()), !0)
					: ((mode = normalized), (hoverEl = null), (passthrough = !1), drag && ((drag = null), parts && hidePart(parts.marquee)), popover && closePopover(), designCard && closeDesignCard(!1), mode !== 'browse' && ensureOverlay(), updateVisuals(), scheduleFrame(), !0)
				: !1
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
