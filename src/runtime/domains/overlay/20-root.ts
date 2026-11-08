// @ts-nocheck
	function createOverlay() {
		if (!root)
			try {
				if (
					((root = doc.createElement('div')),
					root.setAttribute(ROOT_ATTR, ''),
					root.setAttribute('aria-hidden', 'true'),
					setStyleMap(
						root,
						{
							position: 'fixed',
							left: '0px',
							top: '0px',
							width: '0px',
							height: '0px',
							zIndex: String(OVERLAY_Z),
							pointerEvents: 'none',
							overflow: 'visible',
							display: 'block',
							visibility: 'visible',
							opacity: '1',
							margin: '0px',
							padding: '0px',
							border: '0px',
							outline: 'none',
							background: 'transparent',
							fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
							fontSize: '12px',
							lineHeight: '1.45',
							direction: 'ltr',
							textAlign: 'left'
						},
						!0
					),
					(layer = root),
					typeof root.attachShadow == 'function')
				)
					try {
						layer = root.attachShadow({ mode: 'open' })
					} catch {
						layer = root
					}
				ensureShadowStyle()
				;((parts = {}),
					(parts.hover = makePart('div', 'hover', {
						position: 'fixed',
						left: '0px',
						top: '0px',
						width: '0px',
						height: '0px',
						borderStyle: 'solid',
						borderWidth: '2px',
						borderColor: annotationAccentColor(),
						borderRadius: '3px',
						boxSizing: 'border-box',
						pointerEvents: 'none',
						display: 'none',
						background: alphaColor(annotationAccentColor(), 0.03),
						boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.28)',
						transition: 'opacity ' + MOTION,
						margin: '0px',
						padding: '0px'
					})),
					(parts.selection = makePart('div', 'selection', {
						position: 'fixed',
						left: '0px',
						top: '0px',
						width: '0px',
						height: '0px',
						borderStyle: 'solid',
						borderWidth: '2px',
						borderColor: annotationAccentColor(),
						borderRadius: '3px',
						boxSizing: 'border-box',
						pointerEvents: 'none',
						display: 'none',
						background: alphaColor(annotationAccentColor(), 0.035),
						boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.28)',
						margin: '0px',
						padding: '0px'
					})),
					(parts.flash = makePart('div', 'flash', {
						position: 'fixed',
						left: '0px',
						top: '0px',
						width: '0px',
						height: '0px',
						borderStyle: 'solid',
						borderWidth: '2px',
						borderColor: annotationAccentColor(),
						borderRadius: '4px',
						boxSizing: 'border-box',
						pointerEvents: 'none',
						display: 'none',
						background: alphaColor(annotationAccentColor(), 0.18),
						margin: '0px',
						padding: '0px'
					})),
					(parts.marquee = makePart('div', 'marquee', {
						position: 'fixed',
						left: '0px',
						top: '0px',
						width: '0px',
						height: '0px',
						borderStyle: 'dashed',
						borderWidth: '2px',
						borderColor: annotationAccentColor(),
						boxSizing: 'border-box',
						pointerEvents: 'none',
						display: 'none',
						background: alphaColor(annotationAccentColor(), 0.1),
						margin: '0px',
						padding: '0px',
						zIndex: '2'
					})),
					(parts.badges = {}),
					(parts.regions = {}))
				;(parts.cursor = doc.createElement('div'))
				try {
					;(parts.cursor.setAttribute(PART_ATTR, 'cursor'), parts.cursor.setAttribute('aria-hidden', 'true'))
				} catch {}
				setStyleMap(parts.cursor, {
					position: 'fixed',
					left: '0px',
					top: '0px',
					width: '26px',
					height: '26px',
					zIndex: '8',
					pointerEvents: 'none',
					display: 'none',
					filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.28))',
					margin: '0px',
					padding: '0px'
				})
				try {
					var cursorSvg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
					cursorSvg.setAttribute('viewBox', '0 0 26 26')
					cursorSvg.setAttribute('width', '26')
					cursorSvg.setAttribute('height', '26')
					cursorSvg.setAttribute('aria-hidden', 'true')
					var cursorPath = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
					cursorPath.setAttribute('d', 'M13 0.825a12.175 12.175 0 0 1 0 24.35H3a2.175 2.175 0 0 1-2.175-2.175V13A12.175 12.175 0 0 1 13 0.825Z')
					;(cursorPath.setAttribute('fill', annotationMarkerColor()), cursorPath.setAttribute('stroke', '#ffffff'), cursorPath.setAttribute('stroke-width', '1.65'), cursorPath.setAttribute('stroke-linejoin', 'round'), cursorSvg.appendChild(cursorPath), parts.cursor.appendChild(cursorSvg))
				} catch {}
				layer.appendChild(parts.cursor)
				;(parts.meta = doc.createElement('div'))
				try {
					;(parts.meta.setAttribute(PART_ATTR, 'meta'), parts.meta.setAttribute('aria-hidden', 'true'))
				} catch {}
				setStyleMap(parts.meta, {
					position: 'fixed',
					left: '0px',
					top: '0px',
					zIndex: '7',
					pointerEvents: 'none',
					display: 'none',
					boxSizing: 'border-box',
					minWidth: '154px',
					maxWidth: '250px',
					padding: '7px 9px',
					borderRadius: '8px',
					border: '1px solid ' + theme.border,
					background: theme.panelBg,
					color: theme.text,
					boxShadow: theme.isDark ? '0 6px 18px rgba(0,0,0,0.42)' : '0 4px 14px rgba(20,30,50,0.14)',
					font: '11px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
					textAlign: 'left',
					margin: '0px'
				})
				var metaTop = doc.createElement('div')
				setStyleMap(metaTop, { display: 'flex', alignItems: 'baseline', gap: '6px', minWidth: '0px' })
				parts.metaTag = doc.createElement('span')
				setStyleMap(parts.metaTag, { color: theme.text, fontWeight: '600', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px', flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
				parts.metaSize = doc.createElement('span')
				setStyleMap(parts.metaSize, { color: theme.text, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11px', marginLeft: 'auto', whiteSpace: 'nowrap' })
				;(metaTop.appendChild(parts.metaTag), metaTop.appendChild(parts.metaSize))
				parts.metaDetail = doc.createElement('div')
				setStyleMap(parts.metaDetail, { color: theme.muted, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
				;(parts.meta.appendChild(metaTop), parts.meta.appendChild(parts.metaDetail), layer.appendChild(parts.meta))
				;(parts.draft = doc.createElement('div'))
				try {
					;(parts.draft.setAttribute(PART_ATTR, 'draft'), parts.draft.setAttribute('aria-hidden', 'true'))
				} catch {}
				setStyleMap(parts.draft, {
					position: 'fixed',
					left: '0px',
					top: '0px',
					width: '26px',
					height: '26px',
					zIndex: '5',
					pointerEvents: 'none',
					display: 'none',
					boxSizing: 'border-box',
					border: '1.65px solid rgba(255,255,255,0.92)',
					borderRadius: '50% 50% 50% 3px',
					background: annotationMarkerColor(),
					color: overlayPalette().onAccent,
					font: '700 13px/23px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
					textAlign: 'center',
					boxShadow: '0 4px 10px rgba(0,0,0,0.28)',
					transformOrigin: 'bottom left',
					transition: 'transform ' + MOTION,
					margin: '0px',
					padding: '0px'
				})
				;(parts.draft.textContent = '\u2022', layer.appendChild(parts.draft))
				;(parts.bar = doc.createElement('div'))
				try {
					;(parts.bar.setAttribute(PART_ATTR, 'bar'), parts.bar.setAttribute('role', 'toolbar'), parts.bar.setAttribute('aria-label', locale.statusAnnotating))
				} catch {}
				setStyleMap(parts.bar, {
					position: 'fixed',
					left: '50%',
					bottom: '14px',
					transform: 'translateX(-50%)',
					height: '48px',
					zIndex: '9',
					pointerEvents: 'auto',
					display: 'none',
					alignItems: 'center',
					gap: '2px',
					boxSizing: 'border-box',
					padding: '6px 8px 6px 6px',
					borderRadius: '14px',
					border: '1px solid ' + overlayPalette().border,
					background: overlayPalette().bgStrong,
					color: overlayPalette().text,
					boxShadow: overlayPalette().barShadow,
					font: '12.5px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
					whiteSpace: 'nowrap',
					margin: '0px'
				})
				parts.barGrip = doc.createElement('button')
				;(parts.barGrip.setAttribute('type', 'button'), parts.barGrip.setAttribute('aria-label', locale.statusMoveToolbar), parts.barGrip.setAttribute('title', locale.statusMoveToolbar))
				setStyleMap(parts.barGrip, {
					width: '22px',
					height: '30px',
					flex: 'none',
					display: 'inline-flex',
					alignItems: 'center',
					justifyContent: 'center',
					padding: '0px',
					border: '0px',
					borderRadius: '8px',
					background: 'transparent',
					color: overlayPalette().muted,
					cursor: 'grab',
					margin: '0px',
					touchAction: 'none'
				})
				parts.barGrip.appendChild(overlayIcon('grip', 15))
				parts.barCount = doc.createElement('span')
				setStyleMap(parts.barCount, { color: overlayPalette().text, fontWeight: '600', fontSize: '12.5px', margin: '0px 6px 0px 4px' })
				parts.barLocate = overlayIconButton('locate', locale.statusLocate, 15)
				parts.barMarkers = overlayIconButton('eyeOff', locale.statusHideMarkers, 15)
				parts.barDiscard = overlayIconButton('trash', locale.statusDiscard, 15)
				parts.barSend = doc.createElement('button')
				;(parts.barSend.setAttribute('type', 'button'), parts.barSend.setAttribute('aria-label', locale.statusSend), parts.barSend.setAttribute('title', locale.statusSend))
				setStyleMap(parts.barSend, {
					height: '30px',
					padding: '0 14px',
					border: '0px',
					borderRadius: '10px',
					background: overlayPalette().accent,
					color: overlayPalette().onAccent,
					font: '600 12.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
					cursor: 'pointer',
					margin: '0px 2px 0px 8px'
				})
				parts.barSend.textContent = locale.statusSend
				parts.barExit = doc.createElement('button')
				;(parts.barExit.setAttribute('type', 'button'), parts.barExit.setAttribute('aria-label', locale.statusExit), parts.barExit.setAttribute('title', locale.statusExit))
				setStyleMap(parts.barExit, { width: '28px', height: '28px', flex: 'none', padding: '0px', border: '0px', borderRadius: '8px', background: 'transparent', color: overlayPalette().muted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0px' })
				parts.barExit.appendChild(overlayIcon('close', 15))
				try {
					parts.barExit.addEventListener('mouseenter', function () {
						try { ;(parts.barExit.style.setProperty('background', overlayPalette().hover), parts.barExit.style.setProperty('color', overlayPalette().text)) } catch {}
					})
					parts.barExit.addEventListener('mouseleave', function () {
						try { ;(parts.barExit.style.setProperty('background', 'transparent'), parts.barExit.style.setProperty('color', overlayPalette().muted)) } catch {}
					})
				} catch {}
				;(parts.bar.appendChild(parts.barGrip), parts.bar.appendChild(parts.barCount), parts.bar.appendChild(parts.barLocate), parts.bar.appendChild(parts.barMarkers), parts.bar.appendChild(parts.barDiscard), parts.bar.appendChild(parts.barSend), parts.bar.appendChild(parts.barExit), layer.appendChild(parts.bar))
				// The bar is built once; applyBarTheme() is the repaint path setTheme reuses.
				applyBarTheme()
				try {
					parts.barGrip.addEventListener('pointerdown', function (event) {
						if (!event) return
						try { ;(event.preventDefault(), event.stopPropagation()) } catch {}
						var startX = Number(event.clientX) || 0,
							startY = Number(event.clientY) || 0,
							baseX = barOffsetX,
							baseY = barOffsetY
						try {
							parts.barGrip.style.setProperty('cursor', 'grabbing')
							parts.barGrip.setPointerCapture && event.pointerId !== undefined && parts.barGrip.setPointerCapture(event.pointerId)
						} catch {}
						function onMove(moveEvent) {
							if (!moveEvent) return
							;(barOffsetX = baseX + ((Number(moveEvent.clientX) || 0) - startX), (barOffsetY = baseY + ((Number(moveEvent.clientY) || 0) - startY)), applyBarPosition())
							try { ;(moveEvent.preventDefault && moveEvent.preventDefault(), moveEvent.stopPropagation && moveEvent.stopPropagation()) } catch {}
						}
						function onUp() {
							try {
								;(doc.removeEventListener('pointermove', onMove, !0), doc.removeEventListener('pointerup', onUp, !0), doc.removeEventListener('pointercancel', onUp, !0), parts.barGrip.style.setProperty('cursor', 'grab'))
							} catch {}
							applyBarPosition()
						}
						try {
							;(doc.addEventListener('pointermove', onMove, !0), doc.addEventListener('pointerup', onUp, !0), doc.addEventListener('pointercancel', onUp, !0))
						} catch {}
					})
					parts.barLocate.addEventListener('click', function (event) {
						;(event && (event.preventDefault(), event.stopPropagation()))
						for (var index = annotations.length - 1; index >= 0; index -= 1) {
							var annotation = annotations[index]
							if (annotation && annotation.selector) {
								locate(annotation.selector)
								return
							}
						}
					})
					parts.barMarkers.addEventListener('click', function (event) {
						;(event && (event.preventDefault(), event.stopPropagation()), (markersHidden = !markersHidden), updateVisuals(), scheduleFrame())
					})
					parts.barDiscard.addEventListener('click', function (event) {
						if (event) {
							event.preventDefault()
							event.stopPropagation()
						}
						var timer = win.setTimeout || setTimeout
						if (!discardArmed) {
							discardArmed = !0
							if (discardTimer !== null) {
								try { (win.clearTimeout || clearTimeout)(discardTimer) } catch {}
								discardTimer = null
							}
							discardTimer = timer.call(win, function () {
								;(discardArmed = !1), (discardTimer = null), updateVisuals(), scheduleFrame()
							}, 3500)
							updateVisuals()
							scheduleFrame()
							return
						}
						;(discardArmed = !1)
						if (discardTimer !== null) {
							try { (win.clearTimeout || clearTimeout)(discardTimer) } catch {}
							discardTimer = null
						}
						annotations.slice().forEach(function (annotation) {
							removeAnnotation(annotation.id)
						})
						updateVisuals()
						scheduleFrame()
					})
					parts.barSend.addEventListener('click', function (event) {
						;(event && (event.preventDefault(), event.stopPropagation()), queueEvent('annotation-send', {}))
					})
					parts.barExit.addEventListener('click', function (event) {
						;(event && (event.preventDefault(), event.stopPropagation()), queueEvent('annotation-exit', {}), setMode('browse'))
					})
				} catch {}
				;(parts.textLayer = makePart('div', 'text-layer', {
					position: 'fixed',
					inset: '0px',
					zIndex: '3',
					pointerEvents: 'none',
					display: 'block',
					margin: '0px',
					padding: '0px'
				}))
				try {
					doc.documentElement.appendChild(root)
				} catch {
					try {
						doc.body.appendChild(root)
					} catch {}
				}
			} catch {
				;((root = null), (layer = null), (parts = null))
			}
	}
