// @ts-nocheck
	var VERSION = 1,
		win = typeof window != 'undefined' ? window : null
	if (!win || !win.document) return 'no-window'
	var doc = win.document,
		previous = win.__DSH_NUDGE__
	if (previous && typeof previous.destroy == 'function')
		try {
			previous.destroy()
		} catch {}
	try {
		for (var strayRoots = doc.querySelectorAll('[data-dsh-nudge-root]'), strayIndex = strayRoots.length - 1; strayIndex >= 0; strayIndex -= 1) {
			var strayNode = strayRoots[strayIndex]
			strayNode && strayNode.parentNode && strayNode.parentNode.removeChild(strayNode)
		}
	} catch {}
	var MODES = { browse: 1, annotate: 1, edit: 1 },
		STRUCTURE_NO_CHILDREN = { area: !0, base: !0, br: !0, col: !0, embed: !0, hr: !0, img: !0, input: !0, link: !0, meta: !0, param: !0, source: !0, track: !0, wbr: !0, script: !0, style: !0, textarea: !0, title: !0 },
		MAX_EVENTS = 400,
		OVERLAY_Z = 2147483647,
		POPOVER_Z = 12,
		ROOT_ATTR = 'data-dsh-nudge-root',
		PART_ATTR = 'data-dsh-nudge',
		PASSTHROUGH_ATTR = 'data-dsh-nudge-passthrough',
		CURSOR_STYLE_ATTR = 'data-dsh-nudge-cursor-style',
		MOTION = '150ms cubic-bezier(0.23, 1, 0.32, 1)',
		OVERLAY_DARK = { bg: '#2f2f2f', bgStrong: '#262626', border: 'rgba(255,255,255,0.10)', text: '#f5f5f5', muted: '#a5a5a5', hover: 'rgba(255,255,255,0.08)', accent: '#0069FB', accentDisabled: '#39424f', onAccentDisabled: '#c3ccd8', marker: '#339cff', shadow: '0 16px 40px rgba(0,0,0,0.48)', field: 'rgba(255,255,255,0.065)', fieldStrong: 'rgba(255,255,255,0.16)', highlight: 'rgba(255,255,255,0.07)', sectionHover: 'rgba(255,255,255,0.05)', barShadow: '0 12px 32px rgba(0, 0, 0, 0.42)', submitFill: '#f5f5f5', submitInk: '#111111', submitFillDisabled: 'rgba(255,255,255,0.16)', submitInkDisabled: '#f5f5f5', onAccent: '#ffffff' },
		OVERLAY_LIGHT = { bg: '#ffffff', bgStrong: '#ffffff', border: 'rgba(15,17,21,0.12)', text: '#0f1115', muted: '#61666b', hover: 'rgba(15,17,21,0.06)', accent: '#0069FB', accentDisabled: '#e6ecf5', onAccentDisabled: '#4a5563', marker: '#339cff', shadow: '0 16px 40px rgba(20,30,50,0.18)', field: 'rgba(15,17,21,0.04)', fieldStrong: 'rgba(15,17,21,0.10)', highlight: 'rgba(15,17,21,0.05)', sectionHover: 'rgba(15,17,21,0.05)', barShadow: '0 12px 32px rgba(20,30,50,0.18)', submitFill: '#0069FB', submitInk: '#ffffff', submitFillDisabled: 'rgba(15,17,21,0.08)', submitInkDisabled: '#61666b', onAccent: '#ffffff' },
		CURSOR_CSS = 'html, body, body * { cursor: none !important; } html, body { scrollbar-width: auto; }',
		DEFAULT_LOCALE = { title: 'Add annotation', subtitle: 'For the selected element', placeholder: 'Describe how the agent should change this\u2026', cancel: 'Cancel', add: 'Add', save: 'Save', editTitle: 'Edit annotation', region: 'Region', designTitle: 'Adjust styles', designColor: 'Text color', designBackground: 'Background', designOpacity: 'Opacity', designFont: 'Font', designFontSize: 'Font size', designFontWeight: 'Weight', designCancel: 'Cancel', designApply: 'Done', designClose: 'Close', designPreview: 'Live preview', statusAnnotating: 'Annotating', statusSend: 'Send', statusExit: 'Exit annotate',  statusRemove: 'Remove', statusLocate: 'Locate annotation', statusHideMarkers: 'Hide markers', statusShowMarkers: 'Show markers', statusDiscard: 'Discard annotations', statusDiscardArmed: 'Click again to discard all annotations', statusMoveToolbar: 'Move toolbar', designLayout: 'Layout', designSpacing: 'Spacing', designTypography: 'Text', designAppearance: 'Appearance', designAdvanced: 'Advanced', designWidth: 'Width', designHeight: 'Height', designDisplay: 'Display', designPosition: 'Position', designOverflow: 'Overflow', designMargin: 'Margin', designPadding: 'Padding', designGap: 'Gap', designLineHeight: 'Line height', designLetterSpacing: 'Letter spacing', designTextAlign: 'Align', designBorder: 'Border', designBorderRadius: 'Radius', designShadow: 'Shadow', designTransform: 'Transform', designZIndex: 'Z-index', designVisibility: 'Visibility', designContent: 'Content', designDom: 'DOM', designTextContent: 'Text content', designNoDirectText: 'This element has no directly editable text node', designAncestors: 'Ancestors', designDescendants: 'Children', designNoDescendants: 'No child elements', designDelete: 'Delete element', designDeleteHint: 'Remove this element and its subtree', designMoveHint: 'Drag to reorder or nest' },
		DEFAULT_THEME = { accent: '#4f8cff', annotationAccent: '#0069FB', annotationMarker: '#339cff', panelBg: '#ffffff', text: '#1f2430', border: '#d9dde6', muted: '#6b7280', danger: '#ef4444', isDark: !1 },
		// Page-local activation keys are physical KeyboardEvent.code values so
		// they stay layout-independent. `hotkeys` is the mutable closure copy the
		// host overrides through api.setHotkeys().
		DEFAULT_HOTKEYS = { annotate: 'KeyA', edit: 'KeyE', prevAnnotation: 'ArrowUp', nextAnnotation: 'ArrowDown' },
		themeDarkExplicit = !1,
		themeMedia = null,
		themeMediaHandler = null,
		mode = 'browse',
		selectionEl = null,
		selectionSelector = '',
		hoverEl = null,
		annotations = [],
		annotationEls = {},
		events = [],
		popover = null,
		designCard = null,
		flashTarget = null,
		drag = null,
		suppressClickUntil = 0,
		passthrough = !1,
		pointerSeen = !1,
		pointerX = 0,
		pointerY = 0,
		markersHidden = !1,
		discardArmed = !1,
		discardTimer = null,
		barOffsetX = 0,
		barOffsetY = 0,
		barIconState = '',
		barHosted = !1,
		safeBottom = 0,
		cursorStyleEl = null,
		cursorSheet = null,
		theme = copyTheme(DEFAULT_THEME),
		locale = copyLocale(DEFAULT_LOCALE),
		hotkeys = copyHotkeys(DEFAULT_HOTKEYS),
		destroyed = !1,
		root = null,
		layer = null,
		parts = null,
		listenerOffs = [],
		observers = [],
		rafId = 0,
		rafUsesTimeout = !1,
		frameQueued = !1,
		suspended = !1,
		navTimer = null,
		flashTimer = null,
		historyPatched = !1,
		originalPushState = null,
		originalReplaceState = null,
		wrappedPushState = null,
		wrappedReplaceState = null,
		lastUrl = '',
		lastPageTitle = ''

	/**
	 * Snapshot the page hotkeys so the defaults stay immutable: every field is a
	 * physical KeyboardEvent.code string, falling back to the default when the
	 * source is missing or empty.
	 */
	function copyHotkeys(source) {
		var base = source || DEFAULT_HOTKEYS
		return {
			annotate: typeof base.annotate == 'string' && base.annotate !== '' ? base.annotate : DEFAULT_HOTKEYS.annotate,
			edit: typeof base.edit == 'string' && base.edit !== '' ? base.edit : DEFAULT_HOTKEYS.edit,
			prevAnnotation: typeof base.prevAnnotation == 'string' && base.prevAnnotation !== '' ? base.prevAnnotation : DEFAULT_HOTKEYS.prevAnnotation,
			nextAnnotation: typeof base.nextAnnotation == 'string' && base.nextAnnotation !== '' ? base.nextAnnotation : DEFAULT_HOTKEYS.nextAnnotation
		}
	}
