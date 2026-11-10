// @ts-nocheck
	function copyTheme(source) {
		return { accent: source.accent || DEFAULT_THEME.accent, annotationAccent: source.annotationAccent || DEFAULT_THEME.annotationAccent, annotationMarker: source.annotationMarker || DEFAULT_THEME.annotationMarker, panelBg: source.panelBg || DEFAULT_THEME.panelBg, text: source.text || DEFAULT_THEME.text, border: source.border || DEFAULT_THEME.border, muted: source.muted || DEFAULT_THEME.muted, danger: source.danger || DEFAULT_THEME.danger, isDark: source.isDark === !0 }
	}
	function copyLocale(source) {
		return {
			title: typeof source.title == 'string' ? source.title : DEFAULT_LOCALE.title,
			subtitle: typeof source.subtitle == 'string' ? source.subtitle : DEFAULT_LOCALE.subtitle,
			placeholder: typeof source.placeholder == 'string' ? source.placeholder : DEFAULT_LOCALE.placeholder,
			cancel: typeof source.cancel == 'string' ? source.cancel : DEFAULT_LOCALE.cancel,
			add: typeof source.add == 'string' ? source.add : DEFAULT_LOCALE.add,
			save: typeof source.save == 'string' ? source.save : DEFAULT_LOCALE.save,
			editTitle: typeof source.editTitle == 'string' ? source.editTitle : DEFAULT_LOCALE.editTitle,
			region: typeof source.region == 'string' ? source.region : DEFAULT_LOCALE.region,
			designTitle: typeof source.designTitle == 'string' ? source.designTitle : DEFAULT_LOCALE.designTitle,
			designColor: typeof source.designColor == 'string' ? source.designColor : DEFAULT_LOCALE.designColor,
			designBackground: typeof source.designBackground == 'string' ? source.designBackground : DEFAULT_LOCALE.designBackground,
			designOpacity: typeof source.designOpacity == 'string' ? source.designOpacity : DEFAULT_LOCALE.designOpacity,
			designFont: typeof source.designFont == 'string' ? source.designFont : DEFAULT_LOCALE.designFont,
			designFontSize: typeof source.designFontSize == 'string' ? source.designFontSize : DEFAULT_LOCALE.designFontSize,
			designFontWeight: typeof source.designFontWeight == 'string' ? source.designFontWeight : DEFAULT_LOCALE.designFontWeight,
			designCancel: typeof source.designCancel == 'string' ? source.designCancel : DEFAULT_LOCALE.designCancel,
			designApply: typeof source.designApply == 'string' ? source.designApply : DEFAULT_LOCALE.designApply,
			designClose: typeof source.designClose == 'string' ? source.designClose : DEFAULT_LOCALE.designClose,
			designPreview: typeof source.designPreview == 'string' ? source.designPreview : DEFAULT_LOCALE.designPreview,
			statusAnnotating: typeof source.statusAnnotating == 'string' ? source.statusAnnotating : DEFAULT_LOCALE.statusAnnotating,
			statusSend: typeof source.statusSend == 'string' ? source.statusSend : DEFAULT_LOCALE.statusSend,
			statusExit: typeof source.statusExit == 'string' ? source.statusExit : DEFAULT_LOCALE.statusExit,
			statusRemove: typeof source.statusRemove == 'string' ? source.statusRemove : DEFAULT_LOCALE.statusRemove,
			statusLocate: typeof source.statusLocate == 'string' ? source.statusLocate : DEFAULT_LOCALE.statusLocate,
			statusHideMarkers: typeof source.statusHideMarkers == 'string' ? source.statusHideMarkers : DEFAULT_LOCALE.statusHideMarkers,
			statusShowMarkers: typeof source.statusShowMarkers == 'string' ? source.statusShowMarkers : DEFAULT_LOCALE.statusShowMarkers,
			statusDiscard: typeof source.statusDiscard == 'string' ? source.statusDiscard : DEFAULT_LOCALE.statusDiscard,
			statusDiscardArmed: typeof source.statusDiscardArmed == 'string' ? source.statusDiscardArmed : DEFAULT_LOCALE.statusDiscardArmed,
			statusMoveToolbar: typeof source.statusMoveToolbar == 'string' ? source.statusMoveToolbar : DEFAULT_LOCALE.statusMoveToolbar,
			designLayout: typeof source.designLayout == 'string' ? source.designLayout : DEFAULT_LOCALE.designLayout,
			designSpacing: typeof source.designSpacing == 'string' ? source.designSpacing : DEFAULT_LOCALE.designSpacing,
			designTypography: typeof source.designTypography == 'string' ? source.designTypography : DEFAULT_LOCALE.designTypography,
			designAppearance: typeof source.designAppearance == 'string' ? source.designAppearance : DEFAULT_LOCALE.designAppearance,
			designAdvanced: typeof source.designAdvanced == 'string' ? source.designAdvanced : DEFAULT_LOCALE.designAdvanced,
			designWidth: typeof source.designWidth == 'string' ? source.designWidth : DEFAULT_LOCALE.designWidth,
			designHeight: typeof source.designHeight == 'string' ? source.designHeight : DEFAULT_LOCALE.designHeight,
			designDisplay: typeof source.designDisplay == 'string' ? source.designDisplay : DEFAULT_LOCALE.designDisplay,
			designPosition: typeof source.designPosition == 'string' ? source.designPosition : DEFAULT_LOCALE.designPosition,
			designOverflow: typeof source.designOverflow == 'string' ? source.designOverflow : DEFAULT_LOCALE.designOverflow,
			designMargin: typeof source.designMargin == 'string' ? source.designMargin : DEFAULT_LOCALE.designMargin,
			designPadding: typeof source.designPadding == 'string' ? source.designPadding : DEFAULT_LOCALE.designPadding,
			designGap: typeof source.designGap == 'string' ? source.designGap : DEFAULT_LOCALE.designGap,
			designLineHeight: typeof source.designLineHeight == 'string' ? source.designLineHeight : DEFAULT_LOCALE.designLineHeight,
			designLetterSpacing: typeof source.designLetterSpacing == 'string' ? source.designLetterSpacing : DEFAULT_LOCALE.designLetterSpacing,
			designTextAlign: typeof source.designTextAlign == 'string' ? source.designTextAlign : DEFAULT_LOCALE.designTextAlign,
			designBorder: typeof source.designBorder == 'string' ? source.designBorder : DEFAULT_LOCALE.designBorder,
			designBorderRadius: typeof source.designBorderRadius == 'string' ? source.designBorderRadius : DEFAULT_LOCALE.designBorderRadius,
			designShadow: typeof source.designShadow == 'string' ? source.designShadow : DEFAULT_LOCALE.designShadow,
			designTransform: typeof source.designTransform == 'string' ? source.designTransform : DEFAULT_LOCALE.designTransform,
			designZIndex: typeof source.designZIndex == 'string' ? source.designZIndex : DEFAULT_LOCALE.designZIndex,
			designVisibility: typeof source.designVisibility == 'string' ? source.designVisibility : DEFAULT_LOCALE.designVisibility,
			designContent: typeof source.designContent == 'string' ? source.designContent : DEFAULT_LOCALE.designContent,
			designDom: typeof source.designDom == 'string' ? source.designDom : DEFAULT_LOCALE.designDom,
			designTextContent: typeof source.designTextContent == 'string' ? source.designTextContent : DEFAULT_LOCALE.designTextContent,
			designNoDirectText: typeof source.designNoDirectText == 'string' ? source.designNoDirectText : DEFAULT_LOCALE.designNoDirectText,
			designAncestors: typeof source.designAncestors == 'string' ? source.designAncestors : DEFAULT_LOCALE.designAncestors,
			designDescendants: typeof source.designDescendants == 'string' ? source.designDescendants : DEFAULT_LOCALE.designDescendants,
			designNoDescendants: typeof source.designNoDescendants == 'string' ? source.designNoDescendants : DEFAULT_LOCALE.designNoDescendants,
			designDelete: typeof source.designDelete == 'string' ? source.designDelete : DEFAULT_LOCALE.designDelete,
			designDeleteHint: typeof source.designDeleteHint == 'string' ? source.designDeleteHint : DEFAULT_LOCALE.designDeleteHint,
			designMoveHint: typeof source.designMoveHint == 'string' ? source.designMoveHint : DEFAULT_LOCALE.designMoveHint
		}
	}
	function annotationAccentColor() {
		return theme.annotationAccent || theme.accent
	}
	function annotationMarkerColor() {
		return theme.annotationMarker || '#339cff'
	}
	/** The live prefers-color-scheme media query, when the host page exposes one. */
	function themeMediaQuery() {
		try {
			return win && typeof win.matchMedia == 'function' ? win.matchMedia('(prefers-color-scheme: dark)') : null
		} catch {
			return null
		}
	}
	/**
	 * True when the overlay should paint dark. An explicit host flag wins; until
	 * the host sends one, the OS/browser color-scheme preference is the fallback,
	 * so a dark host never starts with a white injected bar.
	 */
	function effectiveDark() {
		if (themeDarkExplicit) return theme.isDark === true
		var media = themeMediaQuery()
		if (media) return media.matches === true
		return theme.isDark === true
	}
	function onThemeMediaChange() {
		restyleOverlay()
		if (popover) {
			applyPopoverTheme()
			applyPopoverLocale()
			positionPopover()
		}
		updateVisuals()
		scheduleFrame()
	}
	/** Follow OS dark-mode changes while the host has not sent an explicit flag. */
	function watchThemeMedia() {
		unwatchThemeMedia()
		var media = themeMediaQuery()
		if (!media) return
		themeMedia = media
		themeMediaHandler = function () {
			onThemeMediaChange()
		}
		try {
			if (typeof media.addEventListener == 'function') media.addEventListener('change', themeMediaHandler)
			else if (typeof media.addListener == 'function') media.addListener(themeMediaHandler)
			else themeMediaHandler = null
		} catch {
			themeMediaHandler = null
		}
	}
	function unwatchThemeMedia() {
		if (themeMedia && themeMediaHandler)
			try {
				if (typeof themeMedia.removeEventListener == 'function') themeMedia.removeEventListener('change', themeMediaHandler)
				else if (typeof themeMedia.removeListener == 'function') themeMedia.removeListener(themeMediaHandler)
			} catch {}
		;((themeMedia = null), (themeMediaHandler = null))
	}
	/**
	 * The page overlay's own surface palette. It follows the host DSH light/dark
	 * flag (setTheme ships isDark), but keeps the Codex token set instead of the
	 * host UI tokens so the injected layer stays readable on any page. Always read
	 * this at render time; never cache it across setTheme.
	 */
	function overlayPalette() {
		return effectiveDark() ? OVERLAY_DARK : OVERLAY_LIGHT
	}
	/** Placeholder ink for the composer textarea, keyed to the overlay surface. */
	function overlayPlaceholderColor() {
		return effectiveDark() ? 'rgba(255,255,255,0.42)' : 'rgba(15,17,21,0.50)'
	}
