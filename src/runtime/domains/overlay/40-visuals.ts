// @ts-nocheck
	function badgeFor(annotationId) {
		if (!parts) return null
		if (parts.badges[annotationId]) return parts.badges[annotationId]
		var badge = doc.createElement('div')
		try {
			;(badge.setAttribute(PART_ATTR, 'badge'), badge.setAttribute('aria-hidden', 'true'))
		} catch {}
		function badgeScale() {
			return popover && popover.draft && popover.draft.annotationId === annotationId ? 'scale(1.08)' : 'scale(1)'
		}
		try {
			;(badge.setAttribute('role', 'button'),
				badge.setAttribute('title', locale.editTitle),
				badge.addEventListener('mouseenter', function () {
					badge.style.setProperty('transform', 'scale(1.08)')
				}),
				badge.addEventListener('mouseleave', function () {
					badge.style.setProperty('transform', badgeScale())
				}),
				badge.addEventListener('click', function (event) {
					;(event && (event.preventDefault(), event.stopPropagation()), openAnnotationEditor(annotationId))
				}))
		} catch {}
		return (
			setStyleMap(badge, {
				position: 'fixed',
				left: '0px',
				top: '0px',
				width: '26px',
				height: '26px',
				minWidth: '26px',
				padding: '0px',
				boxSizing: 'border-box',
				borderRadius: '50% 50% 50% 3px',
				border: '1.65px solid rgba(255,255,255,0.94)',
				background: annotationMarkerColor(),
				color: overlayPalette().onAccent,
				font: '700 11px/23px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
				textAlign: 'center',
				whiteSpace: 'nowrap',
				pointerEvents: 'auto',
				cursor: 'pointer',
				display: 'none',
				zIndex: '4',
				boxShadow: '0 4px 10px rgba(0,0,0,0.28)',
				transformOrigin: 'bottom left',
				transition: 'transform ' + MOTION,
				margin: '0px'
			}),
			layer.appendChild(badge),
			(parts.badges[annotationId] = badge),
			badge
		)
	}
	function regionNodeFor(annotationId) {
		if (!parts) return null
		if (parts.regions[annotationId]) return parts.regions[annotationId]
		var node = doc.createElement('div')
		try {
			;(node.setAttribute(PART_ATTR, 'region'), node.setAttribute('aria-hidden', 'true'))
		} catch {}
		return (
			setStyleMap(node, {
				position: 'fixed',
				left: '0px',
				top: '0px',
				width: '0px',
				height: '0px',
				borderStyle: 'dashed',
				borderWidth: '2px',
				borderColor: annotationAccentColor(),
				background: alphaColor(annotationAccentColor(), 0.08),
				borderRadius: '3px',
				boxSizing: 'border-box',
				pointerEvents: 'none',
				display: 'none',
				zIndex: '1',
				margin: '0px',
				padding: '0px'
			}),
			layer.appendChild(node),
			(parts.regions[annotationId] = node),
			node
		)
	}
	/** The annotation already attached to this exact element, if any. */
	function annotationForElement(element) {
		if (!element) return null
		for (var index = annotations.length - 1; index >= 0; index -= 1) {
			var annotation = annotations[index]
			if (!annotation || annotation.region || annotation.textSelection || !annotation.element) continue
			if (annotationElement(annotation) === element) return annotation
		}
		return null
	}
	function annotationElement(annotation) {
		if (!annotation) return null
		var known = annotationEls[annotation.id]
		if (known && isConnected(known)) return known
		var element = resolveSelector(annotation.selector)
		return (!element && annotation.element && annotation.element.path && (element = resolvePath(annotation.element.path)), element && isConnected(element) ? ((annotationEls[annotation.id] = element), element) : null)
	}
	function updateBadges() {
		if (markersHidden) {
			if (parts) {
				for (var hiddenBadgeId in parts.badges) hasOwn(parts.badges, hiddenBadgeId) && (removeNode(parts.badges[hiddenBadgeId]), delete parts.badges[hiddenBadgeId])
				for (var hiddenRegionId in parts.regions) hasOwn(parts.regions, hiddenRegionId) && (removeNode(parts.regions[hiddenRegionId]), delete parts.regions[hiddenRegionId])
			}
			return
		}
		if (parts) {
			for (var seen = {}, index = 0; index < annotations.length; index += 1) {
				var annotation = annotations[index],
					badge = badgeFor(annotation.id)
				seen[annotation.id] = !0
				var box = null
				if (annotation.textSelection && annotation.textSelection.rect) {
					box = regionBox(annotation.textSelection.rect)
				} else if (annotation.region) {
					box = regionBox(annotation.region)
					var regionNode = regionNodeFor(annotation.id)
					;(positionPart(regionNode, box, annotationAccentColor(), 2), regionNode && regionNode.style.setProperty('background', alphaColor(annotationAccentColor(), 0.08)))
				} else {
					var element = annotationElement(annotation)
					box = element ? rectOf(element) : null
				}
				box && badge
					? ((badge.textContent = String(index + 1)),
						badge.style.setProperty('display', 'block'),
						badge.style.setProperty('left', box.left - 13 + 'px'),
						badge.style.setProperty('top', box.top - 13 + 'px'),
						badge.style.setProperty('background', annotationMarkerColor()),
						badge.style.setProperty('transform', popover && popover.draft && popover.draft.annotationId === annotation.id ? 'scale(1.08)' : 'scale(1)'))
					: badge && badge.style.setProperty('display', 'none')
			}
			for (var badgeId in parts.badges) hasOwn(parts.badges, badgeId) && (seen[badgeId] || (removeNode(parts.badges[badgeId]), delete parts.badges[badgeId]))
			for (var regionId in parts.regions) hasOwn(parts.regions, regionId) && (seen[regionId] || (removeNode(parts.regions[regionId]), delete parts.regions[regionId]))
		}
	}
	function updateMarquee() {
		if (parts) {
			if (!drag || !drag.active) {
				hidePart(parts.marquee)
				return
			}
			var box = { left: Math.min(drag.startX, drag.x), top: Math.min(drag.startY, drag.y), width: Math.abs(drag.x - drag.startX), height: Math.abs(drag.y - drag.startY) }
			positionPart(parts.marquee, box, annotationAccentColor(), 2)
		}
	}
	function updateMeta() {
		if (!parts || !parts.meta) return
		var visible = hoverEl && mode !== 'browse' && !passthrough && !popover && !(drag && drag.active) && isConnected(hoverEl)
		if (!visible) {
			hidePart(parts.meta)
			return
		}
		var box = rectOf(hoverEl),
			computed = null
		try {
			computed = win.getComputedStyle(hoverEl)
		} catch {
			computed = null
		}
		var color = computed ? String(computed.color || '') : '',
			fontFamily = computed ? String(computed.fontFamily || '').split(',')[0].replace(/["']/g, '').trim() : '',
			fontSize = computed ? String(computed.fontSize || '') : ''
		;(parts.metaTag.textContent = tagLower(hoverEl) || 'element')
		parts.metaSize.textContent = Math.round(box.width) + ' \u00d7 ' + Math.round(box.height)
		parts.metaDetail.textContent = [color, fontFamily && fontSize ? fontFamily + ' ' + fontSize : ''].filter(Boolean).join('  \u00b7  ')
		parts.meta.style.setProperty('display', 'block')
		var metaWidth = 160,
			metaHeight = 52
		try {
			metaWidth = parts.meta.offsetWidth || metaWidth
			metaHeight = parts.meta.offsetHeight || metaHeight
		} catch {}
		var margin = 8,
			gap = 8,
			left = clamp(box.left, margin, Math.max(margin, viewportWidth() - metaWidth - margin)),
			top = box.top - metaHeight - gap
		if (top < margin) top = box.bottom + gap
		if (top + metaHeight > viewportHeight() - margin) top = Math.max(margin, box.top - metaHeight - gap)
		;(setStyle(parts.meta, 'left', left + 'px'), setStyle(parts.meta, 'top', Math.max(margin, Math.min(top, viewportHeight() - metaHeight - margin)) + 'px'))
	}
	function updateDraftMarker() {
		if (!parts || !parts.draft) return
		var box = popover ? popoverAnchorRect() : null
		if (!box || passthrough) {
			hidePart(parts.draft)
			return
		}
		setStyleMap(parts.draft, {
			display: 'block',
			left: Math.max(2, box.left - 13) + 'px',
			top: Math.max(2, box.top - 13) + 'px',
			background: annotationMarkerColor()
		})
	}
	function annotationLabel(annotation) {
		var text = annotation && annotation.textSelection && annotation.textSelection.text ? String(annotation.textSelection.text) : ''
		if (text) return '\u201c' + (text.length > 42 ? text.slice(0, 42) + '\u2026' : text) + '\u201d'
		var element = annotation && annotation.element ? annotation.element : {}
		var label = tagLower({ localName: element.tag || 'element' }) || 'element'
		if (element.text) {
			var content = String(element.text).replace(/\s+/g, ' ').trim()
			if (content) label += ' \xB7 ' + (content.length > 32 ? content.slice(0, 32) + '\u2026' : content)
		}
		return label
	}
	function applyBarPosition() {
		if (!parts || !parts.bar) return
		var width = 320,
			height = 48
		try {
			var rect = parts.bar.getBoundingClientRect ? parts.bar.getBoundingClientRect() : null
			rect && ((width = rect.width || width), (height = rect.height || height))
		} catch {}
		var vw = viewportWidth(),
			vh = viewportHeight(),
			half = Math.max(80, width / 2),
			minX = 8 + half - vw / 2,
			maxX = vw / 2 - 8 - half
		if (minX > maxX) (minX = 0), (maxX = 0)
		barOffsetX = Math.max(minX, Math.min(maxX, barOffsetX))
		var maxBottom = Math.max(8, vh - height - 8),
			bottom = Math.max(8, Math.min(maxBottom, 14 + barOffsetY))
		barOffsetY = bottom - 14
		try {
			;(parts.bar.style.setProperty('left', 'calc(50% + ' + Math.round(barOffsetX) + 'px)'), parts.bar.style.setProperty('bottom', Math.round(bottom) + 'px'))
		} catch {}
	}
	function setBarIcon(button, name) {
		if (!button) return
		try {
			while (button.firstChild) button.removeChild(button.firstChild)
			button.appendChild(overlayIcon(name, 15))
		} catch {}
	}
	function refreshBarIcons() {
		if (!parts || !parts.bar) return
		setBarIcon(parts.barMarkers, markersHidden ? 'eye' : 'eyeOff')
		setBarIcon(parts.barDiscard, 'trash')
		var markersLabel = markersHidden ? locale.statusShowMarkers : locale.statusHideMarkers,
			discardLabel = discardArmed ? locale.statusDiscardArmed : locale.statusDiscard
		try {
			;(parts.barMarkers.setAttribute('title', markersLabel), parts.barMarkers.setAttribute('aria-label', markersLabel), parts.barDiscard.setAttribute('title', discardLabel), parts.barDiscard.setAttribute('aria-label', discardLabel), parts.barDiscard.style.setProperty('color', discardArmed ? theme.danger : overlayPalette().muted))
		} catch {}
	}
	function updateBar() {
		if (!parts || !parts.bar) return
		var visible = mode === 'annotate' && !passthrough
		if (!visible) {
			hidePart(parts.bar)
			return
		}
		var wasVisible = !1
		try {
			wasVisible = parts.bar.style.getPropertyValue('display') === 'flex'
		} catch {}
		;(parts.bar.style.setProperty('display', 'flex'), (parts.barCount.textContent = locale.statusAnnotating + (annotations.length > 0 ? ' \xB7 ' + annotations.length : '')), parts.barSend.textContent = locale.statusSend)
		var disabled = annotations.length === 0
		try {
			;(parts.barSend.setAttribute('aria-disabled', disabled ? 'true' : 'false'), parts.barSend.style.setProperty('opacity', disabled ? '0.45' : '1'), parts.barSend.style.setProperty('cursor', disabled ? 'default' : 'pointer'))
		} catch {}
		var nextIconState = (markersHidden ? 'm' : '') + (discardArmed ? 'd' : '')
		if (nextIconState !== barIconState) {
			barIconState = nextIconState
			refreshBarIcons()
		}
		if (!wasVisible) applyBarPosition()
	}
	function updateVisuals() {
		if (!destroyed && !(!visualNeeded() && !root) && (ensureOverlay(), !!parts)) {
			if (selectionEl && !isConnected(selectionEl)) {
				var lostSelector = selectionSelector
				;((selectionEl = null), (selectionSelector = ''), queueEvent('selection-lost', { selector: lostSelector }))
			}
			if (selectionEl && !(popover && popover.draft && popover.draft.textSelection)) {
				positionPart(parts.selection, rectOf(selectionEl), annotationAccentColor(), 2)
				setStyle(parts.selection, 'border-radius', radiusOf(selectionEl))
			} else hidePart(parts.selection)
			if (hoverEl && mode !== 'browse' && !popover && !passthrough && isConnected(hoverEl)) {
				positionPart(parts.hover, rectOf(hoverEl), annotationAccentColor(), 2)
				setStyle(parts.hover, 'border-radius', radiusOf(hoverEl))
			} else hidePart(parts.hover)
			;(flashTarget && isConnected(flashTarget) ? positionPart(parts.flash, rectOf(flashTarget), annotationAccentColor(), 2) : flashTarget && ((flashTarget = null), hidePart(parts.flash)),
				updateMarquee(),
				updateBadges(),
				updateBar(),
				updateTextLayer(),
				updateMeta(),
				updateDraftMarker(),
				popover && positionPopover(),
				designCard && positionDesignCard(),
				syncPointerCursor())
		}
	}
