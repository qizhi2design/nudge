import * as React from 'react'
import { ShortcutKeys, type ShortcutBinding, type ShortcutPlatform } from './kbd'

/**
 * Hover tooltip rendered in the host document without a popper library.
 *
 * The DSH shell runs the Web client inside an Electron renderer whose layout
 * does not behave like a plain page: a portalled Radix popper can stay at its
 * pre-measurement transform (`translate(0, -200%)`) and therefore render
 * off-screen. This tooltip measures the trigger once on hover and paints a
 * fixed card above the toolbar, where it always covers host chrome rather than
 * the embedded guest page.
 */

interface TooltipModel {
  key: number
  anchor: { left: number; top: number; width: number; height: number }
  label: string
  content?: React.ReactNode
  shortcut?: ShortcutBinding | null
  platform: ShortcutPlatform
}

interface TooltipController {
  open: (model: Omit<TooltipModel, 'key'>) => void
  scheduleClose: () => void
  cancelClose: () => void
}

const TooltipContext = React.createContext<TooltipController | null>(null)

/** The subset of the host palette the tooltip surface needs. */
export interface TooltipTheme {
  layer2: string
  overlay?: string
  text: string
  border: string
  borderStrong?: string
  isDark: boolean
}

const CARD_MAX_WIDTH = 320
const CARD_GAP = 8

export function TooltipProvider({ theme, children }: { theme: TooltipTheme; children: React.ReactNode }) {
  const [model, setModel] = React.useState<TooltipModel | null>(null)
  const [cardHeight, setCardHeight] = React.useState(0)
  const cardRef = React.useRef<HTMLSpanElement | null>(null)
  const timer = React.useRef<number | null>(null)
  const keyRef = React.useRef(0)

  const cancelClose = React.useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const open = React.useCallback(
    (next: Omit<TooltipModel, 'key'>) => {
      cancelClose()
      keyRef.current += 1
      setModel({ ...next, key: keyRef.current })
    },
    [cancelClose],
  )

  const scheduleClose = React.useCallback(() => {
    cancelClose()
    timer.current = window.setTimeout(() => {
      timer.current = null
      setModel(null)
    }, 80)
  }, [cancelClose])

  React.useEffect(() => {
    if (model === null) return undefined
    function dismiss() {
      setModel(null)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [model])

  React.useEffect(() => cancelClose, [cancelClose])

  React.useLayoutEffect(() => {
    if (cardRef.current !== null) setCardHeight(cardRef.current.offsetHeight)
  }, [model])

  const fitAbove = model !== null && cardHeight > 0 && model.anchor.top - CARD_GAP - cardHeight >= 8
  const card =
    model === null || typeof window === 'undefined' ? null : (
      <span
        ref={cardRef}
        data-tooltip-card=""
        role="tooltip"
        data-tooltip-placement={fitAbove ? 'above' : 'top-clamped'}
        style={{
          position: 'fixed',
          left: Math.min(Math.max(model.anchor.left + model.anchor.width / 2, CARD_MAX_WIDTH / 2 + CARD_GAP), window.innerWidth - CARD_MAX_WIDTH / 2 - CARD_GAP),
          top: fitAbove ? model.anchor.top - CARD_GAP : 8,
          transform: fitAbove ? 'translate(-50%, -100%)' : 'translateX(-50%)',
          maxHeight: 220,
          overflowY: 'auto',
          zIndex: 2147483000,
          boxSizing: 'border-box',
          maxWidth: `min(${CARD_MAX_WIDTH}px, calc(100vw - 16px))`,
          padding: '7px 10px',
          borderRadius: 8,
          border: '1px solid ' + (theme.borderStrong || theme.border),
          // Follow the host palette. The shipped tooltip token is a fixed dark
          // bubble in both themes; Nudge's hint should read as host chrome.
          background: theme.isDark
            ? 'var(--dsw-alias-tooltip-bg, ' + (theme.overlay || theme.layer2) + ')'
            : 'var(--dsw-alias-bg-overlay, ' + (theme.overlay || theme.layer2) + ')',
          color: theme.text,
          boxShadow: theme.isDark ? '0 8px 24px rgba(0,0,0,.45)' : '0 6px 20px rgba(20,30,50,.16)',
          font: 'inherit',
          fontSize: 11,
          lineHeight: 1.45,
          textAlign: 'left',
          pointerEvents: 'none',
          whiteSpace: 'normal',
        }}
      >
        {model.content !== undefined ? model.content : <span style={{ display: 'block' }}>{model.label}</span>}
        {model.shortcut ? (
          <span
            data-tooltip-shortcut=""
            style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5, opacity: 0.9 }}
          >
            <ShortcutKeys binding={model.shortcut} platform={model.platform} size={18} />
          </span>
        ) : null}
      </span>
    )

  const controller = React.useMemo<TooltipController>(
    () => ({ open, scheduleClose, cancelClose }),
    [open, scheduleClose, cancelClose],
  )

  return (
    <TooltipContext.Provider value={controller}>
      {children}
      {card}
    </TooltipContext.Provider>
  )
}

function mergeHandler(original: ((event: any) => void) | undefined, next: (event: any) => void) {
  return (event: any) => {
    if (typeof original === 'function') original(event)
    next(event)
  }
}

export function Tooltip({
  label,
  content,
  shortcut,
  platform = 'linux',
  children,
}: {
  label: string
  /** Rich body (for example the interaction hint) rendered instead of `label`. */
  content?: React.ReactNode
  /** Effective binding rendered under the label with Lucide keycaps. */
  shortcut?: ShortcutBinding | null
  platform?: ShortcutPlatform
  children: React.ReactNode
}) {
  const controller = React.useContext(TooltipContext)
  const child = React.isValidElement(children) ? children : null
  if (controller === null || child === null) {
    return <>{children}</>
  }
  const originalProps = (child.props || {}) as Record<string, any>
  const triggerProps: Record<string, any> = {
    onMouseEnter: mergeHandler(originalProps.onMouseEnter, (event: React.MouseEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      controller.open({
        anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        label,
        content,
        shortcut,
        platform,
      })
    }),
    onMouseLeave: mergeHandler(originalProps.onMouseLeave, () => controller.scheduleClose()),
    onFocus: mergeHandler(originalProps.onFocus, (event: React.FocusEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      controller.open({
        anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        label,
        content,
        shortcut,
        platform,
      })
    }),
    onBlur: mergeHandler(originalProps.onBlur, () => controller.scheduleClose()),
  }
  return React.cloneElement(child, triggerProps)
}
