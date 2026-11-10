// @ts-nocheck
	function popoverAnchorRect() {
		if (!popover) return null
		var draft = popover.draft
		return draft.textSelection && draft.textSelection.rect ? regionBox(draft.textSelection.rect) : draft.element && isConnected(draft.element) ? rectOf(draft.element) : draft.region ? regionBox(draft.region) : draft.element ? rectOf(draft.element) : null
	}
	function positionPopover() {
		if (!(!popover || !popover.wrap)) {
			refreshTextSelectionDraft()
			var box = popoverAnchorRect(),
				width = viewportWidth(),
				height = viewportHeight(),
				usable = Math.max(80, height - safeBottom),
				wrap = popover.wrap,
				popWidth = 300,
				popHeight = 170
			try {
				var rect = wrap.getBoundingClientRect ? wrap.getBoundingClientRect() : null
				;(rect && rect.width > 0 && (popWidth = rect.width), rect && rect.height > 0 && (popHeight = rect.height))
			} catch {}
			var margin = 10,
				gap = 10,
				left = margin,
				top = margin
			if (box) {
				left = clamp(box.left, margin, Math.max(margin, width - popWidth - margin))
				var spaceBelow = usable - box.bottom,
					spaceAbove = box.top,
					preferAbove = spaceAbove >= popHeight + gap,
					preferBelow = spaceBelow >= popHeight + gap
				if (preferAbove) top = box.top - popHeight - gap
				else if (preferBelow) top = box.bottom + gap
				else top = spaceAbove >= spaceBelow ? box.top - popHeight - gap : box.bottom + gap
				top = clamp(top, margin, Math.max(margin, usable - popHeight - margin))
			}
			;(setStyle(wrap, 'left', left + 'px'), setStyle(wrap, 'top', top + 'px'))
		}
	}
	function applyPopoverTheme() {
		if (!(!popover || !popover.wrap)) {
			var wrap = popover.wrap,
				palette = overlayPalette()
			;(setStyleMap(wrap, { background: palette.bg, color: palette.text, border: '1px solid ' + palette.border, boxShadow: palette.shadow }),
				popover.textarea && setStyleMap(popover.textarea, { background: 'transparent', color: palette.text, border: '0px', boxShadow: 'none' }),
				popover.cancel && setStyleMap(popover.cancel, { background: 'transparent', color: palette.muted, border: '0px' }),
				popover.syncAddState
					? popover.syncAddState()
					: popover.add && setStyleMap(popover.add, { background: palette.submitFillDisabled, color: palette.submitInkDisabled, border: '0px' }))
		}
	}
	function applyPopoverLocale() {
		if (popover) {
			var editing = popover.draft.mode === 'edit',
				box = popoverAnchorRect(),
				target = ''
			if ((popover.title && (popover.title.textContent = editing ? locale.editTitle : locale.title), popover.subtitle)) {
				if (popover.draft.region) {
					var region = popover.draft.region
					target = locale.region + ' \xB7 ' + Math.round(region.width) + ' \xD7 ' + Math.round(region.height)
				} else if (popover.draft.element) {
					target = tagLower(popover.draft.element)
					box && (target += ' \xB7 ' + Math.round(box.width) + ' \xD7 ' + Math.round(box.height))
				}
				popover.subtitle.textContent = target || locale.subtitle
			}
			if (popover.textarea)
				try {
					popover.textarea.setAttribute('placeholder', locale.placeholder)
				} catch {}
			;(popover.cancelLabel && (popover.cancelLabel.textContent = locale.cancel), popover.cancel && (popover.cancel.setAttribute('aria-label', locale.cancel), popover.cancel.setAttribute('title', locale.cancel)), popover.addLabel && (popover.addLabel.textContent = editing ? locale.save : locale.add), popover.add && (popover.add.setAttribute('aria-label', editing ? locale.save : locale.add), popover.add.setAttribute('title', editing ? locale.save : locale.add)))
		}
	}
	function buildPopover(draft) {
		var wrap = doc.createElement('div')
		;(wrap.setAttribute(PART_ATTR, 'popover'),
			wrap.setAttribute('role', 'dialog'),
			wrap.setAttribute('aria-label', locale.title),
			wrap.setAttribute('aria-modal', 'false'),
			setStyleMap(wrap, {
				position: 'fixed',
				left: '8px',
				top: '8px',
				width: '360px',
				maxWidth: 'calc(100vw - 20px)',
				zIndex: String(POPOVER_Z),
				pointerEvents: 'auto',
				boxSizing: 'border-box',
				padding: '0px',
				borderRadius: '24px',
				border: '1px solid ' + overlayPalette().border,
				background: overlayPalette().bg,
				color: overlayPalette().text,
				boxShadow: overlayPalette().shadow,
				font: '13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
				textAlign: 'left',
				direction: 'ltr',
				overflow: 'hidden',
				margin: '0px'
			}),
			setStyle(wrap, 'pointer-events', 'auto', true))
		// Keep localized title/subtitle nodes for compatibility and assistive text; the Codex pill is input-first.
		var hiddenMeta = doc.createElement('div')
		setStyleMap(hiddenMeta, { display: 'none' })
		var title = doc.createElement('div')
		;(title.setAttribute(PART_ATTR, 'popover-title'), (title.textContent = draft.mode === 'edit' ? locale.editTitle : locale.title))
		var subtitle = doc.createElement('div')
		;(subtitle.setAttribute(PART_ATTR, 'popover-subtitle'), (subtitle.textContent = locale.subtitle))
		;(hiddenMeta.appendChild(title), hiddenMeta.appendChild(subtitle))
		var row = doc.createElement('div')
		setStyleMap(row, { display: 'flex', alignItems: 'flex-end', gap: '6px', padding: '7px 7px 7px 12px' })
		var textarea = doc.createElement('textarea')
		textarea.setAttribute(PART_ATTR, 'popover-textarea')
		try { textarea.setAttribute('rows', '1') } catch {}
		;(setStyleMap(textarea, {
			display: 'block',
			flex: '1 1 auto',
			minWidth: '0px',
			minHeight: '24px',
			maxHeight: '120px',
			boxSizing: 'border-box',
			margin: '0px',
			padding: '5px 2px',
			border: '0px',
			background: 'transparent',
			color: overlayPalette().text,
			font: '13px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
			resize: 'none',
			outline: 'none',
			boxShadow: 'none',
			overflow: 'hidden'
		}),
			textarea.style && textarea.style.setProperty && textarea.style.setProperty('outline', 'none'))
		try { textarea.setAttribute('placeholder', locale.placeholder) } catch {}
		textarea.value = draft.note || ''
		var cancel = doc.createElement('button')
		;(cancel.setAttribute('type', 'button'), cancel.setAttribute(PART_ATTR, 'popover-cancel'), cancel.setAttribute('aria-label', locale.cancel), cancel.setAttribute('title', locale.cancel))
		setStyleMap(cancel, { width: '30px', height: '30px', flex: 'none', padding: '0px', border: '0px', borderRadius: '999px', background: 'transparent', color: overlayPalette().muted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0px' })
		cancel.appendChild(overlayIcon('close', 15))
		var cancelLabel = doc.createElement('span')
		;(cancelLabel.textContent = locale.cancel, setStyleMap(cancelLabel, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }), cancel.appendChild(cancelLabel))
		var add = doc.createElement('button')
		;(add.setAttribute('type', 'button'), add.setAttribute(PART_ATTR, 'popover-add'), add.setAttribute('aria-label', draft.mode === 'edit' ? locale.save : locale.add), add.setAttribute('title', draft.mode === 'edit' ? locale.save : locale.add))
		setStyleMap(add, { width: '32px', height: '32px', flex: 'none', padding: '0px', border: '0px', borderRadius: '999px', background: overlayPalette().submitFillDisabled, color: overlayPalette().submitInkDisabled, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0px', transition: 'background ' + MOTION + ', color ' + MOTION })
		add.appendChild(overlayIcon('check', 16))
		var addLabel = doc.createElement('span')
		;(addLabel.textContent = draft.mode === 'edit' ? locale.save : locale.add, setStyleMap(addLabel, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }), add.appendChild(addLabel))
		;(row.appendChild(textarea), row.appendChild(cancel), row.appendChild(add), wrap.appendChild(hiddenMeta), wrap.appendChild(row), layerAppend(wrap))
		function syncAddState() {
			var value = ''
			try { value = String(textarea.value || '').trim() } catch { value = '' }
			var disabled = draft.mode !== 'edit' && value.length === 0
			try {
				var palette = overlayPalette()
				;(add.setAttribute('aria-disabled', disabled ? 'true' : 'false'), add.removeAttribute('disabled'), add.style.setProperty('background', disabled ? palette.submitFillDisabled : palette.submitFill), add.style.setProperty('color', disabled ? palette.submitInkDisabled : palette.submitInk), add.style.setProperty('cursor', disabled ? 'default' : 'pointer'))
			} catch {}
		}
		function resizeTextarea() {
			try {
				;(textarea.style.setProperty('height', 'auto'), textarea.style.setProperty('height', Math.min(120, Math.max(24, textarea.scrollHeight)) + 'px'), textarea.style.setProperty('overflow', textarea.scrollHeight > 120 ? 'auto' : 'hidden'))
			} catch {}
		}
		function stopBubble(event) { event && typeof event.stopPropagation == 'function' && event.stopPropagation() }
		try {
			;(wrap.addEventListener('click', stopBubble, !1), wrap.addEventListener('mousedown', stopBubble, !1), wrap.addEventListener('mouseup', stopBubble, !1), wrap.addEventListener('pointerdown', stopBubble, !1), wrap.addEventListener('input', stopBubble, !1), wrap.addEventListener('change', stopBubble, !1), wrap.addEventListener('keydown', stopBubble, !1),
				textarea.addEventListener('input', function () { ;(syncAddState(), resizeTextarea()) }))
		} catch {}
		try {
			;(cancel.addEventListener('click', function (event) { ;(event && (event.preventDefault(), event.stopPropagation()), closePopover()) }),
				add.addEventListener('click', function (event) { ;(event && (event.preventDefault(), event.stopPropagation()), submitPopover()) }),
				wrap.addEventListener('keydown', function (event) {
					if (!event) return
					var key = event.key || ''
					if (key === 'Escape') { ;(event.preventDefault(), event.stopPropagation(), closePopover()); return }
					if (key === 'Enter' && !event.isComposing) {
						if (event.shiftKey) return
						;(event.preventDefault(), event.stopPropagation(), submitPopover())
					}
				}))
		} catch {}
		;(syncAddState(), resizeTextarea())
		return { wrap, title, subtitle, textarea, cancel, add, cancelLabel, addLabel, syncAddState }
	}
	function openPopover(options) {
		try {
			;(closePopover(), designCard && closeDesignCard(!1), ensureOverlay())
			var settings = options || {},
				draft = { mode: settings.mode === 'edit' ? 'edit' : 'add', element: settings.element || null, region: settings.region ? normalizeRegion(settings.region) : null, textSelection: settings.textSelection || null, annotationId: settings.annotationId || null, note: settings.note == null ? '' : String(settings.note) },
				built = buildPopover(draft)
			;((popover = { wrap: built.wrap, title: built.title, subtitle: built.subtitle, textarea: built.textarea, cancel: built.cancel, add: built.add, hint: built.hint, cancelLabel: built.cancelLabel, addLabel: built.addLabel, syncAddState: built.syncAddState, draft }), applyPopoverTheme(), applyPopoverLocale())
			try {
				built.textarea.value = draft.note
			} catch {}
			positionPopover()
			try {
				;(typeof built.textarea.focus == 'function' && built.textarea.focus(), typeof built.textarea.setSelectionRange == 'function' && built.textarea.setSelectionRange(draft.note.length, draft.note.length))
			} catch {}
			return (scheduleFrame(), !0)
		} catch {
			return ((popover = null), !1)
		}
	}
	function closePopover() {
		popover && (removeNode(popover.wrap), (popover = null), scheduleFrame())
	}
	function submitPopover() {
		if (popover) {
			var note = ''
			try {
				note = String(popover.textarea.value || '').trim()
			} catch {
				note = ''
			}
			var draft = popover.draft
			if (draft.mode !== 'edit' && note === '') {
				try {
					popover.textarea.focus()
				} catch {}
				return
			}
			if (draft.mode === 'edit' && draft.annotationId) {
				var existing = findAnnotation(draft.annotationId)
				if (existing) {
					;((existing.note = note), (existing.updatedAt = Date.now()))
					var existingElement = annotationElement(existing)
					;(existingElement && ((existing.selector = cssPath(existingElement)), (existing.element = descriptorOf(existingElement))), queueEvent('annotate-update', { annotation: cloneAnnotation(existing) }))
				}
				;(closePopover(), updateVisuals(), scheduleFrame())
				return
			}
			var element = draft.element
			;(element && !isConnected(element) && (element = null), element || (draft.region && (element = elementAtPoint(draft.region.x + draft.region.width / 2, draft.region.y + draft.region.height / 2))), element || (element = doc.body || doc.documentElement))
			var descriptor = descriptorOf(element)
			if (!descriptor) {
				closePopover()
				return
			}
			var annotation = { id: makeAnnotationId(), selector: cssPath(element), note, element: descriptor, createdAt: Date.now(), updatedAt: Date.now() }
			;(draft.region && (annotation.region = normalizeRegion(draft.region)), draft.textSelection && (annotation.textSelection = { text: draft.textSelection.text, rect: draft.textSelection.rect, rects: draft.textSelection.rects, selector: draft.textSelection.selector, path: draft.textSelection.path }), annotations.push(annotation), (annotationEls[annotation.id] = element), queueEvent('annotate-add', { annotation: cloneAnnotation(annotation) }), draft.textSelection && ((selectionEl = null), (selectionSelector = '')), closePopover(), updateVisuals(), scheduleFrame())
		}
	}
