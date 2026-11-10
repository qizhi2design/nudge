import * as React from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  GitBranch,
  Globe2,
  Keyboard,
  ListTree,
  MessageSquarePlus,
  Redo2,
  RefreshCw,
  RotateCw,
  SlidersHorizontal,
  Undo2,
} from 'lucide-react'
import { Button } from './components/button'
import { Tooltip, TooltipProvider } from './components/tooltip'
import { type ShortcutBinding, type ShortcutPlatform } from './components/kbd'
import {
  ModeHintContent,
  ShortcutSheet,
  type ModeHotkeyMap,
  type ShortcutSheetRow,
} from './components/shortcut-sheet'
import { toolbarLayout, type ToolbarLayout } from './layout'

export type InspectorMode = 'browse' | 'annotate' | 'edit'

export interface InspectorTheme {
  brand: string
  base: string
  layer1: string
  layer2: string
  layer3?: string
  overlay?: string
  border: string
  borderStrong?: string
  hover?: string
  accent?: string
  onBrand?: string
  text: string
  muted: string
  faint?: string
  danger: string
  success: string
  warn?: string
  isDark: boolean
}

export interface InspectorTab {
  url: string
  canGoBack: boolean
  canGoForward: boolean
  mode: InspectorMode
}

export interface InspectorToolbarProps {
  t: (key: string, vars?: Record<string, string>) => string
  theme: InspectorTheme
  tab: InspectorTab
  carrierKind?: string
  /** Page-local single-key hotkeys (physical codes) from plugin settings. */
  hotkeys: ModeHotkeyMap
  canUndo: boolean
  canRedo: boolean
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onNavigate: (url: string) => boolean
  onMode: (mode: InspectorMode) => void
  onUndo: () => void
  onRedo: () => void
  onExternal: () => void
  domOpen?: boolean
  onToggleDom?: () => void
  workspaceOpen?: boolean
  onToggleWorkspace?: () => void
  hotReload?: boolean
  reloadPending?: boolean
  onToggleHotReload?: () => void
  /**
   * Effective shortcut bindings (from the DSH shortcut catalog) so tooltips,
   * the shortcut sheet and the mode hint show what the system will dispatch.
   */
  shortcuts?: {
    platform: ShortcutPlatform
    bindings: Record<string, ShortcutBinding | null>
    rows: ShortcutSheetRow[]
  }
  features?: {
    annotate?: boolean
    edit?: boolean
    domTree?: boolean
    workspaceVersions?: boolean
    hotReload?: boolean
  }
}

const INITIAL_LAYOUT: ToolbarLayout = { compact: false, tiny: false, panelLabels: true }

function hoverBackground(theme: InspectorTheme) {
  return 'var(--dsw-alias-interactive-bg-hover, ' + (theme.hover || theme.layer2) + ')'
}

function toolBorder(theme: InspectorTheme) {
  return 'var(--dsw-alias-border-l2, ' + (theme.borderStrong || theme.border) + ')'
}

function hairlineBorder(theme: InspectorTheme) {
  return '.5px solid ' + toolBorder(theme)
}

function Divider({ theme }: { theme: InspectorTheme }) {
  return (
    <span
      className="dshnudge-h-[16px] dshnudge-w-px dshnudge-flex-none"
      style={{ background: toolBorder(theme), margin: '0 4px' }}
    />
  )
}

function useHover() {
  const [hover, setHover] = React.useState(false)
  return {
    hover,
    bind: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
    },
  }
}

function IconAction({
  label,
  disabled,
  active,
  theme,
  shortcut,
  shortcutPlatform,
  ariaExpanded,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  active?: boolean
  theme: InspectorTheme
  shortcut?: ShortcutBinding | null
  shortcutPlatform?: ShortcutPlatform
  ariaExpanded?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  const state = useHover()
  return (
    <Tooltip label={label} shortcut={shortcut} platform={shortcutPlatform}>
      <Button
        aria-label={label}
        aria-expanded={ariaExpanded}
        disabled={disabled}
        onClick={onClick}
        variant={active ? 'active' : 'ghost'}
        {...state.bind}
        style={{
          color: disabled ? theme.muted : active ? theme.text : theme.muted,
          background: active ? (theme.hover || theme.layer2) : state.hover && !disabled ? hoverBackground(theme) : 'transparent',
          borderColor: active ? toolBorder(theme) : 'transparent',
        }}
      >
        {children}
      </Button>
    </Tooltip>
  )
}

/** Reload keeps a warn-colored corner dot when a hot update is waiting. */
function ReloadAction({
  theme,
  label,
  disabled,
  pending,
  shortcut,
  shortcutPlatform,
  onClick,
}: {
  theme: InspectorTheme
  label: string
  disabled?: boolean
  pending?: boolean
  shortcut?: ShortcutBinding | null
  shortcutPlatform?: ShortcutPlatform
  onClick: () => void
}) {
  const accent = theme.warn || theme.brand
  const state = useHover()
  return (
    <Tooltip label={label} shortcut={shortcut} platform={shortcutPlatform}>
      <Button
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        variant="ghost"
        data-hot-reload-pending={pending === true ? 'true' : undefined}
        {...state.bind}
        style={{
          color: pending === true ? accent : theme.muted,
          background:
            pending === true
              ? `color-mix(in srgb, ${accent} 14%, transparent)`
              : state.hover && !disabled
                ? hoverBackground(theme)
                : 'transparent',
          borderColor: 'transparent',
        }}
      >
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <RotateCw size={14} />
          {pending === true ? (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                right: -4,
                top: -3,
                width: 6,
                height: 6,
                borderRadius: 3,
                background: accent,
                boxShadow: `0 0 0 1.5px ${theme.base}`,
              }}
            />
          ) : null}
        </span>
      </Button>
    </Tooltip>
  )
}

function colorMix(color: string, percent: number) {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

export interface HotReloadVisual {
  /** Selected pill surface, border and ink for the current state. */
  background: string
  border: string
  color: string
}

/**
 * Pure selected / unselected / pending palette for the auto-reload toggle.
 * Exported so the engineering test can assert that each state is visually
 * distinct rather than only asserting markup.
 */
export function hotReloadVisual(theme: InspectorTheme, active: boolean, pending: boolean): HotReloadVisual {
  const accent = theme.accent || theme.brand
  const warn = theme.warn || theme.brand
  if (pending) {
    return {
      background: colorMix(warn, 16),
      border: colorMix(warn, 40),
      color: warn,
    }
  }
  if (active) {
    return {
      background: colorMix(accent, 12),
      border: colorMix(accent, 36),
      color: accent,
    }
  }
  return {
    background: 'transparent',
    border: toolBorder(theme),
    color: theme.muted,
  }
}

/**
 * Auto-reload is a selected/unselected toggle like 标注 / 编辑, not an icon that
 * happens to toggle: a labeled pill carries the state, and a click flashes
 * 「已开启 / 已关闭」 so both directions give feedback. The selected tint keeps
 * showing when the toolbar collapses to icons; only the label is dropped.
 */
function HotReloadToggle({
  theme,
  title,
  label,
  onText,
  offText,
  pendingText,
  active,
  pending,
  compact,
  shortcut,
  shortcutPlatform,
  onClick,
}: {
  theme: InspectorTheme
  title: string
  label: string
  onText: string
  offText: string
  pendingText: string
  active: boolean
  pending: boolean
  compact: boolean
  shortcut?: ShortcutBinding | null
  shortcutPlatform?: ShortcutPlatform
  onClick: () => void
}) {
  const visual = hotReloadVisual(theme, active, pending)
  const [hover, setHover] = React.useState(false)
  const [pressed, setPressed] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const [flash, setFlash] = React.useState<'on' | 'off' | null>(null)

  React.useEffect(() => {
    if (flash === null) return undefined
    const timer = window.setTimeout(() => setFlash(null), 1400)
    return () => window.clearTimeout(timer)
  }, [flash])

  const accent = pending ? theme.warn || theme.brand : theme.accent || theme.brand
  const surface = hover && !pressed ? colorMix(accent, pending ? 20 : active ? 18 : 8) : visual.background
  const border = hover || focused ? colorMix(accent, pending ? 46 : active ? 44 : 26) : visual.border
  const text = flash === 'on' ? onText : flash === 'off' ? offText : pending ? pendingText : label
  // Reserve the label's resting width so the transient 「已开启 / 已关闭」 text
  // never shifts the rest of the toolbar; measure per locale instead of
  // hard-coding a CJK width (English labels are longer).
  const labelWidth = Math.max(46, label.length * 7)

  return (
    <Tooltip label={title} shortcut={shortcut} platform={shortcutPlatform}>
      <Button
        aria-label={title}
        aria-pressed={active}
        data-hot-reload-toggle=""
        data-hot-reload-state={active ? 'on' : 'off'}
        data-hot-reload-pending={pending ? 'true' : undefined}
        data-hot-reload-flash={flash === null ? undefined : flash}
        className={pending ? 'dshnudge-hot-reload-pending' : undefined}
        onClick={() => {
          setFlash(active ? 'off' : 'on')
          onClick()
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => {
          setHover(false)
          setPressed(false)
        }}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        variant="ghost"
        size="sm"
        style={{
          color: visual.color,
          background: surface,
          borderColor: border,
          padding: compact ? '0 6px' : '0 8px',
          gap: compact ? 4 : 6,
          transform: pressed ? 'scale(0.97)' : 'none',
          boxShadow: focused ? `0 0 0 2px ${colorMix(accent, 30)}` : 'none',
          transition:
            'background-color 150ms cubic-bezier(.23,1,.32,1), border-color 150ms cubic-bezier(.23,1,.32,1), color 150ms cubic-bezier(.23,1,.32,1), box-shadow 150ms cubic-bezier(.23,1,.32,1), transform 120ms cubic-bezier(.23,1,.32,1)',
        }}
      >
        <RefreshCw size={13} />
        {compact ? null : (
          <span
            aria-live="polite"
            style={{
              display: 'inline-block',
              minWidth: labelWidth,
              fontSize: 11.5,
              fontWeight: 600,
              lineHeight: 1,
              textAlign: 'center',
              color: visual.color,
            }}
          >
            {text}
          </span>
        )}
      </Button>
    </Tooltip>
  )
}

/** DOM / workspace entries: icon-only on narrow panes, icon + label when roomy. */
function PanelToggle({
  active,
  label,
  title,
  theme,
  icon,
  showLabel,
  shortcut,
  shortcutPlatform,
  onClick,
}: {
  active?: boolean
  label: string
  title: string
  theme: InspectorTheme
  icon: React.ReactNode
  showLabel: boolean
  shortcut?: ShortcutBinding | null
  shortcutPlatform?: ShortcutPlatform
  onClick: () => void
}) {
  const state = useHover()
  return (
    <Tooltip label={title} shortcut={shortcut} platform={shortcutPlatform}>
      <Button
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        variant={active ? 'active' : 'ghost'}
        {...state.bind}
        style={{
          color: active ? theme.text : theme.muted,
          background: active ? (theme.hover || theme.layer2) : state.hover ? hoverBackground(theme) : 'transparent',
          borderColor: active ? toolBorder(theme) : 'transparent',
          // Button's icon size class (dshnudge-w-7) is a CSS class, so a labeled
          // button must override it with an explicit width instead of undefined.
          width: showLabel ? 'auto' : 28,
          padding: showLabel ? '0 8px' : 0,
        }}
      >
        {icon}
        {showLabel ? (
          <span style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1 }}>{label}</span>
        ) : null}
      </Button>
    </Tooltip>
  )
}

function ModeToggle({
  active,
  label,
  title,
  theme,
  icon,
  compact,
  content,
  onClick,
}: {
  active: boolean
  label: string
  title: string
  theme: InspectorTheme
  icon: React.ReactNode
  compact: boolean
  content?: React.ReactNode
  onClick: () => void
}) {
  const state = useHover()
  return (
    <Tooltip label={title} content={content}>
      <Button
        aria-pressed={active}
        aria-label={label}
        title={title}
        size="sm"
        onClick={onClick}
        {...state.bind}
        style={{
          color: active ? theme.brand : theme.muted,
          borderColor: active
            ? `color-mix(in srgb, ${theme.brand} 34%, transparent)`
            : toolBorder(theme),
          background: active
            ? `color-mix(in srgb, ${theme.brand} 13%, transparent)`
            : state.hover
              ? hoverBackground(theme)
              : 'transparent',
        }}
      >
        {icon}
        {compact ? null : <span>{label}</span>}
      </Button>
    </Tooltip>
  )
}

export function InspectorToolbar({
  t,
  theme,
  tab,
  carrierKind,
  hotkeys,
  canUndo,
  canRedo,
  onBack,
  onForward,
  onReload,
  onNavigate,
  onMode,
  onUndo,
  onRedo,
  onExternal,
  domOpen,
  onToggleDom,
  workspaceOpen,
  onToggleWorkspace,
  hotReload,
  reloadPending,
  onToggleHotReload,
  shortcuts,
  features,
}: InspectorToolbarProps) {
  const enabled = features || {}
  const [draft, setDraft] = React.useState<string | null>(null)
  const [layout, setLayout] = React.useState<ToolbarLayout>(INITIAL_LAYOUT)
  const [addressFocused, setAddressFocused] = React.useState(false)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const shortcutPlatform: ShortcutPlatform = shortcuts ? shortcuts.platform : 'linux'
  const shortcutFor = React.useCallback(
    (id: string): ShortcutBinding | null => (shortcuts && shortcuts.bindings ? shortcuts.bindings[id] ?? null : null),
    [shortcuts],
  )
  const rootRef = React.useRef<HTMLDivElement>(null)
  const addressRef = React.useRef<HTMLInputElement>(null)
  const shownUrl = draft !== null ? draft : tab.url || ''
  const hotReloadOn = hotReload !== false
  const pending = reloadPending === true && hotReloadOn
  const hotReloadTitle = pending ? t('hotReload.titlePending') : hotReloadOn ? t('hotReload.titleOn') : t('hotReload.titleOff')
  const annotateEnabled = enabled.annotate !== false
  const editEnabled = enabled.edit !== false
  const domEnabled = enabled.domTree !== false
  const workspaceEnabled = enabled.workspaceVersions !== false
  const hotReloadEnabled = enabled.hotReload !== false
  const modesEnabled = annotateEnabled || editEnabled
  const panelsEnabled = domEnabled || workspaceEnabled || hotReloadEnabled

  React.useEffect(() => {
    if (!sheetOpen) return undefined
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setSheetOpen(false)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [sheetOpen])

  React.useEffect(() => {
    const node = rootRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? node.clientWidth
      const next = toolbarLayout(width)
      setLayout((previous) =>
        previous.compact === next.compact && previous.tiny === next.tiny && previous.panelLabels === next.panelLabels
          ? previous
          : next,
      )
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (onNavigate(shownUrl)) setDraft(null)
  }

  function toggleMode(mode: Exclude<InspectorMode, 'browse'>) {
    onMode(tab.mode === mode ? 'browse' : mode)
  }

  const gap = layout.compact ? 4 : 6
  const padding = layout.compact ? '0 6px' : '0 8px'

  /** Row 2, always visible: the Nudge action bar under the native-browser row. */
  const actionRow = (
    <div
      data-toolbar-secondary=""
      style={{
        display: 'flex',
        height: 34,
        flex: 'none',
        alignItems: 'center',
        gap: 2,
        padding: '0 6px',
        boxSizing: 'border-box',
        borderTop: hairlineBorder(theme),
        background: theme.base,
        minWidth: 0,
        overflowX: 'auto',
      }}
    >
      {annotateEnabled ? (
        <ModeToggle
          active={tab.mode === 'annotate'}
          label={t('toolbar.annotate')}
          title={t('mode.annotateHint')}
          theme={theme}
          icon={<MessageSquarePlus size={13} />}
          compact={layout.compact}
          content={
            <ModeHintContent
              t={t}
              mode="annotate"
              platform={shortcutPlatform}
              binding={shortcutFor('nudge.annotate.toggle')}
            />
          }
          onClick={() => toggleMode('annotate')}
        />
      ) : null}
      {editEnabled ? (
        <ModeToggle
          active={tab.mode === 'edit'}
          label={t('toolbar.edit')}
          title={t('mode.editHint')}
          theme={theme}
          icon={<SlidersHorizontal size={13} />}
          compact={layout.compact}
          content={
            <ModeHintContent
              t={t}
              mode="edit"
              platform={shortcutPlatform}
              binding={shortcutFor('nudge.edit.toggle')}
            />
          }
          onClick={() => toggleMode('edit')}
        />
      ) : null}
      {modesEnabled && panelsEnabled ? <Divider theme={theme} /> : null}
      {domEnabled ? (
        <PanelToggle
          theme={theme}
          label={t('toolbar.dom')}
          title={t('toolbar.dom')}
          active={domOpen === true}
          showLabel={layout.panelLabels}
          shortcut={shortcutFor('nudge.dom.toggle')}
          shortcutPlatform={shortcutPlatform}
          onClick={() => onToggleDom && onToggleDom()}
          icon={<ListTree size={14} />}
        />
      ) : null}
      {workspaceEnabled ? (
        <PanelToggle
          theme={theme}
          label={t('workspace.open')}
          title={t('workspace.open')}
          active={workspaceOpen === true}
          showLabel={layout.panelLabels}
          shortcut={shortcutFor('nudge.workspace.toggle')}
          shortcutPlatform={shortcutPlatform}
          onClick={() => onToggleWorkspace && onToggleWorkspace()}
          icon={<GitBranch size={14} />}
        />
      ) : null}
      {hotReloadEnabled ? (
        <HotReloadToggle
          theme={theme}
          title={hotReloadTitle}
          label={t('hotReload.label')}
          onText={t('hotReload.on')}
          offText={t('hotReload.off')}
          pendingText={t('hotReload.pendingShort')}
          active={hotReloadOn}
          pending={pending}
          compact={layout.compact}
          onClick={() => onToggleHotReload && onToggleHotReload()}
        />
      ) : null}
      {/* Wide panes balance the row: view/panel switches stay on the left,
          history + external + shortcut help anchor the right edge. Narrow
          panes keep every control visible (the row scrolls horizontally). */}
      <span style={{ flex: '1 1 auto', minWidth: 4 }} />
      <Divider theme={theme} />
      <IconAction theme={theme} label={t('toolbar.undo')} disabled={!canUndo} onClick={onUndo}>
        <Undo2 size={14} />
      </IconAction>
      <IconAction theme={theme} label={t('toolbar.redo')} disabled={!canRedo} onClick={onRedo}>
        <Redo2 size={14} />
      </IconAction>
      {carrierKind === 'webview' ? (
        <>
          <Divider theme={theme} />
          <IconAction theme={theme} label={t('toolbar.external')} disabled={!tab.url} onClick={onExternal}>
            <ArrowUpRight size={14} />
          </IconAction>
        </>
      ) : null}
      <IconAction
        theme={theme}
        label={t('shortcut.help')}
        active={sheetOpen}
        ariaExpanded={sheetOpen}
        onClick={() => setSheetOpen(!sheetOpen)}
      >
        <Keyboard size={14} />
      </IconAction>
    </div>
  )

  const shortcutSheet = sheetOpen && shortcuts ? (
    <ShortcutSheet
      t={t}
      theme={theme}
      platform={shortcuts.platform}
      rows={shortcuts.rows}
    />
  ) : null

  return (
    <TooltipProvider theme={theme}>
      <div
        ref={rootRef}
        className="dshnudge-flex dshnudge-flex-none dshnudge-flex-col"
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 'none',
          boxSizing: 'border-box',
          background: theme.base,
          borderBottom: hairlineBorder(theme),
          minWidth: 0,
        }}
      >
        <div
          data-toolbar-primary=""
          style={{
            display: 'flex',
            height: 38,
            flex: 'none',
            alignItems: 'center',
            gap,
            padding,
            boxSizing: 'border-box',
            minWidth: 0,
          }}
        >
          <IconAction theme={theme} label={t('toolbar.back')} disabled={!tab.canGoBack} onClick={onBack}>
            <ArrowLeft size={14} />
          </IconAction>
          {layout.tiny ? null : (
            <IconAction theme={theme} label={t('toolbar.forward')} disabled={!tab.canGoForward} onClick={onForward}>
              <ArrowRight size={14} />
            </IconAction>
          )}
          <ReloadAction
            theme={theme}
            label={t('toolbar.reload')}
            disabled={!tab.url}
            pending={pending}
            shortcut={shortcutFor('page.refresh')}
            shortcutPlatform={shortcutPlatform}
            onClick={onReload}
          />
          <form
            onSubmit={submit}
            className="dshnudge-flex dshnudge-flex-1 dshnudge-items-center dshnudge-gap-1"
            style={{
              display: 'flex',
              minWidth: layout.tiny ? 72 : 120,
              flex: '1 1 auto',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <div
              className="dshnudge-relative dshnudge-min-w-0 dshnudge-flex-1"
              style={{ position: 'relative', minWidth: 0, flex: '1 1 auto' }}
            >
              <Globe2
                size={13}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: theme.muted,
                  pointerEvents: 'none',
                  display: 'block',
                }}
              />
              <input
                ref={addressRef}
                type="text"
                value={shownUrl}
                spellCheck={false}
                aria-label={t('toolbar.addressPlaceholder')}
                placeholder={t('toolbar.addressPlaceholder')}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onFocus={(event) => {
                  setAddressFocused(true)
                  event.currentTarget.select()
                }}
                onBlur={() => setAddressFocused(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setDraft(null)
                    event.currentTarget.blur()
                  }
                }}
                className="dshnudge-h-7 dshnudge-w-full dshnudge-rounded-md dshnudge-border dshnudge-border-solid dshnudge-pl-7 dshnudge-pr-2 dshnudge-text-[12px] dshnudge-outline-none"
                style={{
                  width: '100%',
                  height: 28,
                  boxSizing: 'border-box',
                  paddingLeft: 28,
                  paddingRight: 8,
                  borderRadius: 'var(--dsw-radius-sm, 8px)',
                  borderWidth: '.5px',
                  borderStyle: 'solid',
                  borderColor: toolBorder(theme),
                  color: theme.text,
                  background: theme.layer1,
                  fontFamily: 'inherit',
                  fontSize: 12,
                  lineHeight: '26px',
                  outline: addressFocused
                    ? '1px solid var(--dsw-alias-state-business-primary, ' + (theme.accent || theme.brand) + ')'
                    : 'none',
                  outlineOffset: '-1px',
                }}
              />
            </div>
            {layout.tiny ? null : (
              <IconAction theme={theme} label={t('toolbar.go')} onClick={() => onNavigate(shownUrl)}>
                <ArrowRight size={14} />
              </IconAction>
            )}
          </form>
        </div>
        {actionRow}
        {shortcutSheet}
      </div>
    </TooltipProvider>
  )
}
