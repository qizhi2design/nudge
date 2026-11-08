import * as React from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  GitBranch,
  Globe2,
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
  features?: {
    annotate?: boolean
    edit?: boolean
    domTree?: boolean
    workspaceVersions?: boolean
    hotReload?: boolean
  }
}

const WIDE_LAYOUT: ToolbarLayout = { compact: false, narrow: false, tiny: false }

function Divider({ theme }: { theme: InspectorTheme }) {
  return (
    <span
      className="dshnudge-h-[18px] dshnudge-w-px dshnudge-flex-none"
      style={{ background: theme.borderStrong || theme.border, margin: '0 2px' }}
    />
  )
}

function IconAction({
  label,
  disabled,
  active,
  theme,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  active?: boolean
  theme: InspectorTheme
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip label={label}>
      <Button
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        variant={active ? 'active' : 'ghost'}
        style={{
          color: disabled ? theme.muted : active ? theme.text : theme.muted,
          background: active ? (theme.hover || theme.layer2) : 'transparent',
          borderColor: active ? (theme.borderStrong || theme.border) : 'transparent',
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
  onClick,
}: {
  theme: InspectorTheme
  label: string
  disabled?: boolean
  pending?: boolean
  onClick: () => void
}) {
  const accent = theme.warn || theme.brand
  return (
    <Tooltip label={label}>
      <Button
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        variant="ghost"
        data-hot-reload-pending={pending === true ? 'true' : undefined}
        style={{
          color: pending === true ? accent : theme.muted,
          background: pending === true ? `color-mix(in srgb, ${accent} 14%, transparent)` : 'transparent',
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

/** Auto-reload toggle with the same pending affordance in both toolbar tiers. */
function HotReloadAction({
  theme,
  title,
  active,
  pending,
  onClick,
}: {
  theme: InspectorTheme
  title: string
  active: boolean
  pending: boolean
  onClick: () => void
}) {
  const accent = pending ? (theme.warn || theme.brand) : theme.brand
  return (
    <Tooltip label={title}>
      <Button
        aria-label={title}
        aria-pressed={active}
        data-hot-reload-pending={pending ? 'true' : undefined}
        onClick={onClick}
        variant="ghost"
        style={{
          color: pending ? (theme.warn || theme.brand) : active ? theme.text : theme.muted,
          background: pending ? `color-mix(in srgb, ${accent} 16%, transparent)` : 'transparent',
          borderColor: pending ? `color-mix(in srgb, ${accent} 34%, transparent)` : 'transparent',
        }}
      >
        <RefreshCw size={14} />
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
  onClick,
}: {
  active: boolean
  label: string
  title: string
  theme: InspectorTheme
  icon: React.ReactNode
  compact: boolean
  onClick: () => void
}) {
  return (
    <Tooltip label={title}>
      <Button
        aria-pressed={active}
        title={title}
        size="sm"
        onClick={onClick}
        style={{
          color: active ? theme.brand : theme.muted,
          borderColor: active
            ? `color-mix(in srgb, ${theme.brand} 34%, transparent)`
            : (theme.borderStrong || theme.border),
          background: active
            ? `color-mix(in srgb, ${theme.brand} 13%, transparent)`
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
  features,
}: InspectorToolbarProps) {
  const enabled = features || {}
  const [draft, setDraft] = React.useState<string | null>(null)
  const [layout, setLayout] = React.useState<ToolbarLayout>(WIDE_LAYOUT)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const addressRef = React.useRef<HTMLInputElement>(null)
  const shownUrl = draft !== null ? draft : tab.url || ''
  const hotReloadOn = hotReload !== false
  const hotReloadTitle =
    reloadPending === true ? t('hotReload.titlePending') : hotReloadOn ? t('hotReload.titleOn') : t('hotReload.titleOff')
  const pending = reloadPending === true
  const annotateEnabled = enabled.annotate !== false
  const editEnabled = enabled.edit !== false
  const domEnabled = enabled.domTree !== false
  const workspaceEnabled = enabled.workspaceVersions !== false
  const hotReloadEnabled = enabled.hotReload !== false
  const modesEnabled = annotateEnabled || editEnabled
  const panelsEnabled = domEnabled || workspaceEnabled || hotReloadEnabled

  React.useEffect(() => {
    const node = rootRef.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? node.clientWidth
      const next = toolbarLayout(width)
      setLayout((previous) =>
        previous.compact === next.compact && previous.narrow === next.narrow && previous.tiny === next.tiny
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

  /** Row 2 of the narrow tier: modes + panels/hot-reload + history + external. */
  const toolRow = (
    <div
      data-toolbar-secondary=""
      style={{
        display: 'flex',
        height: 34,
        flex: 'none',
        alignItems: 'center',
        gap: 2,
        padding: '0 8px',
        boxSizing: 'border-box',
        borderTop: `1px solid ${theme.borderStrong || theme.border}`,
        background: theme.layer1,
        minWidth: 0,
      }}
    >
      {annotateEnabled ? (
        <ModeToggle
          active={tab.mode === 'annotate'}
          label={t('toolbar.annotate')}
          title={t('mode.annotateHint')}
          theme={theme}
          icon={<MessageSquarePlus size={13} />}
          compact
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
          compact
          onClick={() => toggleMode('edit')}
        />
      ) : null}
      {modesEnabled && panelsEnabled ? <Divider theme={theme} /> : null}
      {domEnabled ? (
        <IconAction
          theme={theme}
          label={t('toolbar.dom')}
          active={domOpen === true}
          onClick={() => onToggleDom && onToggleDom()}
        >
          <ListTree size={14} />
        </IconAction>
      ) : null}
      {workspaceEnabled ? (
        <IconAction
          theme={theme}
          label={t('workspace.open')}
          active={workspaceOpen === true}
          onClick={() => onToggleWorkspace && onToggleWorkspace()}
        >
          <GitBranch size={14} />
        </IconAction>
      ) : null}
      {hotReloadEnabled ? (
        <HotReloadAction
          theme={theme}
          title={hotReloadTitle}
          active={hotReloadOn}
          pending={pending}
          onClick={() => onToggleHotReload && onToggleHotReload()}
        />
      ) : null}
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
    </div>
  )

  return (
    <TooltipProvider>
      <div
        ref={rootRef}
        className="dshnudge-flex dshnudge-flex-none dshnudge-flex-col"
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 'none',
          boxSizing: 'border-box',
          background: theme.base,
          borderBottom: `1px solid ${theme.borderStrong || theme.border}`,
          minWidth: 0,
        }}
      >
        <div
          data-toolbar-primary=""
          style={{
            display: 'flex',
            height: 40,
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
          <ReloadAction theme={theme} label={t('toolbar.reload')} disabled={!tab.url} pending={pending} onClick={onReload} />
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
                onFocus={(event) => event.currentTarget.select()}
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
                  borderRadius: 6,
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: theme.borderStrong || theme.border,
                  color: theme.text,
                  background: theme.layer1,
                  fontFamily: 'inherit',
                  fontSize: 12,
                  lineHeight: '26px',
                  outline: 'none',
                }}
              />
            </div>
            {layout.tiny ? null : (
              <IconAction theme={theme} label={t('toolbar.go')} onClick={() => onNavigate(shownUrl)}>
                <ArrowRight size={14} />
              </IconAction>
            )}
          </form>
          {layout.narrow ? null : (
            <>
              {modesEnabled ? (
                <div className="dshnudge-flex dshnudge-items-center dshnudge-gap-1" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {annotateEnabled ? (
                    <ModeToggle
                      active={tab.mode === 'annotate'}
                      label={t('toolbar.annotate')}
                      title={t('mode.annotateHint')}
                      theme={theme}
                      icon={<MessageSquarePlus size={13} />}
                      compact={layout.compact}
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
                      onClick={() => toggleMode('edit')}
                    />
                  ) : null}
                </div>
              ) : null}
              {domEnabled ? (
                <IconAction
                  theme={theme}
                  label={t('toolbar.dom')}
                  active={domOpen === true}
                  onClick={() => onToggleDom && onToggleDom()}
                >
                  <ListTree size={14} />
                </IconAction>
              ) : null}
              {workspaceEnabled ? (
                <IconAction
                  theme={theme}
                  label={t('workspace.open')}
                  active={workspaceOpen === true}
                  onClick={() => onToggleWorkspace && onToggleWorkspace()}
                >
                  <GitBranch size={14} />
                </IconAction>
              ) : null}
              {hotReloadEnabled ? (
                <HotReloadAction
                  theme={theme}
                  title={hotReloadTitle}
                  active={hotReloadOn}
                  pending={pending}
                  onClick={() => onToggleHotReload && onToggleHotReload()}
                />
              ) : null}
              <Divider theme={theme} />
              <IconAction theme={theme} label={t('toolbar.undo')} disabled={!canUndo} onClick={onUndo}>
                <Undo2 size={14} />
              </IconAction>
              <IconAction theme={theme} label={t('toolbar.redo')} disabled={!canRedo} onClick={onRedo}>
                <Redo2 size={14} />
              </IconAction>
              {carrierKind === 'webview' ? (
                <IconAction theme={theme} label={t('toolbar.external')} disabled={!tab.url} onClick={onExternal}>
                  <ArrowUpRight size={14} />
                </IconAction>
              ) : null}
            </>
          )}
        </div>
        {layout.narrow ? toolRow : null}
      </div>
    </TooltipProvider>
  )
}
