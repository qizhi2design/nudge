// @ts-nocheck
	function findStyleSource(element) {
		var sheets = doc.styleSheets
		if (!sheets) return null
		for (var sheetBudget = 40, ruleBudget = 4e3, lastMatch = null, sheetIndex = 0; sheetIndex < sheets.length && sheetBudget > 0; sheetIndex += 1) {
			sheetBudget -= 1
			var sheet = sheets[sheetIndex],
				href = ''
			try {
				href = sheet.href ? String(sheet.href) : ''
			} catch {
				href = ''
			}
			var rules = null
			try {
				rules = sheet.cssRules
			} catch {
				rules = null
			}
			if (rules)
				for (var stack = [{ list: rules, index: 0 }]; stack.length && ruleBudget > 0; ) {
					var frame = stack[stack.length - 1]
					if (frame.index >= frame.list.length) {
						stack.pop()
						continue
					}
					var rule = frame.list[frame.index]
					;((frame.index += 1), (ruleBudget -= 1), rule && (rule.selectorText && safeMatches(element, rule.selectorText) ? (lastMatch = { href, selector: String(rule.selectorText) }) : rule.cssRules && stack.push({ list: rule.cssRules, index: 0 })))
				}
		}
		return lastMatch
	}
	function sourceHintsOf(element) {
		for (var hints = null, node = element, guard = 0; node && node.nodeType === 1 && guard < 8; ) {
			var source = '',
				line = ''
			try {
				;((source = (node.getAttribute && node.getAttribute('data-source')) || ''), (line = (node.getAttribute && node.getAttribute('data-source-line')) || ''))
			} catch {
				;((source = ''), (line = ''))
			}
			if (source || line) {
				if ((hints || (hints = {}), source && !hints.file)) {
					var match = /^(.*?)(?::(\d+))?$/.exec(String(source).trim())
					match && ((hints.file = match[1]), match[2] && (hints.line = parseInt(match[2], 10)))
				}
				if (line && !hints.line) {
					var parsedLine = parseInt(String(line), 10)
					parsedLine > 0 && (hints.line = parsedLine)
				}
				if (hints.file) break
			}
			;((node = node.parentElement), (guard += 1))
		}
		var styleSource = hints && hints.file ? null : findStyleSource(element)
		return (styleSource && (hints || (hints = {}), styleSource.href && (hints.styleHref = styleSource.href), styleSource.selector && (hints.styleSelector = styleSource.selector)), !hints || (!hints.file && !hints.line && !hints.styleHref && !hints.styleSelector) ? null : hints)
	}
	function descriptorOf(element) {
		if (!element || element.nodeType !== 1) return null
		var outerHTML = ''
		try {
			outerHTML = element.outerHTML === void 0 ? '' : String(element.outerHTML)
		} catch {
			outerHTML = ''
		}
		outerHTML.length > 4e3 && (outerHTML = outerHTML.slice(0, 3999) + '\u2026')
		var id = ''
		try {
			id = element.id || (element.getAttribute && element.getAttribute('id')) || ''
		} catch {
			id = ''
		}
		return {
			selector: cssPath(element),
			xpath: xpathOf(element),
			path: pathOf(element),
			tag: tagLower(element),
			id,
			classes: classesOf(element),
			rect: (function () {
				var box = rectOf(element)
				return { x: box.x, y: box.y, width: box.width, height: box.height }
			})(),
			text: visibleTextOf(element),
			directText: directTextValue(element),
			outerHTML,
			attributes: attributesOf(element),
			styles: computedStylesOf(element),
			inlineStyles: inlineStylesOf(element),
			ancestry: ancestryOf(element),
			sourceHints: sourceHintsOf(element),
			isConnected: isConnected(element)
		}
	}
