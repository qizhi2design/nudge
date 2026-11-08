// @ts-nocheck
	function uniqueMatch(scope, selector, element) {
		if (!scope || typeof scope.querySelectorAll != 'function') return !1
		try {
			for (var list = scope.querySelectorAll(selector), found = null, count = 0, index = 0; index < list.length; index += 1) {
				var candidate = list[index]
				if (!isOwnNode(candidate)) {
					if (((count += 1), count > 1)) return !1
					found = candidate
				}
			}
			return count === 1 && found === element
		} catch {
			return !1
		}
	}
	function selectorWithin(element, scope) {
		if (!element) return ''
		if (scope && scope.nodeType === 9 && element === scope.documentElement) return 'html'
		var id = ''
		try {
			id = element.id || (element.getAttribute && element.getAttribute('id')) || ''
		} catch {
			id = ''
		}
		if (id) {
			var idSelector = '#' + cssEscape(id)
			if (uniqueMatch(scope, idSelector, element)) return idSelector
		}
		for (var pieces = [], node = element, guard = 0; node && node.nodeType === 1 && guard < 50; ) {
			for (var piece = localName(node), classNames = classesOf(node).slice(0, 2), classIndex = 0; classIndex < classNames.length; classIndex += 1) piece += '.' + cssEscape(classNames[classIndex])
			var parent = node.parentElement
			if (parent) {
				for (var siblings = [], children = parent.children || [], siblingIndex = 0; siblingIndex < children.length; siblingIndex += 1) {
					var sibling = children[siblingIndex]
					sibling && sibling.nodeType === 1 && localName(sibling) === localName(node) && !isOwnNode(sibling) && siblings.push(sibling)
				}
				if (siblings.length > 1) {
					for (var position = 1, peerIndex = 0; peerIndex < siblings.length; peerIndex += 1)
						if (siblings[peerIndex] === node) {
							position = peerIndex + 1
							break
						}
					piece += ':nth-of-type(' + position + ')'
				}
			}
			pieces.unshift(piece)
			var selector = pieces.join(' > ')
			if (uniqueMatch(scope, selector, element)) return selector
			if (scope && node === scope.documentElement) break
			;((node = parent), (guard += 1))
		}
		return pieces.join(' > ')
	}
	function cssPath(element) {
		if (!element || element.nodeType !== 1) return ''
		try {
			var nodeRoot = element.getRootNode ? element.getRootNode() : doc
			if (nodeRoot && nodeRoot.host) {
				var hostSelector = cssPath(nodeRoot.host),
					innerSelector = selectorWithin(element, nodeRoot)
				return hostSelector ? hostSelector + ' >>> ' + innerSelector : innerSelector
			}
			return selectorWithin(element, doc)
		} catch {
			return ''
		}
	}
	function resolveSelector(selector) {
		if (selector == null) return null
		var text = String(selector).trim()
		if (text === '') return null
		var node = null
		try {
			if (text.indexOf('>>>') !== -1) {
				for (var pieces = text.split('>>>'), current = doc, index = 0; index < pieces.length; index += 1) {
					var piece = pieces[index].trim()
					if (piece === '') return null
					var scope = index === 0 ? doc : current && current.shadowRoot
					if (!scope || typeof scope.querySelector != 'function' || ((current = scope.querySelector(piece)), !current)) return null
				}
				node = current
			} else node = doc.querySelector(text)
		} catch {
			return null
		}
		return !node || node.nodeType !== 1 || isOwnNode(node) ? null : node
	}
	function elementChildrenOf(node) {
		for (var out = [], children = (node && node.children) || [], index = 0; index < children.length; index += 1) children[index] && !isOwnNode(children[index]) && out.push(children[index])
		return out
	}
	function pathOf(element) {
		if (!element || element.nodeType !== 1) return []
		for (var path = [], node = element, guard = 0; node && node.nodeType === 1 && guard < 200; ) {
			if (node === doc.documentElement) return path
			var parent = node.parentElement
			if (!parent) {
				var parentNode = node.parentNode
				if (parentNode && parentNode.nodeType === 11 && parentNode.host) {
					var hostPath = pathOf(parentNode.host),
						shadows = elementChildrenOf(parentNode),
						shadowIndex = shadows.indexOf(node)
					return (hostPath.push(-(shadowIndex + 1)), hostPath)
				}
				return path
			}
			var siblings = elementChildrenOf(parent)
			;(path.unshift(siblings.indexOf(node)), (node = parent), (guard += 1))
		}
		return path
	}
	function resolvePath(path) {
		if (!path || !path.length) return doc.documentElement
		for (var node = doc.documentElement, index = 0; index < path.length; index += 1) {
			if (!node) return null
			var raw = Number(path[index])
			if (!isFinite(raw)) return null
			var offset = Math.floor(raw),
				children
			if (offset < 0) {
				var shadow = node.shadowRoot
				if (!shadow) return null
				;((children = elementChildrenOf(shadow)), (node = children[-offset - 1]))
			} else ((children = elementChildrenOf(node)), (node = children[offset]))
		}
		return node || null
	}
	function xpathOf(element) {
		if (!element || element.nodeType !== 1) return ''
		try {
			var nodeRoot = element.getRootNode ? element.getRootNode() : doc
			return nodeRoot && nodeRoot.host ? xpathOf(nodeRoot.host) + '/shadow-root' + xpathWithin(element, nodeRoot) : xpathWithin(element, doc)
		} catch {
			return ''
		}
	}
	function xpathWithin(element, scope) {
		for (var segments = [], node = element, guard = 0; node && node.nodeType === 1 && guard < 200; ) {
			if (scope && node === scope.documentElement) {
				segments.unshift('html[1]')
				break
			}
			var name = localName(node),
				position = 1,
				parent = node.parentElement
			if (parent) {
				for (var peers = elementChildrenOf(parent), index = 0; index < peers.length; index += 1)
					if (peers[index] === node) {
						position = index + 1
						break
					}
			}
			;(segments.unshift(name + '[' + position + ']'), (node = parent), (guard += 1))
		}
		return '/' + segments.join('/')
	}
