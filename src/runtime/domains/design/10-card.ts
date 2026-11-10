// @ts-nocheck
	function designPickerColor(value) {
		var text = String(value == null ? '' : value).trim()
		if (text === '' || text === 'transparent' || /^rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(text)) return '#ffffff'
		var hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
		if (hex) {
			var raw = hex[1]
			return raw.length === 3 ? '#' + raw.charAt(0) + raw.charAt(0) + raw.charAt(1) + raw.charAt(1) + raw.charAt(2) + raw.charAt(2) : '#' + raw
		}
		var rgb = /^rgba?\(([^)]+)\)$/i.exec(text)
		if (rgb) {
			var parts = rgb[1].split(/[\s,\/]+/).map(function (piece) { return parseFloat(piece) }).filter(function (piece) { return isFinite(piece) })
			if (parts.length >= 3) {
				function channel(n) {
					var v = Math.max(0, Math.min(255, Math.round(n)))
					return (v < 16 ? '0' : '') + v.toString(16)
				}
				return '#' + channel(parts[0]) + channel(parts[1]) + channel(parts[2])
			}
		}
		return '#ffffff'
	}
	function designControlStyle(extra) {
		var palette = overlayPalette()
		return Object.assign({
			height: '28px',
			boxSizing: 'border-box',
			border: '1px solid ' + palette.border,
			borderRadius: '8px',
			background: palette.field,
			color: palette.text,
			font: '11.5px/26px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
			padding: '0px 8px',
			outline: 'none',
			minWidth: '0px'
		}, extra || {})
	}
	function designButton(label, primary, onClick) {
		var button = doc.createElement('button'),
			palette = overlayPalette()
		;(button.setAttribute('type', 'button'), (button.textContent = label))
		setStyleMap(button, {
			height: '28px',
			padding: '0 12px',
			borderRadius: '999px',
			border: '1px solid ' + (primary ? palette.accent : 'transparent'),
			background: primary ? palette.accent : 'transparent',
			color: primary ? palette.onAccent : palette.muted,
			font: '600 12px/26px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
			cursor: 'pointer',
			margin: '0px'
		})
		try {
			button.addEventListener('click', function (event) {
				;(event && (event.preventDefault(), event.stopPropagation()), onClick())
			})
		} catch {}
		return button
	}
	function designTag(element) {
		var tag = '<' + tagLower(element) + '>'
		return tag
	}
	function designSnapshotOf(element) {
		var out = {}
		for (
			var props = [
					'color',
					'background-color',
					'opacity',
					'font-family',
					'font-size',
					'font-weight',
					'width',
					'height',
					'display',
					'position',
					'overflow',
					'margin',
					'padding',
					'gap',
					'line-height',
					'letter-spacing',
					'text-align',
					'border',
					'border-radius',
					'box-shadow',
					'transform',
					'z-index',
					'visibility'
				],
				index = 0;
			index < props.length;
			index += 1
		) {
			var prop = props[index]
			out[prop] = computedValue(element, prop)
		}
		return out
	}
	function buildDesignTextRow(property, computed, card, row) {
		var input = doc.createElement('input')
		;(input.setAttribute('type', 'text'), input.setAttribute('spellcheck', 'false'), setStyleMap(input, designControlStyle({ width: '100%' })))
		input.value = computed == null ? '' : String(computed)
		if (row && row.placeholder) input.setAttribute('placeholder', row.placeholder)
		input.addEventListener('change', function () {
			var value = String(input.value || '').trim()
			designApply(property, value === '' ? 'initial' : value)
		})
		;(card.controls[property] = { input: input })
		return input
	}
	function buildDesignNumberRow(property, computed, card, row) {
		var settings = row || {}
		var wrap = doc.createElement('div')
		setStyleMap(wrap, { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0px' })
		var number = doc.createElement('input')
		;(number.setAttribute('type', 'number'), setStyleMap(number, designControlStyle({ flex: '1 1 auto', minWidth: '0px' })))
		if (settings.min !== undefined) number.setAttribute('min', String(settings.min))
		if (settings.max !== undefined) number.setAttribute('max', String(settings.max))
		;(number.setAttribute('step', String(settings.step || 1)))
		var parsed = parseFloat(computed)
		number.value = String(isFinite(parsed) ? Math.round(parsed * 100) / 100 : settings.fallback == null ? 0 : settings.fallback)
		number.addEventListener('input', function () {
			var value = parseFloat(number.value)
			if (!isFinite(value)) return
			designApply(property, value + (settings.unit || ''))
		})
		;(wrap.appendChild(number))
		if (settings.unit) {
			var unit = doc.createElement('span')
			;(unit.textContent = settings.unit, setStyleMap(unit, { color: overlayPalette().muted, font: '11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', flex: 'none' }))
			wrap.appendChild(unit)
		}
		;(card.controls[property] = { number: number })
		return wrap
	}
	function buildDesignSelectRow(property, computed, card, values) {
		var select = doc.createElement('select')
		setStyleMap(select, designControlStyle({ width: '100%', cursor: 'pointer' }))
		var current = String(computed || '').trim().split(/\s+/)[0]
		var options = values.slice()
		if (current && options.indexOf(current) === -1) options.unshift(current)
		for (var index = 0; index < options.length; index += 1) {
			var option = doc.createElement('option')
			;(option.value = options[index], (option.textContent = options[index]), select.appendChild(option))
		}
		if (options.indexOf(current) !== -1) select.value = current
		select.addEventListener('change', function () { designApply(property, select.value) })
		;(card.controls[property] = { select: select })
		return select
	}
	function buildDesignControl(row, computed, card) {
		if (row.kind === 'color') return buildColorRow(row.property, computed, card)
		if (row.kind === 'opacity') return buildOpacityRow(computed, card)
		if (row.kind === 'fontFamily') return buildFontFamilyRow(computed, card)
		if (row.kind === 'fontWeight') return buildFontWeightRow(computed, card)
		if (row.kind === 'number') return buildDesignNumberRow(row.property, computed, card, row)
		if (row.kind === 'select') return buildDesignSelectRow(row.property, computed, card, row.values || [])
		return buildDesignTextRow(row.property, computed, card, row)
	}
	function buildDesignStackRow(labelText, control) {
		var row = doc.createElement('div')
		setStyleMap(row, { display: 'flex', flexDirection: 'column', gap: '5px', paddingBottom: '8px' })
		var label = doc.createElement('span')
		;(label.textContent = labelText, setStyleMap(label, { color: overlayPalette().muted, font: '11px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif' }))
		;(row.appendChild(label), row.appendChild(control))
		return row
	}
	function buildDesignTextContentRow(card) {
		var element = card.element
		var wrap = doc.createElement('div')
		setStyleMap(wrap, { display: 'flex', flexDirection: 'column', gap: '6px' })
		var textarea = doc.createElement('textarea')
		;(textarea.setAttribute(PART_ATTR, 'design-text'), textarea.setAttribute('rows', '3'), textarea.setAttribute('spellcheck', 'false'))
		setStyleMap(textarea, designControlStyle({ width: '100%', height: 'auto', minHeight: '62px', maxHeight: '130px', padding: '6px 8px', resize: 'vertical', lineHeight: '1.45' }))
		textarea.value = card.textBefore == null ? '' : String(card.textBefore)
		textarea.addEventListener('change', function () { designApplyText(textarea.value) })
		wrap.appendChild(textarea)
		;(card.controls.__text = { textarea: textarea })
		return wrap
	}
	function designNodeLabel(node) {
		var label = tagLower(node)
		if (node.id) label += '#' + node.id
		var classes = node.classList
		if (classes && classes.length > 0) label += '.' + Array.prototype.slice.call(classes, 0, 2).join('.')
		return label
	}
	function buildDesignNodeRow(node, depth, current) {
		var button = doc.createElement('button'),
			palette = overlayPalette()
		button.setAttribute('type', 'button')
		button.textContent = designNodeLabel(node)
		setStyleMap(button, {
			display: 'block',
			width: '100%',
			boxSizing: 'border-box',
			padding: '3px 6px 3px ' + (6 + depth * 12) + 'px',
			border: '1px solid ' + (node === current ? palette.border : 'transparent'),
			borderRadius: '6px',
			background: node === current ? palette.fieldStrong : 'transparent',
			color: node === current ? palette.text : palette.muted,
			font: '11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
			textAlign: 'left',
			cursor: 'pointer',
			whiteSpace: 'nowrap',
			overflow: 'hidden',
			textOverflow: 'ellipsis',
			margin: '0px'
		})
		button.addEventListener('mouseenter', function () {
			try {
				var hoverPalette = overlayPalette()
				;(button.style.setProperty('background', hoverPalette.highlight), button.style.setProperty('color', hoverPalette.text))
			} catch {}
		})
		button.addEventListener('mouseleave', function () {
			try {
				var leavePalette = overlayPalette()
				;(button.style.setProperty('background', node === current ? leavePalette.fieldStrong : 'transparent'), button.style.setProperty('color', node === current ? leavePalette.text : leavePalette.muted))
			} catch {}
		})
		button.addEventListener('click', function (event) {
			if (event) {
				event.preventDefault()
				event.stopPropagation()
			}
			if (node !== current) openDesignCard(node)
		})
		return button
	}
	function designTreeNodeCount(element) {
		try {
			return element.children ? element.children.length : 0
		} catch {
			return 0
		}
	}
	function buildDesignDomSection(target, element, card) {
		var wrap = doc.createElement('div')
		setStyleMap(wrap, { display: 'flex', flexDirection: 'column', gap: '4px', paddingBottom: '6px' })
		var ancestorLabel = doc.createElement('span')
		;(ancestorLabel.textContent = locale.designAncestors, setStyleMap(ancestorLabel, { color: overlayPalette().muted, font: '10.5px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif', marginBottom: '1px' }))
		wrap.appendChild(ancestorLabel)
		var chain = []
		for (var cursor = element.parentElement; cursor && chain.length < 10; cursor = cursor.parentElement) chain.unshift(cursor)
		var crumbs = doc.createElement('div')
		setStyleMap(crumbs, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px', paddingBottom: '6px' })
		chain.forEach(function (node, index) {
			if (index > 0) {
				var separator = doc.createElement('span')
				;(separator.textContent = '\u203a', setStyleMap(separator, { color: overlayPalette().muted, font: '11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', opacity: '0.6' }))
				crumbs.appendChild(separator)
			}
			var crumb = doc.createElement('button')
			;(crumb.setAttribute('type', 'button'), (crumb.textContent = designNodeLabel(node)))
			setStyleMap(crumb, { border: '0px', borderRadius: '5px', background: 'transparent', color: overlayPalette().muted, font: '10.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', padding: '1px 4px', cursor: 'pointer', margin: '0px', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
			crumb.addEventListener('click', function (event) {
				if (event) {
					event.preventDefault()
					event.stopPropagation()
				}
				openDesignCard(node)
			})
			crumbs.appendChild(crumb)
		})
		wrap.appendChild(crumbs)
		var descendantLabel = doc.createElement('span')
		;(descendantLabel.textContent = locale.designDescendants, setStyleMap(descendantLabel, { color: overlayPalette().muted, font: '10.5px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif', marginTop: '2px' }))
		wrap.appendChild(descendantLabel)
		var tree = doc.createElement('div')
		setStyleMap(tree, { display: 'flex', flexDirection: 'column', gap: '1px', maxHeight: '46vh', overflow: 'auto' })
		var rendered = 0
		function walk(node, depth) {
			if (rendered >= 80) return
			var children = []
			try {
				children = node.children ? Array.prototype.slice.call(node.children, 0, 12) : []
			} catch {
				children = []
			}
			children.forEach(function (child) {
				if (rendered >= 80) return
				rendered += 1
				tree.appendChild(buildDesignNodeRow(child, depth, target))
				walk(child, depth + 1)
			})
			var extra = designTreeNodeCount(node) - children.length
			if (extra > 0 && depth < 2) {
				var more = doc.createElement('span')
				;(more.textContent = '+' + extra + ' more', setStyleMap(more, { color: overlayPalette().muted, font: '10px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', paddingLeft: 6 + depth * 12 + 'px', opacity: '0.7' }))
				tree.appendChild(more)
			}
		}
		walk(element, 0)
		if (rendered === 0) {
			var empty = doc.createElement('span')
			;(empty.textContent = locale.designNoDescendants, setStyleMap(empty, { color: overlayPalette().muted, font: '10.5px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', padding: '2px 4px' }))
			tree.appendChild(empty)
		}
		wrap.appendChild(tree)
		return wrap
	}
	function designSections() {
		return [
			{
				key: 'content',
				label: locale.designTextContent,
				open: !0,
				render: function (container, element, card) {
					container.appendChild(buildDesignTextContentRow(card))
				}
			},
			{
				key: 'typography',
				label: locale.designTypography,
				open: !0,
				rows: [
					{ kind: 'color', property: 'color', label: locale.designColor },
					{ kind: 'fontFamily', property: 'font-family', label: locale.designFont },
					{ kind: 'number', property: 'font-size', label: locale.designFontSize, unit: 'px', min: 1, step: 1, fallback: 16 },
					{ kind: 'fontWeight', property: 'font-weight', label: locale.designFontWeight },
					{ kind: 'text', property: 'line-height', label: locale.designLineHeight },
					{ kind: 'text', property: 'letter-spacing', label: locale.designLetterSpacing },
					{ kind: 'select', property: 'text-align', label: locale.designTextAlign, values: ['left', 'center', 'right', 'justify', 'start', 'end'] }
				]
			},
			{
				key: 'layout',
				label: locale.designLayout,
				rows: [
					{ kind: 'text', property: 'width', label: locale.designWidth },
					{ kind: 'text', property: 'height', label: locale.designHeight },
					{ kind: 'select', property: 'display', label: locale.designDisplay, values: ['block', 'inline', 'inline-block', 'flex', 'grid', 'none'] },
					{ kind: 'select', property: 'position', label: locale.designPosition, values: ['static', 'relative', 'absolute', 'fixed', 'sticky'] },
					{ kind: 'select', property: 'overflow', label: locale.designOverflow, values: ['visible', 'hidden', 'auto', 'scroll'] }
				]
			},
			{
				key: 'spacing',
				label: locale.designSpacing,
				rows: [
					{ kind: 'text', property: 'margin', label: locale.designMargin },
					{ kind: 'text', property: 'padding', label: locale.designPadding },
					{ kind: 'text', property: 'gap', label: locale.designGap }
				]
			},
			{
				key: 'appearance',
				label: locale.designAppearance,
				rows: [
					{ kind: 'color', property: 'background-color', label: locale.designBackground },
					{ kind: 'opacity', property: 'opacity', label: locale.designOpacity },
					{ kind: 'text', property: 'border', label: locale.designBorder },
					{ kind: 'text', property: 'border-radius', label: locale.designBorderRadius },
					{ kind: 'text', property: 'box-shadow', label: locale.designShadow }
				]
			},
			{
				key: 'advanced',
				label: locale.designAdvanced,
				rows: [
					{ kind: 'text', property: 'transform', label: locale.designTransform },
					{ kind: 'number', property: 'z-index', label: locale.designZIndex, min: -9999, max: 9999, step: 1, fallback: 0 },
					{ kind: 'select', property: 'visibility', label: locale.designVisibility, values: ['visible', 'hidden'] }
				]
			},
		]
	}
	function designApply(property, value) {
		if (!designCard) return !1
		var element = designCard.element
		if (!element || !isConnected(element)) {
			closeDesignCard(!1)
			return !1
		}
		var outcome = applyStyleTo(element, property, value, !0)
		if (!outcome || !outcome.ok) return !1
		var before = designCard.snapshot[property] == null ? '' : designCard.snapshot[property]
		if (outcome.after === before) delete designCard.changed[property]
		else designCard.changed[property] = outcome.after
		queueEvent('design-style', {
			selector: cssPath(element),
			path: pathOf(element),
			property: property,
			before: before,
			after: outcome.after,
			coalesceKey: 'style|' + cssPath(element) + '|' + property
		})
		scheduleFrame()
		return !0
	}
	function designApplyText(value) {
		if (!designCard) return !1
		var element = designCard.element
		if (!element || !isConnected(element)) {
			closeDesignCard(!1)
			return !1
		}
		var outcome = applyTextTo(element, value)
		if (!outcome || !outcome.ok) return !1
		var before = designCard.textBefore == null ? '' : String(designCard.textBefore),
			after = outcome.directText == null ? '' : String(outcome.directText)
		if (after === before) delete designCard.changedText
		else designCard.changedText = after
		queueEvent('design-text', {
			selector: cssPath(element),
			path: pathOf(element),
			before: before,
			after: after,
			coalesceKey: 'text|' + cssPath(element)
		})
		scheduleFrame()
		return !0
	}
	function designRevert() {
		if (!designCard) return
		var card = designCard,
			element = card.element
		if (element && isConnected(element)) {
			for (var property in card.changed) {
				if (!hasOwn(card.changed, property)) continue
				var original = card.snapshot[property]
				if (original == null) continue
				var outcome = applyStyleTo(element, property, original, !0)
				if (outcome && outcome.ok) {
					queueEvent('design-style', {
						selector: cssPath(element),
						path: pathOf(element),
						property: property,
						before: outcome.before,
						after: outcome.after,
						coalesceKey: 'style|' + cssPath(element) + '|' + property
					})
				}
			}
		}
		if (card.changedText !== null) {
			var textOutcome = applyTextTo(element, card.textBefore == null ? '' : card.textBefore)
			if (textOutcome && textOutcome.ok)
				queueEvent('design-text', {
					selector: cssPath(element),
					path: pathOf(element),
					before: textOutcome.before,
					after: textOutcome.directText,
					coalesceKey: 'text|' + cssPath(element)
				})
		}
		;(card.changed = {}), (card.changedText = null)
	}
	function buildDesignRow(labelText, control) {
		var row = doc.createElement('div')
		setStyleMap(row, { display: 'grid', gridTemplateColumns: '76px minmax(0, 1fr)', alignItems: 'center', gap: '10px', minHeight: '36px' })
		var label = doc.createElement('span')
		;(label.textContent = labelText, setStyleMap(label, { color: overlayPalette().muted, font: '11px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))
		;(row.appendChild(label), row.appendChild(control))
		return row
	}
	function buildColorRow(property, computed, card) {
		var wrap = doc.createElement('div')
		setStyleMap(wrap, { display: 'flex', alignItems: 'center', gap: '6px', minWidth: '0px' })
		var picker = doc.createElement('input')
		;(picker.setAttribute('type', 'color'), setStyleMap(picker, { width: '28px', height: '28px', padding: '0px', border: '1px solid ' + overlayPalette().border, borderRadius: '8px', background: 'transparent', cursor: 'pointer', flex: 'none' }))
		picker.value = designPickerColor(computed)
		var text = doc.createElement('input')
		;(text.setAttribute('type', 'text'), text.setAttribute('spellcheck', 'false'), setStyleMap(text, designControlStyle({ flex: '1 1 auto', minWidth: '0px' })))
		text.value = computed === 'rgba(0, 0, 0, 0)' ? 'transparent' : computed
		picker.addEventListener('input', function () {
			text.value = picker.value
			designApply(property, picker.value)
		})
		text.addEventListener('change', function () {
			var value = String(text.value || '').trim()
			if (value === '') value = 'transparent'
			if (designApply(property, value)) picker.value = designPickerColor(value)
		})
		;(wrap.appendChild(picker), wrap.appendChild(text), (card.controls[property] = { picker: picker, text: text }))
		return wrap
	}
	function buildOpacityRow(computed, card) {
		var wrap = doc.createElement('div')
		setStyleMap(wrap, { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0px' })
		var range = doc.createElement('input')
		;(range.setAttribute('type', 'range'), range.setAttribute('min', '0'), range.setAttribute('max', '1'), range.setAttribute('step', '0.01'), setStyleMap(range, { flex: '1 1 auto', minWidth: '0px', accentColor: overlayPalette().accent, height: '28px', margin: '0px' }))
		var initial = parseFloat(computed)
		range.value = String(isFinite(initial) ? Math.max(0, Math.min(1, initial)) : 1)
		var number = doc.createElement('input')
		;(number.setAttribute('type', 'number'), number.setAttribute('min', '0'), number.setAttribute('max', '1'), number.setAttribute('step', '0.01'), setStyleMap(number, designControlStyle({ width: '64px', flex: 'none' })))
		number.value = range.value
		range.addEventListener('input', function () {
			number.value = range.value
			designApply('opacity', range.value)
		})
		number.addEventListener('input', function () {
			var value = parseFloat(number.value)
			if (!isFinite(value)) return
			value = Math.max(0, Math.min(1, value))
			range.value = String(value)
			designApply('opacity', String(value))
		})
		;(wrap.appendChild(range), wrap.appendChild(number), (card.controls.opacity = { range: range, number: number }))
		return wrap
	}
	function buildFontFamilyRow(computed, card) {
		var select = doc.createElement('select')
		setStyleMap(select, designControlStyle({ width: '100%', cursor: 'pointer' }))
		var current = String(computed || '').split(',')[0].replace(/["']/g, '').trim()
		var families = ['-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', 'PingFang SC, "Hiragino Sans GB", sans-serif', 'Inter, sans-serif', 'system-ui, sans-serif', 'Georgia, serif', 'Menlo, monospace']
		if (current && families.indexOf(current) === -1) families.unshift(current)
		for (var index = 0; index < families.length; index += 1) {
			var option = doc.createElement('option')
			;(option.value = families[index], (option.textContent = families[index].split(',')[0].replace(/["']/g, '')), select.appendChild(option))
		}
		select.value = families[1] || current
		for (var cursor = 0; cursor < families.length; cursor += 1) {
			if (families[cursor].indexOf(current) === 0 || current.indexOf(families[cursor].split(',')[0].replace(/["']/g, '')) === 0) {
				select.value = families[cursor]
				break
			}
		}
		select.addEventListener('change', function () { designApply('font-family', select.value) })
		;(card.controls['font-family'] = { select: select })
		return select
	}
	function buildFontSizeRow(computed, card) {
		var wrap = doc.createElement('div')
		setStyleMap(wrap, { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0px' })
		var number = doc.createElement('input')
		;(number.setAttribute('type', 'number'), number.setAttribute('min', '1'), number.setAttribute('step', '1'), setStyleMap(number, designControlStyle({ width: '78px', flex: 'none' })))
		number.value = String(Math.round(parseFloat(computed) || 16))
		var unit = doc.createElement('span')
		;(unit.textContent = 'px', setStyleMap(unit, { color: overlayPalette().muted, font: '11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', flex: 'none' }))
		number.addEventListener('input', function () {
			var value = parseFloat(number.value)
			if (!isFinite(value) || value <= 0) return
			designApply('font-size', value + 'px')
		})
		;(wrap.appendChild(number), wrap.appendChild(unit), (card.controls['font-size'] = { number: number }))
		return wrap
	}
	function buildFontWeightRow(computed, card) {
		var select = doc.createElement('select')
		setStyleMap(select, designControlStyle({ width: '100%', cursor: 'pointer' }))
		var weights = ['300', '400', '500', '600', '700', '800', '900']
		for (var index = 0; index < weights.length; index += 1) {
			var option = doc.createElement('option')
			;(option.value = weights[index], (option.textContent = weights[index]), select.appendChild(option))
		}
		var value = String(parseInt(computed, 10) || 400)
		select.value = weights.indexOf(value) !== -1 ? value : '400'
		select.addEventListener('change', function () { designApply('font-weight', select.value) })
		;(card.controls['font-weight'] = { select: select })
		return select
	}
	function buildDesignCard(element) {
		var wrap = doc.createElement('div'),
			palette = overlayPalette()
		;(wrap.setAttribute(PART_ATTR, 'design'), wrap.setAttribute('role', 'dialog'), wrap.setAttribute('aria-modal', 'false'), wrap.setAttribute('aria-label', locale.designTitle))
		setStyleMap(wrap, {
			position: 'fixed',
			left: '8px',
			top: '8px',
			width: '344px',
			maxWidth: 'calc(100vw - 20px)',
			maxHeight: 'calc(100vh - 20px)',
			zIndex: '11',
			pointerEvents: 'auto',
			boxSizing: 'border-box',
			overflow: 'hidden',
			borderRadius: '22px',
			border: '1px solid ' + palette.border,
			background: palette.bg,
			color: palette.text,
			boxShadow: palette.shadow,
			font: '12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
			textAlign: 'left',
			direction: 'ltr',
			margin: '0px'
		})
		var card = {
			wrap: wrap,
			element: element,
			snapshot: designSnapshotOf(element),
			changed: {},
			changedText: null,
			textBefore: firstDirectTextNode(element) ? String(firstDirectTextNode(element).nodeValue || '') : null,
			controls: {},
			activeSection: 'layout'
		}
		var header = doc.createElement('div')
		setStyleMap(header, { display: 'flex', alignItems: 'center', gap: '8px', padding: '11px 13px 8px' })
		var handle = doc.createElement('span')
		;(handle.textContent = '\u28ff', setStyleMap(handle, { color: palette.muted, font: '12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', cursor: 'grab', flex: 'none', opacity: '0.8' }))
		var tag = doc.createElement('span')
		;(tag.textContent = designTag(element), setStyleMap(tag, { color: palette.text, font: '11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace', background: palette.highlight, borderRadius: '5px', padding: '4px 6px', flex: 'none', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))
		var meta = doc.createElement('span')
		var rect = rectOf(element)
		;(meta.textContent = Math.round(rect.width) + ' \u00d7 ' + Math.round(rect.height), setStyleMap(meta, { color: palette.muted, font: '11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace', marginLeft: 'auto', whiteSpace: 'nowrap', flex: 'none' }))
		var close = doc.createElement('button')
		;(close.setAttribute('type', 'button'), close.setAttribute('aria-label', locale.designClose), (close.textContent = '\u00d7'), setStyleMap(close, { width: '24px', height: '24px', border: '0px', borderRadius: '7px', background: 'transparent', color: palette.muted, font: '18px/22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', cursor: 'pointer', flex: 'none', padding: '0px' }))
		close.addEventListener('click', function (event) { ;(event && (event.preventDefault(), event.stopPropagation()), closeDesignCard(!1)) })
		try {
			handle.setAttribute('title', locale.designMoveHint)
		} catch {}
		var remove = doc.createElement('button')
		;(remove.setAttribute('type', 'button'), remove.setAttribute('aria-label', locale.designDelete), remove.setAttribute('title', locale.designDelete))
		setStyleMap(remove, { width: '24px', height: '24px', flex: 'none', padding: '0px', border: '0px', borderRadius: '7px', background: 'transparent', color: palette.muted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0px 2px 0px 0px' })
		;(remove.appendChild(overlayIcon('trash', 14)),
			remove.addEventListener('mouseenter', function () {
				try {
					;(remove.style.setProperty('background', theme.danger), remove.style.setProperty('color', '#ffffff'))
				} catch {}
			}),
			remove.addEventListener('mouseleave', function () {
				try {
					;(remove.style.setProperty('background', 'transparent'), remove.style.setProperty('color', overlayPalette().muted))
				} catch {}
			}),
			remove.addEventListener('click', function (event) {
				;(event && (event.preventDefault(), event.stopPropagation()), structureRemove(element))
			}))
		;(header.appendChild(handle), header.appendChild(tag), header.appendChild(meta), header.appendChild(remove), header.appendChild(close))
		var body = doc.createElement('div')
		setStyleMap(body, { padding: '0px 13px 10px', overflow: 'auto', maxHeight: 'calc(100vh - 240px)' })
		var sections = designSections().filter(function (section) {
			return !(section.key === 'content' && card.textBefore === null)
		})
		card.openSections = {}
		sections.forEach(function (section) {
			if (section.open) card.openSections[section.key] = !0
		})
		function sectionHeader(section, open) {
			var button = doc.createElement('button')
			;(button.setAttribute('type', 'button'), button.setAttribute('aria-expanded', open ? 'true' : 'false'))
			setStyleMap(button, {
				display: 'flex',
				alignItems: 'center',
				gap: '6px',
				width: '100%',
				boxSizing: 'border-box',
				height: '26px',
				padding: '0px 4px',
				border: '0px',
				borderRadius: '6px',
				background: 'transparent',
				color: open ? palette.text : palette.muted,
				font: '600 11px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
				cursor: 'pointer',
				textAlign: 'left',
				margin: '0px'
			})
			var chevron = doc.createElement('span')
			setStyleMap(chevron, { display: 'inline-flex', flex: 'none', color: palette.muted, transition: 'transform 120ms cubic-bezier(0.23, 1, 0.32, 1)', transform: open ? 'rotate(90deg)' : 'none' })
			chevron.appendChild(overlayIcon('chevron', 12))
			var label = doc.createElement('span')
			;(label.textContent = section.label, setStyleMap(label, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))
			;(button.appendChild(chevron), button.appendChild(label))
			button.addEventListener('mouseenter', function () {
				try {
					button.style.setProperty('background', overlayPalette().sectionHover)
				} catch {}
			})
			button.addEventListener('mouseleave', function () {
				try {
					button.style.setProperty('background', 'transparent')
				} catch {}
			})
			button.addEventListener('click', function (event) {
				if (event) {
					event.preventDefault()
					event.stopPropagation()
				}
				card.openSections[section.key] = card.openSections[section.key] !== !0
				renderSections()
			})
			return button
		}
		function renderSections() {
			while (body.firstChild) body.removeChild(body.firstChild)
			var current = designSnapshotOf(element)
			sections.forEach(function (section) {
				var open = card.openSections[section.key] === !0
				var group = doc.createElement('div')
				setStyleMap(group, { display: 'flex', flexDirection: 'column', gap: '2px', paddingBottom: '2px' })
				group.appendChild(sectionHeader(section, open))
				if (open) {
					var content = doc.createElement('div')
					setStyleMap(content, { padding: '2px 0 8px 4px' })
					if (typeof section.render === 'function') section.render(content, element, card)
					else
						(section.rows || []).forEach(function (row) {
							content.appendChild(buildDesignRow(row.label, buildDesignControl(row, current[row.property], card)))
						})
					group.appendChild(content)
				}
				body.appendChild(group)
			})
		}
		renderSections()
		var footer = doc.createElement('div')
		setStyleMap(footer, { display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 13px 11px', borderTop: '1px solid ' + palette.border })
		var spacer = doc.createElement('span')
		setStyleMap(spacer, { flex: '1 1 auto' })
		var cancel = designButton(locale.designCancel, !1, function () { closeDesignCard(!0) })
		var apply = doc.createElement('button')
		;(apply.setAttribute('type', 'button'), apply.setAttribute('aria-label', locale.designApply), apply.setAttribute('title', locale.designApply))
		setStyleMap(apply, { width: '32px', height: '32px', flex: 'none', padding: '0px', border: '0px', borderRadius: '999px', background: palette.submitFill, color: palette.submitInk, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0px' })
		;(apply.appendChild(overlayIcon('check', 16)), apply.addEventListener('click', function (event) { ;(event && (event.preventDefault(), event.stopPropagation()), closeDesignCard(!1)) }))
		var applyLabel = doc.createElement('span')
		;(applyLabel.textContent = locale.designApply, setStyleMap(applyLabel, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }), apply.appendChild(applyLabel))
		;(footer.appendChild(spacer), footer.appendChild(cancel), footer.appendChild(apply), wrap.appendChild(header), wrap.appendChild(body), wrap.appendChild(footer))
		function stopBubble(event) {
			event && typeof event.stopPropagation == 'function' && event.stopPropagation()
		}
		try {
			;(wrap.addEventListener('click', stopBubble, !1),
				wrap.addEventListener('mousedown', stopBubble, !1),
				wrap.addEventListener('mouseup', stopBubble, !1),
				wrap.addEventListener('pointerdown', stopBubble, !1),
				wrap.addEventListener('input', stopBubble, !1),
				wrap.addEventListener('change', stopBubble, !1),
				wrap.addEventListener('keydown', stopBubble, !1))
		} catch {}
		return card
	}
	function positionDesignCard() {
		if (!designCard || !designCard.wrap) return
		if (!designCard.element || !isConnected(designCard.element)) {
			closeDesignCard(!1)
			return
		}
		var box = rectOf(designCard.element),
			wrap = designCard.wrap,
			width = viewportWidth(),
			height = viewportHeight(),
			usable = Math.max(80, height - safeBottom),
			cardWidth = 344,
			cardHeight = 360
		try {
			var measured = wrap.getBoundingClientRect ? wrap.getBoundingClientRect() : null
			;(measured && measured.width > 0 && (cardWidth = measured.width), measured && measured.height > 0 && (cardHeight = measured.height))
		} catch {}
		var margin = 10,
			gap = 10,
			left = clamp(box.left, margin, Math.max(margin, width - cardWidth - margin)),
			top = box.top - cardHeight - gap
		if (top < margin) top = box.bottom + gap
		top = clamp(top, margin, Math.max(margin, usable - cardHeight - margin))
		;(setStyle(wrap, 'left', left + 'px'), setStyle(wrap, 'top', top + 'px'))
	}
	function closeDesignCard(revert) {
		if (!designCard) return !1
		if (revert) designRevert()
		var card = designCard
		designCard = null
		removeNode(card.wrap)
		updateVisuals()
		scheduleFrame()
		return !0
	}
	function openDesignCard(element) {
		if (!element || element.nodeType !== 1 || isOwnNode(element) || !isConnected(element)) return !1
		;(closePopover(), designCard && closeDesignCard(!1), ensureOverlay())
		var card = buildDesignCard(element)
		designCard = card
		layerAppend(card.wrap)
		positionDesignCard()
		scheduleFrame()
		return !0
	}

	var STRUCTURE_KEY_SEQ = 0,
		STRUCTURE_KEY_OF = new WeakMap(),
		STRUCTURE_KEY_BY_KEY = new Map()
	/**
	 * Stable runtime identity for one element, used instead of a DOM attribute so
	 * the page and its source stay untouched. The WeakMap key keeps the mapping
	 * alive only while the element is; the reverse Map is what `elementByKey`
	 * reads when the host asks the runtime to move an element it anchored earlier.
	 */
	function keyForElement(element) {
		if (!element || element.nodeType !== 1) return ''
		var key = STRUCTURE_KEY_OF.get(element)
		if (key) return key
		STRUCTURE_KEY_SEQ += 1
		key = 'el_' + STRUCTURE_KEY_SEQ
		;(STRUCTURE_KEY_OF.set(element, key), STRUCTURE_KEY_BY_KEY.set(key, element))
		return key
	}
	function structureOuterHTMLOf(element) {
		var html = ''
		try {
			html = element && element.outerHTML !== void 0 ? String(element.outerHTML) : ''
		} catch {
			html = ''
		}
		return html.length > 4000 ? html.slice(0, 3999) + '\u2026' : html
	}
	/**
	 * Anchor v1.5 payload: `textBefore` is the untruncated locating text,
	 * `outerHTML` is capped at 64KiB and flagged instead of ellipsized so the
	 * host can tell a complete marker from a cut one, and `elementKey` is a
	 * runtime-only identity the host can hand back for later structural edits.
	 */
	function structurePayloadOf(element) {
		var html = ''
		try {
			html = element && element.outerHTML !== void 0 ? String(element.outerHTML) : ''
		} catch {
			html = ''
		}
		var truncated = html.length > 65536
		return {
			selector: cssPath(element),
			path: pathOf(element),
			outerHTML: truncated ? html.slice(0, 65536) : html,
			outerHTMLTruncated: truncated,
			textSnippet: visibleTextOf(element),
			textBefore: visibleTextOf(element, 2048),
			elementKey: keyForElement(element),
			sourceHints: sourceHintsOf(element)
		}
	}
	function structureNextSiblingOf(element) {
		for (var sibling = element && element.nextElementSibling, guard = 0; sibling && guard < 60; guard += 1) {
			if (!isOwnNode(sibling)) return sibling
			sibling = sibling.nextElementSibling
		}
		return null
	}
	/** Delete the element (and its subtree) in the page, then report the edit. */
	function structureRemove(element) {
		if (destroyed || !element || element.nodeType !== 1 || isOwnNode(element) || !isConnected(element)) return !1
		var payload = structurePayloadOf(element)
		var parentSelector = element.parentElement ? cssPath(element.parentElement) : ''
		var fromSibling = element.nextElementSibling || null
		var beforeSelector = fromSibling ? cssPath(fromSibling) : null
		var outcome = applyRemoveTo(element)
		if (!outcome || !outcome.ok) return !1
		;((selectionEl = null), (selectionSelector = ''), (hoverEl = null))
		designCard && closeDesignCard(!1)
		queueEvent('design-structure', {
			op: 'remove',
			selector: payload.selector,
			path: payload.path,
			outerHTML: payload.outerHTML,
			outerHTMLTruncated: payload.outerHTMLTruncated,
			textSnippet: payload.textSnippet,
			textBefore: payload.textBefore,
			elementKey: payload.elementKey,
			parentSelector: parentSelector,
			beforeSelector: beforeSelector,
			sourceHints: payload.sourceHints
		})
		queueEvent('selection-lost', {})
		updateVisuals()
		scheduleFrame()
		return !0
	}
	/** Re-parent or reorder the element in the page, then report the edit. */
	function structureMove(element, parent, before) {
		if (destroyed || !element || !parent) return !1
		if (element.nodeType !== 1 || parent.nodeType !== 1 || isOwnNode(element) || isOwnNode(parent)) return !1
		if (!isConnected(element) || !isConnected(parent)) return !1
		if (element === parent || (element.contains && element.contains(parent))) return !1
		if (element.parentElement === parent && (before ? structureNextSiblingOf(element) === before : structureNextSiblingOf(element) === null)) return !1
		var payload = structurePayloadOf(element),
			parentPayload = structurePayloadOf(parent),
			beforePayload = before ? structurePayloadOf(before) : null
		// Capture where the element came from before the DOM mutation, otherwise the
		// inverse move (undo) has no trustworthy origin.
		var fromParentSelector = element.parentElement ? cssPath(element.parentElement) : '',
			fromSibling = element.nextElementSibling || null,
			fromBeforeSelector = fromSibling ? cssPath(fromSibling) : null
		var outcome = applyMoveTo(element, parent, before || null)
		if (!outcome || !outcome.ok) return !1
		queueEvent('design-structure', {
			op: 'move',
			selector: payload.selector,
			path: payload.path,
			outerHTML: payload.outerHTML,
			outerHTMLTruncated: payload.outerHTMLTruncated,
			textSnippet: payload.textSnippet,
			textBefore: payload.textBefore,
			elementKey: payload.elementKey,
			sourceHints: payload.sourceHints,
			targetParentSelector: parentPayload.selector,
			targetParentPath: parentPayload.path,
			targetParentOuterHTML: parentPayload.outerHTML,
			targetParentTextBefore: parentPayload.textSnippet,
			beforeSelector: beforePayload ? beforePayload.selector : null,
			beforePath: beforePayload ? beforePayload.path : null,
			beforeOuterHTML: beforePayload ? beforePayload.outerHTML : null,
			beforeTextBefore: beforePayload ? beforePayload.textSnippet : null,
			fromParentSelector: fromParentSelector,
			fromBeforeSelector: fromBeforeSelector
		})
		selectElement(element, !0)
		designCard && positionDesignCard()
		updateVisuals()
		scheduleFrame()
		return !0
	}
