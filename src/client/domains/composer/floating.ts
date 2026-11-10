// @ts-nocheck
/**
 * Fullscreen floating conversation.
 *
 * When a Nudge tab is presented fullscreen the right-Sidebar panel covers the
 * viewport, and the conversation column (messages + native composer) sits
 * behind it, so users lose access to the chat exactly when they are annotating
 * a page.
 *
 * The reference implementation `@yfwu2020/dsh-full-view` (MIT) showed the
 * approach that survives host upgrades: keep the real conversation mounted and
 * re-present it by marking its own DOM, instead of cloning the editor or
 * forwarding synthetic input. This module applies the same idea in a narrower
 * form: while the owning Nudge tab is fullscreen and visible, the center column
 * is marked as a conversation surface and CSS docks it to the bottom edge,
 * above the fullscreen panel. The native composer, draft, attachments, menus
 * and send path are reused as-is.
 *
 * Presentation:
 *
 *   - compact   only the native composer, docked to the bottom edge and
 *               centred horizontally; the page keeps most of its height.
 *   - expanded  the same docked surface with the messages visible, opened by
 *               pressing the composer (or typing into it) and collapsed by
 *               pressing the page / another window.
 *
 * There is no floating card, header row or close chrome: the surface is a
 * bottom dock, not a window. Collapsing a tab or leaving fullscreen removes the
 * markers and the geometry variable again.
 *
 * Scope decisions:
 *
 *   - Only a docked fullscreen Nudge tab triggers the surface. A floating pane,
 *     another tab or another plugin's panel leaves the layout alone.
 *   - `dsh-full-view` already floats the chat when installed; both markers on
 *     one column would fight, so this module stands down while it is present.
 *   - Every fullscreen entry starts compact, so annotating never interrupts the
 *     page with a transcript until the composer is used.
 *   - The page is never resized. While the dock is compact its height is
 *     published to the page runtime as a bottom safe area, so the page's own
 *     floating UI (annotation composer, style card, annotation bar) is clamped
 *     above the host input box instead of painting underneath it.
 *   - The plugin setting `enableFloatingComposer` gates the whole feature.
 */

var FLOATING_CHAT_ATTR = 'data-dsh-nudge-floating-chat'
var FLOATING_MODE_ATTR = 'data-dsh-nudge-float-mode'
var FLOATING_HEIGHT_VAR = '--dsh-nudge-float-compact-height'
var FLOATING_ANNOTATE_ATTR = 'data-dsh-nudge-float-annotate'
var FLOATING_COLLAPSE_ATTR = 'data-dsh-nudge-float-collapse'
var FLOATING_BUTTON_ATTR = 'data-dsh-nudge-float-button'
var FLOATING_FOREIGN_ATTR = 'data-dsh-floating-chat'
var FLOATING_POPUP_SELECTOR =
  '[role="dialog"], [role="menu"], [role="listbox"], [data-trigger-menu], ' +
  '[data-overlay-owner], [data-dockkit-float]'
/**
 * Extra breathing room above the docked composer seat. The seat is anchored to
 * the bottom of the dock, so raising the compact height by this much shows as a
 * gap between the dock's rounded top edge and the first row inside it (the
 * queued-messages dock or the composer card), instead of them sitting flush.
 */
var FLOATING_COMPACT_TOP_GAP = 10

var FLOATING_DEFAULT_LABELS = Object.freeze({
  collapse: 'Collapse to floating button',
  expand: 'Open chat',
})
var floatingLabels = FLOATING_DEFAULT_LABELS

/**
 * Every mounted Nudge tab publishes its own presentation, keyed by its tab id.
 * Two Nudge tabs can coexist in one Session (a hidden one stays mounted), so a
 * single "last writer wins" slot would let a hiding tab clear the visible one.
 * The manager follows the most recent active owner instead.
 */
var floatingOwners = Object.create(null)
var floatingOwnerTick = 0
/**
 * Annotation / edit mode shows the page runtime's bottom action bar (built in
 * the page document, above the page while the page itself is an Electron
 * webview guest). A host overlay cannot paint below that guest, so the dock
 * reserves that bottom strip instead: while annotating, it lifts above the bar
 * so the bar stays visible and clickable.
 */
var floatingAnnotateOwners = Object.create(null)
var floatingAnnotating = false
var floatingRequest = { active: false, sessionId: '' }
/** Set by installFloatingComposer; null until the plugin applies. */
var floatingController = null

/**
 * Host-to-page safe area. While the compact composer dock covers the bottom of
 * the page, the page's own floating UI (annotation composer, style card,
 * annotation bar) must stay above it: the runtime never paints above host DOM,
 * so the dock height is published as a bottom inset the page clamps against.
 */
var floatingInsetValue = 0
var floatingInsetListeners = []

function publishFloatingInset(value) {
  var next = typeof value === 'number' && isFinite(value) && value > 0 ? Math.round(value) : 0
  if (next === floatingInsetValue) return
  floatingInsetValue = next
  for (var index = 0; index < floatingInsetListeners.length; index += 1) {
    try {
      floatingInsetListeners[index](next)
    } catch (error) {
      /* a disposed page carrier must not break the dock */
    }
  }
}

/** Current reserved bottom strip height (0 when the dock is not covering). */
function floatingComposerInset() {
  return floatingInsetValue
}

/** Subscribe to the reserved bottom strip (0 when the dock is not covering). */
function subscribeFloatingComposerInset(listener) {
  if (typeof listener !== 'function') return function () {}
  floatingInsetListeners.push(listener)
  try {
    listener(floatingInsetValue)
  } catch (error) {
    /* ignore a broken first delivery */
  }
  return function () {
    var index = floatingInsetListeners.indexOf(listener)
    if (index >= 0) floatingInsetListeners.splice(index, 1)
  }
}

// --------------------------------------------------- host annotation bar
/**
 * In fullscreen the inspected page lives in a webview *under* the floating
 * composer. The page's own annotate bar therefore cannot paint above the input
 * box and its drag is clipped to the page viewport. The host renders a twin bar
 * in its own layer (above the dock and the page), forwards its actions to the
 * page runtime, and the runtime hides its built-in bar while hosted.
 */
/** Real SVG namespace for the host annotation-bar glyphs. */
var FLOATING_SVG_NS = 'http://www.w3.org/2000/svg'
var FLOATING_ANNOTATION_BAR_ATTR = 'data-dsh-nudge-float-annotbar'
var floatingAnnotationBarHandlers = null
var floatingAnnotationBarPosition = null
var floatingAnnotationBarState = {
  visible: false,
  count: 0,
  markersHidden: false,
  dark: false,
  /** True once the host published an explicit dark flag (not just the default). */
  darkExplicit: false,
  danger: '#ec1313',
  labels: null,
}

function refreshFloatingAnnotationBar() {
  if (floatingController !== null && typeof floatingController.refreshAnnotationBar === 'function') floatingController.refreshAnnotationBar()
}

/** Action callbacks supplied by NudgeBody (they talk to the page carrier). */
function setFloatingAnnotationBarHandlers(handlers) {
  floatingAnnotationBarHandlers = handlers && typeof handlers === 'object' ? handlers : null
  refreshFloatingAnnotationBar()
}

/** Visible / count / marker state + localized labels supplied by NudgeBody. */
function setFloatingAnnotationBarState(next) {
  if (next && typeof next === 'object') {
    if (typeof next.visible === 'boolean') floatingAnnotationBarState.visible = next.visible
    if (typeof next.count === 'number' && isFinite(next.count)) floatingAnnotationBarState.count = Math.max(0, Math.round(next.count))
    if (typeof next.markersHidden === 'boolean') floatingAnnotationBarState.markersHidden = next.markersHidden
    if (typeof next.dark === 'boolean') {
      floatingAnnotationBarState.dark = next.dark
      floatingAnnotationBarState.darkExplicit = true
    }
    if (typeof next.danger === 'string' && next.danger !== '') floatingAnnotationBarState.danger = next.danger
    if (next.labels && typeof next.labels === 'object') floatingAnnotationBarState.labels = next.labels
  }
  refreshFloatingAnnotationBar()
}

/**
 * Pure eligibility gate, kept separate so the smoke test can pin the rules.
 * Every field must be explicitly true except `foreignFloating`, which the
 * caller resolves before calling.
 */
function floatingComposerEligible(state) {
  return (
    state.fullscreen === true &&
    state.panelOpen === true &&
    state.tabVisible === true &&
    state.docked === true &&
    state.configEnabled === true &&
    state.foreignFloating === false &&
    state.chatPresent === true
  )
}

/** Read a conversation's draft without touching editor internals. */
function floatingDraftPresent(content) {
  if (!content || typeof content.querySelector !== 'function') return false
  try {
    var input = content.querySelector('[data-composer-input], textarea')
    if (!input) return Boolean(content.querySelector('[data-composer-attachment]'))
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      return String(input.value || '').trim() !== ''
    }
    return String(input.textContent || '').trim() !== ''
  } catch (error) {
    return false
  }
}

/**
 * Locate the center column that holds the requested Session's conversation and
 * prove the persistent fullscreen panel is open beside it.
 */
function locateFloatingChat(doc, sessionId) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return null
  var frames = doc.querySelectorAll('[data-rightbar-fullscreen]')
  for (var index = 0; index < frames.length; index += 1) {
    var frame = frames[index]
    if (!frame || typeof frame.querySelector !== 'function') continue
    var panel = frame.querySelector('[data-sidebar-right-panel="fullscreen"][data-sidebar-right-open]')
    if (!panel) continue
    var panelHost = typeof panel.closest === 'function' ? panel.closest('[data-sidebar-right-session]') : null
    var panelSession = panelHost ? panelHost.getAttribute('data-sidebar-right-session') || '' : ''
    if (sessionId !== '' && panelSession !== '' && panelSession !== sessionId) continue
    var col = frame.querySelector('[data-rightbar-col]')
    var chat = col ? col.previousElementSibling : null
    if (!chat || typeof chat.querySelectorAll !== 'function') continue
    var content = null
    var candidates = chat.querySelectorAll('[data-conversation-session]')
    for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      var candidate = candidates[candidateIndex]
      var candidateSession = candidate.getAttribute('data-conversation-session') || ''
      if (sessionId === '' || candidateSession === sessionId) {
        content = candidate
        break
      }
    }
    if (!content) continue
    var foreignFloating = false
    try {
      foreignFloating = typeof doc.querySelector === 'function' && doc.querySelector('[' + FLOATING_FOREIGN_ATTR + ']') !== null
    } catch (error) {
      foreignFloating = false
    }
    if (foreignFloating) return null
    return { frame: frame, panel: panel, chat: chat, content: content }
  }
  return null
}

/**
 * Install the DOM-side manager. Safe on hosts without the expected markers and
 * in the smoke test's minimal document shim: every capability is checked before
 * use and the returned disposer is a no-op when nothing was installed.
 */
function installFloatingComposer(doc) {
  if (!doc || typeof doc.querySelectorAll !== 'function' || typeof doc.addEventListener !== 'function') {
    return function () {}
  }
  var win = doc.defaultView
  if (!win) return function () {}
  if (floatingController !== null) floatingController.dispose()

  function createSvg(paths, fallbackText) {
    if (typeof doc.createElementNS !== 'function') {
      var fallback = doc.createElement('span')
      fallback.textContent = fallbackText || ''
      return fallback
    }
    var svg = doc.createElementNS(FLOATING_SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '1.8')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')
    for (var index = 0; index < paths.length; index += 1) {
      var path = doc.createElementNS(FLOATING_SVG_NS, 'path')
      path.setAttribute('d', paths[index])
      svg.appendChild(path)
    }
    return svg
  }

  function createControl(kind, label) {
    var button = doc.createElement('button')
    button.setAttribute('type', 'button')
    button.setAttribute('aria-label', label)
    button.setAttribute('title', label)
    if (kind === 'collapse') {
      button.setAttribute(FLOATING_COLLAPSE_ATTR, '')
      button.appendChild(createSvg(['M5 9l7 7 7-7'], 'v'))
    } else {
      button.setAttribute(FLOATING_BUTTON_ATTR, '')
      button.appendChild(
        createSvg(
          ['M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8z'],
          'N',
        ),
      )
    }
    return button
  }

  // ------------------------------------------------- host annotation bar
  // Pixel-faithful clone of the page runtime's bar (same 48px pill, palette,
  // 15px Lucide glyphs, fonts, spacing and hover behaviour) so hosting it in
  // the dock never changes the feature's look.
  var ANNOTATION_BAR_LIGHT = {
    bgStrong: '#ffffff',
    border: 'rgba(15,17,21,0.12)',
    text: '#0f1115',
    muted: '#61666b',
    hover: 'rgba(15,17,21,0.06)',
    accent: '#0069FB',
    onAccent: '#ffffff',
    accentDisabled: '#e6ecf5',
    onAccentDisabled: '#4a5563',
    barShadow: '0 12px 32px rgba(20,30,50,0.18)',
  }
  var ANNOTATION_BAR_DARK = {
    bgStrong: '#262626',
    border: 'rgba(255,255,255,0.10)',
    text: '#f5f5f5',
    muted: '#a5a5a5',
    hover: 'rgba(255,255,255,0.08)',
    accent: '#0069FB',
    onAccent: '#ffffff',
    accentDisabled: '#39424f',
    onAccentDisabled: '#c3ccd8',
    barShadow: '0 12px 32px rgba(0, 0, 0, 0.42)',
  }
  var FLOATING_BAR_FONT = '12.5px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif'
  var FLOATING_BAR_SEND_FONT = '600 12.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif'
  var FLOATING_BAR_ICONS = {
    grip: [
      ['circle', { cx: 9, cy: 12, r: 1 }],
      ['circle', { cx: 9, cy: 5, r: 1 }],
      ['circle', { cx: 9, cy: 19, r: 1 }],
      ['circle', { cx: 15, cy: 12, r: 1 }],
      ['circle', { cx: 15, cy: 5, r: 1 }],
      ['circle', { cx: 15, cy: 19, r: 1 }],
    ],
    locate: [
      ['line', { x1: 2, x2: 5, y1: 12, y2: 12 }],
      ['line', { x1: 19, x2: 22, y1: 12, y2: 12 }],
      ['line', { x1: 12, x2: 12, y1: 2, y2: 5 }],
      ['line', { x1: 12, x2: 12, y1: 19, y2: 22 }],
      ['circle', { cx: 12, cy: 12, r: 7 }],
      ['circle', { cx: 12, cy: 12, r: 3 }],
    ],
    eye: [
      ['path', { d: 'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0' }],
      ['circle', { cx: 12, cy: 12, r: 3 }],
    ],
    eyeOff: [
      ['path', { d: 'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49' }],
      ['path', { d: 'M14.084 14.158a3 3 0 0 1-4.242-4.242' }],
      ['path', { d: 'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143' }],
      ['path', { d: 'm2 2 20 20' }],
    ],
    trash: [
      ['path', { d: 'M10 11v6' }],
      ['path', { d: 'M14 11v6' }],
      ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
      ['path', { d: 'M3 6h18' }],
      ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
    ],
    close: [
      ['path', { d: 'M18 6 6 18' }],
      ['path', { d: 'm6 6 12 12' }],
    ],
  }

  var annotationDiscardArmed = false
  var annotationDiscardTimer = null

  /** OS/browser dark preference, used until the host publishes an explicit flag. */
  function floatingPrefersDark() {
    try {
      if (typeof win.matchMedia !== 'function') return false
      var media = win.matchMedia('(prefers-color-scheme: dark)')
      return !!(media && media.matches === true)
    } catch (error) {
      return false
    }
  }

  function annotationBarPalette() {
    var dark = floatingAnnotationBarState.darkExplicit === true ? floatingAnnotationBarState.dark === true : floatingPrefersDark()
    return dark === true ? ANNOTATION_BAR_DARK : ANNOTATION_BAR_LIGHT
  }

  var annotationBarMedia = null
  function onAnnotationBarSchemeChange() {
    refreshAnnotationBar()
  }
  try {
    if (typeof win.matchMedia === 'function') {
      annotationBarMedia = win.matchMedia('(prefers-color-scheme: dark)')
      if (annotationBarMedia && typeof annotationBarMedia.addEventListener === 'function') {
        annotationBarMedia.addEventListener('change', onAnnotationBarSchemeChange)
      }
    }
  } catch (error) {
    annotationBarMedia = null
  }

  function setAnnotationBarStyles(node, styles) {
    if (!node || !styles) return
    for (var key in styles) {
      if (!Object.prototype.hasOwnProperty.call(styles, key)) continue
      try {
        node.style[key] = styles[key]
      } catch (error) {
        /* a single property never blocks the bar */
      }
    }
  }

  /** Same geometry as the page runtime's `overlayIcon` (15px, stroke 2). */
  function annotationBarIcon(name, size) {
    var nodes = FLOATING_BAR_ICONS[name] || FLOATING_BAR_ICONS.close
    var svg = doc.createElementNS(FLOATING_SVG_NS, 'svg')
    ;(svg.setAttribute('viewBox', '0 0 24 24'), svg.setAttribute('width', String(size || 15)), svg.setAttribute('height', String(size || 15)), svg.setAttribute('fill', 'none'), svg.setAttribute('stroke', 'currentColor'), svg.setAttribute('stroke-width', '2'), svg.setAttribute('stroke-linecap', 'round'), svg.setAttribute('stroke-linejoin', 'round'), svg.setAttribute('aria-hidden', 'true'))
    try {
      svg.style.display = 'block'
    } catch (error) {
      /* display block is a cosmetic guarantee */
    }
    ;(nodes || []).forEach(function (node) {
      if (!node || !node[0]) return
      var child = doc.createElementNS(FLOATING_SVG_NS, node[0])
      var attrs = node[1] || {}
      for (var key in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, key)) child.setAttribute(key, String(attrs[key]))
      }
      svg.appendChild(child)
    })
    return svg
  }

  function setAnnotationBarIcon(bar, name) {
    if (!bar || bar.markerIcon === name) return
    bar.markerIcon = name
    while (bar.markers.firstChild) bar.markers.removeChild(bar.markers.firstChild)
    bar.markers.appendChild(annotationBarIcon(name, 15))
  }

  function stopAnnotationBarEvent(event) {
    if (!event) return
    try {
      if (event.preventDefault) event.preventDefault()
      if (event.stopPropagation) event.stopPropagation()
    } catch (error) {
      /* ignore */
    }
  }

  function fireAnnotationBarAction(name) {
    var handlers = floatingAnnotationBarHandlers
    if (!handlers || typeof handlers[name] !== 'function') return
    try {
      handlers[name]()
    } catch (error) {
      /* a failed action must not break the bar */
    }
  }

  function clearAnnotationDiscard() {
    annotationDiscardArmed = false
    if (annotationDiscardTimer !== null) {
      try {
        ;(win.clearTimeout || clearTimeout)(annotationDiscardTimer)
      } catch (error) {
        /* ignore */
      }
      annotationDiscardTimer = null
    }
  }

  function onAnnotationBarDiscard() {
    var timer = win.setTimeout || setTimeout
    if (!annotationDiscardArmed) {
      annotationDiscardArmed = true
      if (annotationDiscardTimer !== null) {
        try {
          ;(win.clearTimeout || clearTimeout)(annotationDiscardTimer)
        } catch (error) {
          /* ignore */
        }
        annotationDiscardTimer = null
      }
      annotationDiscardTimer = timer.call(win, function () {
        annotationDiscardArmed = false
        annotationDiscardTimer = null
        refreshAnnotationBar()
      }, 3500)
      refreshAnnotationBar()
      return
    }
    clearAnnotationDiscard()
    fireAnnotationBarAction('discard')
    refreshAnnotationBar()
  }

  function applyAnnotationBarPosition(left, top) {
    if (!active || !active.annotationBar) return
    var bar = active.annotationBar
    var rect = null
    try {
      rect = bar.root.getBoundingClientRect ? bar.root.getBoundingClientRect() : null
    } catch (error) {
      rect = null
    }
    var width = rect && rect.width > 0 ? rect.width : 320
    var height = rect && rect.height > 0 ? rect.height : 48
    var viewWidth = Number(win.innerWidth) || 1024
    var viewHeight = Number(win.innerHeight) || 768
    var margin = 8
    var nextLeft = Math.max(margin, Math.min(Math.max(margin, viewWidth - width - margin), Math.round(Number(left) || 0)))
    var nextTop = Math.max(margin, Math.min(Math.max(margin, viewHeight - height - margin), Math.round(Number(top) || 0)))
    floatingAnnotationBarPosition = { left: nextLeft, top: nextTop }
    bar.root.style.left = nextLeft + 'px'
    bar.root.style.top = nextTop + 'px'
  }

  /**
   * First show mirrors the page placement: centred, `8px` above the dock (the
   * old safe-area lift). Dragging then pins the position anywhere in the window.
   */
  function defaultAnnotationBarPosition() {
    var viewWidth = Number(win.innerWidth) || 1024
    var viewHeight = Number(win.innerHeight) || 768
    var rect = null
    if (active && active.annotationBar && active.annotationBar.root.getBoundingClientRect) {
      try {
        rect = active.annotationBar.root.getBoundingClientRect()
      } catch (error) {
        rect = null
      }
    }
    var width = rect && rect.width > 0 ? rect.width : 320
    var height = rect && rect.height > 0 ? rect.height : 48
    var dockRect = null
    if (active && active.chat && active.chat.getBoundingClientRect) {
      try {
        dockRect = active.chat.getBoundingClientRect()
      } catch (error) {
        dockRect = null
      }
    }
    var dockHeight = dockRect && dockRect.height > 0 ? dockRect.height : 0
    return {
      left: Math.round((viewWidth - width) / 2),
      top: dockHeight > 0 ? Math.round(viewHeight - dockHeight - height - 8) : Math.round(viewHeight - height - 14),
    }
  }

  function startAnnotationBarDrag(event) {
    if (!active || !active.annotationBar || !event) return
    stopAnnotationBarEvent(event)
    var root = active.annotationBar.root
    var grip = active.annotationBar.grip
    var rect = null
    try {
      rect = root.getBoundingClientRect ? root.getBoundingClientRect() : null
    } catch (error) {
      rect = null
    }
    var startX = Number(event.clientX) || 0
    var startY = Number(event.clientY) || 0
    var baseLeft = rect ? rect.left : floatingAnnotationBarPosition ? floatingAnnotationBarPosition.left : 0
    var baseTop = rect ? rect.top : floatingAnnotationBarPosition ? floatingAnnotationBarPosition.top : 0
    try {
      ;(grip.style.setProperty('cursor', 'grabbing'), typeof event.pointerId === 'number' && typeof root.setPointerCapture === 'function' && root.setPointerCapture(event.pointerId))
    } catch (error) {
      /* pointer capture is optional */
    }
    function onMove(moveEvent) {
      if (!moveEvent) return
      applyAnnotationBarPosition(baseLeft + ((Number(moveEvent.clientX) || 0) - startX), baseTop + ((Number(moveEvent.clientY) || 0) - startY))
      stopAnnotationBarEvent(moveEvent)
    }
    function onUp() {
      try {
        ;(doc.removeEventListener('pointermove', onMove, true), doc.removeEventListener('pointerup', onUp, true), doc.removeEventListener('pointercancel', onUp, true), grip.style.setProperty('cursor', 'grab'))
      } catch (error) {
        /* ignore */
      }
    }
    try {
      ;(doc.addEventListener('pointermove', onMove, true), doc.addEventListener('pointerup', onUp, true), doc.addEventListener('pointercancel', onUp, true))
    } catch (error) {
      /* ignore */
    }
  }

  function annotationBarIconButton(iconName, label, onClick) {
    var button = doc.createElement('button')
    ;(button.setAttribute('type', 'button'), button.setAttribute('aria-label', label), button.setAttribute('title', label))
    setAnnotationBarStyles(button, {
      width: '28px',
      height: '28px',
      flex: 'none',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0px',
      border: '0px',
      borderRadius: '8px',
      background: 'transparent',
      color: annotationBarPalette().muted,
      cursor: 'pointer',
      margin: '0px',
    })
    button.appendChild(annotationBarIcon(iconName, 15))
    button.addEventListener('mouseenter', function () {
      try {
        var palette = annotationBarPalette()
        ;(button.style.setProperty('background', palette.hover), button.style.setProperty('color', palette.text))
      } catch (error) {
        /* ignore */
      }
    })
    button.addEventListener('mouseleave', function () {
      try {
        ;(button.style.setProperty('background', 'transparent'), button.style.setProperty('color', annotationBarPalette().muted))
      } catch (error) {
        /* ignore */
      }
    })
    button.addEventListener('click', function (event) {
      stopAnnotationBarEvent(event)
      onClick()
    })
    return button
  }

  function createAnnotationBar() {
    var root = doc.createElement('div')
    root.setAttribute(FLOATING_ANNOTATION_BAR_ATTR, '')
    root.setAttribute('role', 'toolbar')
    root.setAttribute('aria-label', '正在批注')
    var palette = annotationBarPalette()
    setAnnotationBarStyles(root, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      height: '48px',
      zIndex: '65',
      pointerEvents: 'auto',
      display: 'none',
      alignItems: 'center',
      gap: '2px',
      boxSizing: 'border-box',
      padding: '6px 8px 6px 6px',
      borderRadius: '14px',
      border: '1px solid ' + palette.border,
      background: palette.bgStrong,
      color: palette.text,
      boxShadow: palette.barShadow,
      font: FLOATING_BAR_FONT,
      whiteSpace: 'nowrap',
      margin: '0px',
    })

    var grip = doc.createElement('button')
    ;(grip.setAttribute('type', 'button'), grip.setAttribute('aria-label', 'Move toolbar'), grip.setAttribute('title', 'Move toolbar'), grip.setAttribute('data-annotbar-grip', ''))
    setAnnotationBarStyles(grip, {
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
      color: palette.muted,
      cursor: 'grab',
      margin: '0px',
      touchAction: 'none',
    })
    grip.appendChild(annotationBarIcon('grip', 15))

    var count = doc.createElement('span')
    count.setAttribute('data-annotbar-count', '')
    setAnnotationBarStyles(count, { color: palette.text, fontWeight: '600', fontSize: '12.5px', margin: '0px 6px 0px 4px' })

    var locate = annotationBarIconButton('locate', 'Locate latest annotation', function () {
      fireAnnotationBarAction('locate')
    })
    locate.setAttribute('data-annotbar-locate', '')
    var markers = annotationBarIconButton('eyeOff', 'Hide markers', function () {
      fireAnnotationBarAction('toggleMarkers')
    })
    markers.setAttribute('data-annotbar-markers', '')
    var discard = annotationBarIconButton('trash', 'Discard annotations', function () {
      onAnnotationBarDiscard()
    })
    discard.setAttribute('data-annotbar-discard', '')

    var send = doc.createElement('button')
    ;(send.setAttribute('type', 'button'), send.setAttribute('aria-label', 'Send'), send.setAttribute('title', 'Send'), send.setAttribute('data-annotbar-send', ''))
    setAnnotationBarStyles(send, {
      height: '30px',
      padding: '0 14px',
      border: '0px',
      borderRadius: '10px',
      background: palette.accent,
      color: palette.onAccent,
      font: FLOATING_BAR_SEND_FONT,
      cursor: 'pointer',
      margin: '0px 2px 0px 8px',
    })

    var exit = doc.createElement('button')
    ;(exit.setAttribute('type', 'button'), exit.setAttribute('aria-label', 'Exit'), exit.setAttribute('title', 'Exit'), exit.setAttribute('data-annotbar-exit', ''))
    setAnnotationBarStyles(exit, {
      width: '28px',
      height: '28px',
      flex: 'none',
      padding: '0px',
      border: '0px',
      borderRadius: '8px',
      background: 'transparent',
      color: palette.muted,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      margin: '0px',
    })
    exit.appendChild(annotationBarIcon('close', 15))
    exit.addEventListener('mouseenter', function () {
      try {
        var hoverPalette = annotationBarPalette()
        ;(exit.style.setProperty('background', hoverPalette.hover), exit.style.setProperty('color', hoverPalette.text))
      } catch (error) {
        /* ignore */
      }
    })
    exit.addEventListener('mouseleave', function () {
      try {
        ;(exit.style.setProperty('background', 'transparent'), exit.style.setProperty('color', annotationBarPalette().muted))
      } catch (error) {
        /* ignore */
      }
    })
    exit.addEventListener('click', function (event) {
      stopAnnotationBarEvent(event)
      fireAnnotationBarAction('exit')
    })

    grip.addEventListener('pointerdown', startAnnotationBarDrag)
    send.addEventListener('click', function (event) {
      stopAnnotationBarEvent(event)
      fireAnnotationBarAction('send')
    })

    ;[grip, count, locate, markers, discard, send, exit].forEach(function (node) {
      root.appendChild(node)
    })
    return { root: root, grip: grip, count: count, locate: locate, markers: markers, discard: discard, send: send, exit: exit, markerIcon: '' }
  }

  /** Repaints exactly like the runtime's applyBarTheme + updateBar. */
  function paintAnnotationBar(bar) {
    var palette = annotationBarPalette()
    var disabled = floatingAnnotationBarState.count <= 0
    try {
      ;(bar.root.style.setProperty('border-color', palette.border),
        bar.root.style.setProperty('background', palette.bgStrong),
        bar.root.style.setProperty('color', palette.text),
        bar.root.style.setProperty('box-shadow', palette.barShadow),
        bar.grip.style.setProperty('color', palette.muted),
        bar.count.style.setProperty('color', palette.text),
        bar.send.style.setProperty('background', disabled ? palette.accentDisabled : palette.accent),
        bar.send.style.setProperty('color', disabled ? palette.onAccentDisabled : palette.onAccent),
        typeof bar.send.style.removeProperty === 'function' && bar.send.style.removeProperty('opacity'),
        bar.exit.style.setProperty('color', palette.muted),
        bar.locate.style.setProperty('color', palette.muted),
        bar.markers.style.setProperty('color', palette.muted),
        bar.discard.style.setProperty('color', annotationDiscardArmed ? floatingAnnotationBarState.danger || '#ec1313' : palette.muted))
    } catch (error) {
      /* ignore */
    }
  }

  function refreshAnnotationBar() {
    if (!active) return
    var bar = active.annotationBar
    if (!bar) return
    var state = floatingAnnotationBarState
    var labels = state.labels || {}
    var visible = state.visible === true
    bar.root.style.display = visible ? 'flex' : 'none'
    if (!visible) {
      clearAnnotationDiscard()
      return
    }
    paintAnnotationBar(bar)
    bar.root.setAttribute('aria-label', labels.annotating || '正在批注')
    bar.count.textContent = (labels.annotating || '正在批注') + (state.count > 0 ? ' · ' + state.count : '')
    bar.send.textContent = labels.send || '发送'
    var disabled = state.count <= 0
    bar.send.setAttribute('aria-disabled', disabled ? 'true' : 'false')
    try {
      if (typeof bar.send.style.removeProperty === 'function') bar.send.style.removeProperty('opacity')
      bar.send.style.setProperty('cursor', disabled ? 'default' : 'pointer')
    } catch (error) {
      /* ignore */
    }
    bar.grip.setAttribute('title', labels.moveToolbar || '移动工具栏')
    bar.grip.setAttribute('aria-label', labels.moveToolbar || '移动工具栏')
    bar.locate.setAttribute('title', labels.locate || '定位最新批注')
    bar.locate.setAttribute('aria-label', labels.locate || '定位最新批注')
    var markersLabel = state.markersHidden ? labels.showMarkers || '显示标记' : labels.hideMarkers || '隐藏标记'
    bar.markers.setAttribute('title', markersLabel)
    bar.markers.setAttribute('aria-label', markersLabel)
    setAnnotationBarIcon(bar, state.markersHidden ? 'eye' : 'eyeOff')
    var discardLabel = annotationDiscardArmed ? labels.discardArmed || '再次点击丢弃全部批注' : labels.discard || '丢弃批注'
    bar.discard.setAttribute('title', discardLabel)
    bar.discard.setAttribute('aria-label', discardLabel)
    if (annotationDiscardArmed) bar.discard.setAttribute('data-armed', '')
    else bar.discard.removeAttribute('data-armed')
    bar.exit.setAttribute('title', labels.exit || '退出批注')
    bar.exit.setAttribute('aria-label', labels.exit || '退出批注')
    var position = floatingAnnotationBarPosition || defaultAnnotationBarPosition()
    applyAnnotationBarPosition(position.left, position.top)
  }

  var disposed = false
  var active = null
  var seatObserver = null
  var frameHandle = null
  var retries = 0
  var unsubscribeConfig = null

  /**
   * Height of the compact dock, measured from the viewport bottom. The page
   * keeps its full height (the dock floats over it); this value is published to
   * the current page runtime so its own floating panels are clamped above the
   * dock instead of being painted underneath the host input box.
   */
  function pageInset() {
    if (!active || active.mode !== 'compact') return 0
    var height = 0
    try {
      var rect = active.chat.getBoundingClientRect ? active.chat.getBoundingClientRect() : null
      if (rect && rect.height > 0) height = rect.height
    } catch (error) {
      height = 0
    }
    if (!(height > 0)) {
      var raw = active.chat.style.getPropertyValue(FLOATING_HEIGHT_VAR)
      height = parseFloat(raw) || 0
    }
    return Math.max(0, Math.round(height))
  }

  function publishInset() {
    publishFloatingInset(active ? pageInset() : 0)
  }

  /**
   * The collapse control lives in the host layer, above the dock, so the same
   * "shrink to the floating button" affordance exists in both presentations:
   * inside the expanded dock's top-right corner, or just above the compact
   * input bar. Both shrink to the floating button.
   */
  function positionCollapseButton() {
    if (!active || !active.collapseButton) return
    var button = active.collapseButton
    var rect = null
    try {
      rect = active.chat.getBoundingClientRect ? active.chat.getBoundingClientRect() : null
    } catch (error) {
      rect = null
    }
    var viewWidth = 0
    var viewHeight = 0
    try {
      viewWidth = Number(win.innerWidth) || 0
      viewHeight = Number(win.innerHeight) || 0
    } catch (error) {
      viewWidth = 0
      viewHeight = 0
    }
    var right = 8
    if (rect && rect.right > 0 && viewWidth > 0) right = Math.max(8, Math.round(viewWidth - rect.right + 8))
    button.style.left = 'auto'
    button.style.right = right + 'px'
    if (active.mode === 'expanded') {
      var top = rect && rect.top > 0 ? Math.round(rect.top + 8) : 8
      button.style.top = top + 'px'
      button.style.bottom = 'auto'
      return
    }
    var dockHeight = 0
    if (rect && rect.height > 0) dockHeight = rect.height
    else dockHeight = parseFloat(active.chat.style.getPropertyValue(FLOATING_HEIGHT_VAR)) || 0
    var fromBottom = dockHeight
    if (viewHeight > 0 && rect && rect.top > 0) fromBottom = viewHeight - rect.top
    button.style.top = 'auto'
    button.style.bottom = Math.max(8, Math.round(fromBottom) + 8) + 'px'
  }

  function applyControls() {
    if (!active) return
    if (active.collapseButton) active.collapseButton.hidden = active.mode === 'hidden'
    if (active.floatButton) active.floatButton.hidden = active.mode !== 'hidden'
    positionCollapseButton()
  }

  function setMode(mode) {
    if (!active) return
    // The dock can expand in every mode (including annotate): focusing or
    // pressing the composer opens the history, and the page keeps full height.
    // Its runtime UI is clamped above the dock only while the dock is compact.
    if (active.mode === mode) {
      applyControls()
      publishInset()
      return
    }
    active.mode = mode
    active.chat.setAttribute(FLOATING_MODE_ATTR, mode)
    applyControls()
    measure()
  }

  function measure() {
    if (!active) return
    var seat = active.content.querySelector('[data-composer-seat]')
    var height = seat && typeof seat.getBoundingClientRect === 'function' ? seat.getBoundingClientRect().height : 0
    if (!(height > 0)) height = 56
    var compact = Math.max(52, Math.min(280, Math.round(height) + 4 + FLOATING_COMPACT_TOP_GAP))
    active.chat.style.setProperty(FLOATING_HEIGHT_VAR, compact + 'px')
    positionCollapseButton()
    publishInset()
  }

  function detachSeat() {
    if (seatObserver !== null) {
      try {
        seatObserver.disconnect()
      } catch (error) {
        /* disconnected already */
      }
      seatObserver = null
    }
  }

  function attachSeat(content) {
    detachSeat()
    if (typeof win.ResizeObserver !== 'function') return
    var seat = content.querySelector('[data-composer-seat]')
    if (!seat) return
    seatObserver = new win.ResizeObserver(function () {
      if (!disposed) measure()
    })
    seatObserver.observe(seat)
  }

  function applyAnnotateState(chat) {
    if (!chat || typeof chat.setAttribute !== 'function') return
    if (floatingAnnotating) chat.setAttribute(FLOATING_ANNOTATE_ATTR, '')
    else chat.removeAttribute(FLOATING_ANNOTATE_ATTR)
  }

  function applyAnnotateLayout() {
    if (!active) return
    if (floatingAnnotating) setMode('compact')
    else publishInset()
  }

  function activate(target) {
    var collapseButton = createControl('collapse', floatingLabels.collapse)
    var floatButton = createControl('float', floatingLabels.expand)
    try {
      ;(doc.body || target.frame || target.chat).appendChild(collapseButton)
    } catch (error) {
      /* no body yet; the control stays detached until the next activation */
    }
    try {
      ;(doc.body || target.frame || target.chat).appendChild(floatButton)
    } catch (error) {
      /* no body yet; the button stays detached until the next activation */
    }
    active = {
      chat: target.chat,
      content: target.content,
      panel: target.panel,
      mode: 'compact',
      collapseButton: collapseButton,
      floatButton: floatButton,
    }
    collapseButton.addEventListener('click', onCollapseToButton)
    floatButton.addEventListener('click', onExpandFromButton)
    target.chat.setAttribute(FLOATING_CHAT_ATTR, '')
    target.chat.setAttribute(FLOATING_MODE_ATTR, 'compact')
    active.annotationBar = createAnnotationBar()
    try {
      ;(doc.body || target.frame || target.chat).appendChild(active.annotationBar.root)
    } catch (error) {
      /* no body yet; the bar appears on the next activation */
    }
    floatingAnnotationBarPosition = null
    applyAnnotateState(target.chat)
    applyControls()
    attachSeat(target.content)
    measure()
    refreshAnnotationBar()
  }

  function onCollapseToButton() {
    setMode('hidden')
  }

  function onExpandFromButton() {
    setMode('expanded')
  }

  function removeControls() {
    if (!active) return
    clearAnnotationDiscard()
    var controls = [active.collapseButton, active.floatButton, active.annotationBar ? active.annotationBar.root : null]
    for (var index = 0; index < controls.length; index += 1) {
      var node = controls[index]
      if (!node) continue
      try {
        node.removeEventListener('click', onCollapseToButton)
        node.removeEventListener('click', onExpandFromButton)
      } catch (error) {
        /* no listeners left */
      }
      if (node.parentNode && typeof node.parentNode.removeChild === 'function') {
        try {
          node.parentNode.removeChild(node)
        } catch (error) {
          /* the column unmounted with its Session */
        }
      }
    }
  }

  function deactivate() {
    detachSeat()
    if (active === null) return
    var chat = active.chat
    removeControls()
    try {
      chat.removeAttribute(FLOATING_CHAT_ATTR)
      chat.removeAttribute(FLOATING_MODE_ATTR)
      chat.removeAttribute(FLOATING_ANNOTATE_ATTR)
      chat.style.removeProperty(FLOATING_HEIGHT_VAR)
    } catch (error) {
      /* the column unmounted with its Session */
    }
    active = null
    floatingAnnotationBarPosition = null
    publishFloatingInset(0)
  }

  function configAllows() {
    try {
      return pluginConfigValues().enableFloatingComposer !== false
    } catch (error) {
      return true
    }
  }

  function sync() {
    if (disposed) return
    frameHandle = null
    if (!floatingRequest.active || !configAllows()) {
      retries = 0
      deactivate()
      return
    }
    var target = locateFloatingChat(doc, floatingRequest.sessionId)
    if (!target) {
      deactivate()
      if (retries > 0) {
        retries -= 1
        schedule()
      }
      return
    }
    retries = 0
    if (active !== null && active.chat === target.chat) {
      var contentChanged = active.content !== target.content
      active.content = target.content
      if (contentChanged) attachSeat(target.content)
      measure()
      return
    }
    deactivate()
    activate(target)
  }

  function schedule() {
    if (disposed || frameHandle !== null) return
    var run = function () {
      frameHandle = null
      sync()
    }
    frameHandle =
      typeof win.requestAnimationFrame === 'function'
        ? win.requestAnimationFrame(run)
        : win.setTimeout(run, 16)
  }

  function onPointerDown(event) {
    if (!active) return
    var target = event.target
    if (target !== null && typeof target.closest === 'function' && target.closest('[' + FLOATING_COLLAPSE_ATTR + '], [' + FLOATING_BUTTON_ATTR + '], [' + FLOATING_ANNOTATION_BAR_ATTR + ']')) return
    var inside = target !== null && typeof active.chat.contains === 'function' && active.chat.contains(target)
    if (active.mode === 'hidden') return
    if (active.mode === 'compact') {
      if (inside) setMode('expanded')
      return
    }
    if (inside) return
    if (target !== null && typeof target.closest === 'function' && target.closest(FLOATING_POPUP_SELECTOR)) return
    setMode('compact')
  }

  function onFocusIn(event) {
    if (!active || event.target === null) return
    // Electron <webview> guests and same-origin iframes do not deliver pointer
    // events to this document, but focus moving into either one still reaches
    // the embedder (focusin on the carrier element). Treat that as "clicked the
    // page" so the messages collapse like a normal outside press.
    var target = event.target
    if (typeof target.closest === 'function' && target.closest('webview, iframe, [data-dsh-nudge-webview]')) {
      setMode('compact')
      return
    }
    // Focusing the composer opens the history in every mode, including
    // annotate: the dock is only forced compact when the mode turns on.
    if (active.content.contains(target)) setMode('expanded')
  }

  function onResize() {
    if (active) measure()
    refreshAnnotationBar()
  }

  doc.addEventListener('pointerdown', onPointerDown, true)
  doc.addEventListener('focusin', onFocusIn, true)
  win.addEventListener('resize', onResize)
  try {
    unsubscribeConfig = subscribePluginConfig(function () {
      schedule()
    })
  } catch (error) {
    unsubscribeConfig = null
  }

  var controller = {
    refresh: function () {
      retries = floatingRequest.active ? 120 : 0
      schedule()
    },
    applyAnnotateState: function () {
      if (!active) return
      applyAnnotateState(active.chat)
      applyAnnotateLayout()
    },
    /** Re-apply the host annotation bar state (visible / count / labels / pos). */
    refreshAnnotationBar: function () {
      refreshAnnotationBar()
    },
    relabel: function () {
      if (!active) return
      if (active.collapseButton) {
        active.collapseButton.setAttribute('aria-label', floatingLabels.collapse)
        active.collapseButton.setAttribute('title', floatingLabels.collapse)
      }
      if (active.floatButton) {
        active.floatButton.setAttribute('aria-label', floatingLabels.expand)
        active.floatButton.setAttribute('title', floatingLabels.expand)
      }
    },
    dispose: function () {
      if (disposed) return
      disposed = true
      retries = 0
      if (frameHandle !== null) {
        try {
          if (typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(frameHandle)
          else win.clearTimeout(frameHandle)
        } catch (error) {
          /* no pending frame */
        }
        frameHandle = null
      }
      doc.removeEventListener('pointerdown', onPointerDown, true)
      doc.removeEventListener('focusin', onFocusIn, true)
      win.removeEventListener('resize', onResize)
      try {
        if (annotationBarMedia && typeof annotationBarMedia.removeEventListener === 'function') {
          annotationBarMedia.removeEventListener('change', onAnnotationBarSchemeChange)
        }
      } catch (error) {
        /* the media query outlives this install harmlessly */
      }
      annotationBarMedia = null
      if (typeof unsubscribeConfig === 'function') unsubscribeConfig()
      unsubscribeConfig = null
      deactivate()
      if (floatingController === controller) floatingController = null
    },
  }
  floatingController = controller
  // The plugin may reload after a Nudge tab has already entered fullscreen; an
  // install must adopt an outstanding request instead of waiting for the next
  // presentation change.
  if (floatingRequest.active) controller.refresh()

  return function () {
    controller.dispose()
  }
}

/**
 * Publish one Nudge tab's presentation. NudgeBody calls this from an effect
 * whenever `sidebar.fullscreen` / `tab.visible` / `panel.isFloating` change;
 * the installer re-locates the chat and keeps the marker in step. `owner` is
 * the tab id, so hiding one tab never withdraws another tab's request.
 */
function setFloatingComposerRequest(owner, sessionId, active) {
  var key = typeof owner === 'string' && owner !== '' ? owner : 'nudge-standalone'
  var nextSession = typeof sessionId === 'string' ? sessionId : ''
  if (active === true) {
    floatingOwnerTick += 1
    floatingOwners[key] = { sessionId: nextSession, at: floatingOwnerTick }
  } else {
    delete floatingOwners[key]
  }
  var nextActive = false
  var nextActiveSession = ''
  var newest = -1
  var owners = Object.keys(floatingOwners)
  for (var index = 0; index < owners.length; index += 1) {
    var entry = floatingOwners[owners[index]]
    if (entry === null || entry === undefined || entry.at <= newest) continue
    newest = entry.at
    nextActive = true
    nextActiveSession = entry.sessionId
  }
  if (floatingRequest.active === nextActive && floatingRequest.sessionId === nextActiveSession) return
  floatingRequest = { active: nextActive, sessionId: nextActiveSession }
  if (floatingController !== null) floatingController.refresh()
}

/**
 * Publish whether one Nudge tab is in a mode that shows the page runtime's
 * bottom annotation bar. Multiple tabs are supported like the presentation
 * request: any annotating owner lifts the dock.
 */
function setFloatingComposerAnnotating(owner, active) {
  var key = typeof owner === 'string' && owner !== '' ? owner : 'nudge-standalone'
  if (active === true) floatingAnnotateOwners[key] = true
  else delete floatingAnnotateOwners[key]
  var next = Object.keys(floatingAnnotateOwners).length > 0
  if (next === floatingAnnotating) return
  floatingAnnotating = next
  if (floatingController !== null) floatingController.applyAnnotateState()
}

/** Localised control labels, published by NudgeBody from the plugin locale. */
function setFloatingComposerLabels(labels) {
  var next = Object.assign({}, FLOATING_DEFAULT_LABELS)
  if (labels && typeof labels === 'object') {
    if (typeof labels.collapse === 'string' && labels.collapse !== '') next.collapse = labels.collapse
    if (typeof labels.expand === 'string' && labels.expand !== '') next.expand = labels.expand
  }
  floatingLabels = next
  if (floatingController !== null) floatingController.relabel()
}
