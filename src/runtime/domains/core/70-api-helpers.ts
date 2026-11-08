// @ts-nocheck
	function getState() {
		return (destroyed || updateVisuals(), { mode, selection: selectionEl && isConnected(selectionEl) ? descriptorOf(selectionEl) : null, annotations: annotations.map(cloneAnnotation).filter(Boolean), page: { url: locationHref(), title: pageTitle() }, version: VERSION })
	}
	function getDescriptor(selector) {
		var element = selector == null || selector === '' ? selectionEl : resolveSelector(selector)
		return element ? descriptorOf(element) : null
	}
	function getAncestry(selector, up, down) {
		var element = resolveSelector(selector)
		if (!element) return null
		for (var upCount = Math.max(0, Math.min(12, up === void 0 || up === null ? 3 : Math.floor(Number(up) || 0))), downCount = Math.max(0, Math.min(6, down === void 0 || down === null ? 2 : Math.floor(Number(down) || 0))), chain = [], node = element, guard = 0; node && guard <= upCount; )
			(chain.unshift(node), chain.length > upCount + 1 && chain.shift(), (node = node.parentElement), (guard += 1))
		var budget = { remaining: 160 }
		function nodeInfo(target, depth) {
			var info = { path: pathOf(target), selector: cssPath(target), tag: localName(target), id: '', classes: classesOf(target), children: [] }
			try {
				info.id = target.id || ''
			} catch {
				info.id = ''
			}
			if (depth > 0 && budget.remaining > 0) for (var kids = elementChildrenOf(target), index2 = 0; index2 < kids.length && index2 < 14 && budget.remaining > 0; index2 += 1) ((budget.remaining -= 1), info.children.push(nodeInfo(kids[index2], depth - 1)))
			return info
		}
		for (var tree = nodeInfo(element, downCount), index = chain.length - 2; index >= 0; index -= 1) {
			var parentInfo = nodeInfo(chain[index], 0)
			;((parentInfo.children = [tree]), (tree = parentInfo))
		}
		return tree
	}
	function domNodeInfo(element) {
		var info = { path: pathOf(element), tag: localName(element), id: '', classes: [], childCount: 0 }
		try {
			info.id = element.id || ''
		} catch {}
		try {
			var classes = classesOf(element)
			info.classes = classes ? classes.slice(0, 3) : []
		} catch {}
		try {
			info.childCount = elementChildrenOf(element).length
		} catch {
			info.childCount = 0
		}
		return info
	}
	/** Immediate element children of the node at `path` (the page tree is loaded lazily). */
	function domChildren(path) {
		if (destroyed) return []
		var element = resolvePath(Array.isArray(path) ? path : [])
		if (!element || !isConnected(element)) return []
		return elementChildrenOf(element)
			.slice(0, 300)
			.map(domNodeInfo)
	}
	/** Select, scroll to and flash the node at `path`; opens the style card in edit mode. */
	function focusDomPath(path) {
		if (destroyed) return { ok: !1, reason: 'destroyed' }
		var element = resolvePath(Array.isArray(path) ? path : [])
		if (!element || !isConnected(element)) return { ok: !1, reason: 'not-found' }
		var selector = cssPath(element)
		var located = locate(selector)
		if (mode === 'edit') openDesignCard(element)
		return { ok: !!(located && located.ok), selector: selector, descriptor: descriptorOf(element) }
	}
	function drainEvents() {
		destroyed || updateVisuals()
		var drained = events
		return ((events = []), drained)
	}
	function setLocale(strings) {
		if (!strings || typeof strings != 'object') return !1
		var source = strings.annotation && typeof strings.annotation == 'object' ? strings.annotation : strings,
			next = copyLocale(locale),
			parsed = {},
			aliases = { title: ['title', 'popoverTitle', 'addTitle'], subtitle: ['subtitle', 'popoverSubtitle'], placeholder: ['placeholder', 'popoverPlaceholder'], cancel: ['cancel', 'popoverCancel'], add: ['add', 'popoverAdd'], save: ['save', 'popoverSave'], editTitle: ['editTitle', 'edit'], region: ['region'], designTitle: ['designTitle'], designColor: ['designColor'], designBackground: ['designBackground'], designOpacity: ['designOpacity'], designFont: ['designFont'], designFontSize: ['designFontSize'], designFontWeight: ['designFontWeight'], designCancel: ['designCancel'], designApply: ['designApply'], designClose: ['designClose'], designPreview: ['designPreview'], statusAnnotating: ['statusAnnotating'], statusSend: ['statusSend'], statusExit: ['statusExit'], statusRemove: ['statusRemove'], statusLocate: ['statusLocate'], statusHideMarkers: ['statusHideMarkers'], statusShowMarkers: ['statusShowMarkers'], statusDiscard: ['statusDiscard'], statusDiscardArmed: ['statusDiscardArmed'], statusMoveToolbar: ['statusMoveToolbar'], designLayout: ['designLayout'], designSpacing: ['designSpacing'], designTypography: ['designTypography'], designAppearance: ['designAppearance'], designAdvanced: ['designAdvanced'], designWidth: ['designWidth'], designHeight: ['designHeight'], designDisplay: ['designDisplay'], designPosition: ['designPosition'], designOverflow: ['designOverflow'], designMargin: ['designMargin'], designPadding: ['designPadding'], designGap: ['designGap'], designLineHeight: ['designLineHeight'], designLetterSpacing: ['designLetterSpacing'], designTextAlign: ['designTextAlign'], designBorder: ['designBorder'], designBorderRadius: ['designBorderRadius'], designShadow: ['designShadow'], designTransform: ['designTransform'], designZIndex: ['designZIndex'], designVisibility: ['designVisibility'], designContent: ['designContent'], designDom: ['designDom'], designTextContent: ['designTextContent'], designNoDirectText: ['designNoDirectText'], designAncestors: ['designAncestors'], designDescendants: ['designDescendants'], designNoDescendants: ['designNoDescendants'] }
		for (var key in aliases)
			if (hasOwn(aliases, key))
				for (var names = aliases[key], index = 0; index < names.length; index += 1) {
					var value = source[names[index]]
					if (typeof value == 'string' && value !== '') {
						;(next[key] = value), (parsed[key] = !0)
						break
					}
				}
		return (!parsed.save && next.add && (next.save = next.add), !parsed.editTitle && next.title && (next.editTitle = next.title), (locale = next), popover && applyPopoverLocale(), updateVisuals(), !0)
	}
	function setTheme(nextTheme) {
		if (!nextTheme || typeof nextTheme != 'object') return !1
		for (var next = copyTheme(theme), fields = ['accent', 'annotationAccent', 'annotationMarker', 'panelBg', 'text', 'border', 'muted', 'danger'], index = 0; index < fields.length; index += 1) {
			var value = nextTheme[fields[index]]
			typeof value == 'string' && value !== '' && (next[fields[index]] = value)
		}
		// The style card carries fully inlined control styles and is rebuilt on every
		// open, so a theme flip closes it instead of patching each control in place.
		;(typeof nextTheme.isDark == 'boolean' && (next.isDark = nextTheme.isDark), (theme = next), designCard && closeDesignCard(!1), restyleOverlay(), popover && (applyPopoverTheme(), applyPopoverLocale(), positionPopover()), updateVisuals(), scheduleFrame())
		return !0
	}
	function restyleOverlay() {
		if (parts) {
			;(parts.selection && (parts.selection.style.setProperty('border-color', annotationAccentColor()), parts.selection.style.setProperty('border-width', '2px'), parts.selection.style.setProperty('background', alphaColor(annotationAccentColor(), 0.035))),
				parts.hover && (parts.hover.style.setProperty('border-color', annotationAccentColor()), parts.hover.style.setProperty('border-width', '2px'), parts.hover.style.setProperty('background', alphaColor(annotationAccentColor(), 0.03))),
				parts.flash && (parts.flash.style.setProperty('border-color', annotationAccentColor()), parts.flash.style.setProperty('background', alphaColor(annotationAccentColor(), 0.18))),
				parts.marquee && (parts.marquee.style.setProperty('border-color', annotationAccentColor()), parts.marquee.style.setProperty('background', alphaColor(annotationAccentColor(), 0.1))))
			for (var badgeId in parts.badges)
				if (hasOwn(parts.badges, badgeId)) {
					var badge = parts.badges[badgeId]
					;(badge.style.setProperty('background', annotationMarkerColor()), badge.style.setProperty('border-color', 'rgba(255,255,255,0.94)'))
				}
			for (var regionId in parts.regions)
				if (hasOwn(parts.regions, regionId)) {
					var regionNode = parts.regions[regionId]
					;(regionNode.style.setProperty('border-color', annotationAccentColor()), regionNode.style.setProperty('background', alphaColor(annotationAccentColor(), 0.08)))
				}
			if (parts.cursor) {
				try {
					var cursorPath = parts.cursor.querySelector('path')
					cursorPath && cursorPath.setAttribute('fill', annotationMarkerColor())
				} catch {}
			}
			if (parts.draft) parts.draft.style.setProperty('background', annotationMarkerColor())
			applyBarTheme()
			ensureShadowStyle()
			if (parts.meta) {
				;(parts.meta.style.setProperty('border-color', theme.border), parts.meta.style.setProperty('background', theme.panelBg), parts.meta.style.setProperty('color', theme.text))
				parts.metaTag && parts.metaTag.style.setProperty('color', theme.text)
				parts.metaDetail && parts.metaDetail.style.setProperty('color', theme.muted)
			}
		}
	}
