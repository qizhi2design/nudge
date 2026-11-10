// @ts-nocheck
	function patchHistory() {
		var history = win.history
		if (!(!history || typeof history.pushState != 'function' || historyPatched))
			try {
				;((originalPushState = history.pushState),
					(originalReplaceState = history.replaceState),
					(wrappedPushState = function () {
						var result = originalPushState.apply(history, arguments)
						return (schedulePageCheck(), result)
					}),
					(wrappedReplaceState = function () {
						var result = originalReplaceState.apply(history, arguments)
						return (schedulePageCheck(), result)
					}),
					(history.pushState = wrappedPushState),
					(history.replaceState = wrappedReplaceState),
					(historyPatched = !0))
			} catch {
				historyPatched = !1
			}
	}
	function unpatchHistory() {
		if (historyPatched) {
			try {
				var history = win.history
				history && (history.pushState === wrappedPushState && (history.pushState = originalPushState), history.replaceState === wrappedReplaceState && (history.replaceState = originalReplaceState))
			} catch {}
			;((historyPatched = !1), (originalPushState = null), (originalReplaceState = null), (wrappedPushState = null), (wrappedReplaceState = null))
		}
	}
	function startObserver() {
		var Observer = win.MutationObserver || win.WebKitMutationObserver
		if (typeof Observer == 'function')
			try {
				var observer = new Observer(function () {
					;(schedulePageCheck(), visualNeeded() && scheduleFrame())
				})
				;(observer.observe(doc, { childList: !0, subtree: !0, characterData: !0 }), observers.push(observer))
			} catch {}
	}
	function teardown() {
		removeCursorStyle()
		suspended = !0
		for (var index = 0; index < listenerOffs.length; index += 1)
			try {
				listenerOffs[index]()
			} catch {}
		listenerOffs = []
		for (var observerIndex = 0; observerIndex < observers.length; observerIndex += 1)
			try {
				observers[observerIndex].disconnect()
			} catch {}
		if (((observers = []), navTimer !== null)) {
			try {
				;(win.clearTimeout || clearTimeout)(navTimer)
			} catch {}
			navTimer = null
		}
		if (flashTimer !== null) {
			try {
				;(win.clearTimeout || clearTimeout)(flashTimer)
			} catch {}
			flashTimer = null
		}
		if (rafId)
			try {
				rafUsesTimeout ? (win.clearTimeout || clearTimeout)(rafId) : typeof win.cancelAnimationFrame == 'function' && win.cancelAnimationFrame(rafId)
			} catch {}
		unwatchThemeMedia()
		;((rafId = 0), (frameQueued = !1), closeDesignCard(!1), closePopover(), removeNode(root), unpatchHistory(), (root = null), (layer = null), (parts = null))
	}
	function resetState() {
		;((themeDarkExplicit = !1),
			(themeMedia = null),
			(themeMediaHandler = null),
			(mode = 'browse'),
			(selectionEl = null),
			(selectionSelector = ''),
			(hoverEl = null),
			(annotations = []),
			(annotationEls = {}),
			(events = []),
			(popover = null),
			(designCard = null),
			(flashTarget = null),
			(drag = null),
			(suppressClickUntil = 0),
			(passthrough = !1),
			(pointerSeen = !1),
			(pointerX = 0),
			(pointerY = 0),
			(cursorStyleEl = null),
			(cursorSheet = null),
			(theme = copyTheme(DEFAULT_THEME)),
			(locale = copyLocale(DEFAULT_LOCALE)),
			(destroyed = !1),
			(listenerOffs = []),
			(observers = []),
			(rafId = 0),
			(rafUsesTimeout = !1),
			(frameQueued = !1),
			(suspended = !1),
			(navTimer = null),
			(flashTimer = null),
			(historyPatched = !1),
			(originalPushState = null),
			(originalReplaceState = null),
			(wrappedPushState = null),
			(wrappedReplaceState = null),
			(lastUrl = ''),
			(lastPageTitle = ''))
	}
	function attachListeners() {
		;(listen(doc, 'click', onDocumentClick, !0),
			listen(doc, 'mousedown', onDocumentMouseDown, !0),
			listen(doc, 'mousemove', onDocumentMouseMove, !0),
			listen(doc, 'mouseup', onDocumentMouseUp, !0),
			listen(doc, 'mouseout', onDocumentMouseOut, !0),
			listen(doc, 'keydown', onKeyDown, !0),
			listen(doc, 'keyup', onKeyUp, !0),
			listen(win, 'blur', onWindowBlur, !1),
			listen(win, 'scroll', onScroll, !0),
			listen(win, 'resize', onResize, !1),
			listen(win, 'popstate', checkPageInfo, !1),
			listen(win, 'hashchange', checkPageInfo, !1))
	}
	function boot() {
		;(attachListeners(), startObserver(), patchHistory(), watchThemeMedia(), (lastUrl = locationHref()), (lastPageTitle = pageTitle()), queueEvent('page-info', { url: lastUrl, title: lastPageTitle }))
	}
	function reinit() {
		return (teardown(), resetState(), boot(), !0)
	}
	function destroy() {
		;(removeCursorStyle(), teardown(), resetState(), (destroyed = !0))
		try {
			win.__DSH_NUDGE__ === api && (win.__DSH_NUDGE__ = null)
		} catch {}
		return !0
	}
