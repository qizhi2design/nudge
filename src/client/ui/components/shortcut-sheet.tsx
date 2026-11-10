import * as React from 'react'
import { Keyboard } from 'lucide-react'
import { ShortcutKeys, type ShortcutBinding, type ShortcutPlatform } from './kbd'

export interface ShortcutSheetRow {
  id: string
  label: string
  binding: ShortcutBinding | null
  /** Page-local interaction rows sit under their own caption. */
  pageLocal?: boolean
  /** Product switch off: keep the row visible but muted. */
  disabled?: boolean
}

export interface ShortcutSheetTheme {
  base: string
  layer1: string
  text: string
  muted: string
  border: string
  borderStrong?: string
}

function hairline(theme: ShortcutSheetTheme) {
  return '.5px solid var(' + '--dsw-alias-border-l2, ' + (theme.borderStrong || theme.border) + ')'
}

/**
 * The in-product shortcut sheet. It expands the toolbar block instead of
 * overlaying the embedded page, so it stays a normal layout row in every
 * Electron/Web carrier and never fights the guest view's stacking order.
 */
export function ShortcutSheet({
  t,
  theme,
  platform,
  rows,
}: {
  t: (key: string, vars?: Record<string, string>) => string
  theme: ShortcutSheetTheme
  platform: ShortcutPlatform
  rows: ShortcutSheetRow[]
}) {
  const commandRows = rows.filter((row) => row.pageLocal !== true)
  const pageRows = rows.filter((row) => row.pageLocal === true)
  function renderRow(row: ShortcutSheetRow) {
    return (
      <div key={row.id} data-shortcut-row={row.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 24 }}>
        <span
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 11.5,
            color: row.disabled ? theme.muted : theme.text,
          }}
        >
          {row.label}
        </span>
        {row.binding ? (
          <ShortcutKeys binding={row.binding} platform={platform} />
        ) : (
          <span style={{ color: theme.muted, fontSize: 11 }}>{t('shortcut.unbound')}</span>
        )}
      </div>
    )
  }
  return (
    <div
      data-shortcut-sheet=""
      role="region"
      aria-label={t('shortcut.helpTitle')}
      style={{
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '8px 10px 10px',
        borderTop: hairline(theme),
        background: 'var(--dsw-alias-bg-base, ' + theme.base + ')',
        color: theme.text,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 18 }}>
        <Keyboard size={13} aria-hidden="true" style={{ display: 'block', color: theme.muted }} />
        <span style={{ fontSize: 11.5, fontWeight: 600 }}>{t('shortcut.helpTitle')}</span>
        <span
          style={{
            marginLeft: 'auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 10.5,
            color: theme.muted,
          }}
        >
          {t('shortcut.helpHint')}
        </span>
      </div>
      {commandRows.map(renderRow)}
      {pageRows.length > 0 ? (
        <>
          <div style={{ height: 1, background: theme.border, opacity: 0.6, margin: '3px 0' }} />
          <div style={{ fontSize: 10.5, color: theme.muted }}>{t('shortcut.pageLocal')}</div>
          {pageRows.map(renderRow)}
        </>
      ) : null}
    </div>
  )
}

/**
 * Rich hint rendered inside the Radix tooltip of the annotate / edit toggle.
 * The reference interaction teaches the same facts in a hover tooltip: the
 * action the mode performs, how to leave it again (the effective toggle binding
 * and Esc), the annotate-only ↑/↓ annotation navigation, and hold Space to hand
 * the page back.
 */
export function ModeHintContent({
  t,
  mode,
  platform,
  binding,
}: {
  t: (key: string, vars?: Record<string, string>) => string
  mode: 'annotate' | 'edit'
  platform: ShortcutPlatform
  /** Effective toggle binding; null / omitted renders no toggle-off row. */
  binding?: ShortcutBinding | null
}) {
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 1,
  }
  return (
    <span
      data-mode-hint-content=""
      style={{ display: 'block', textAlign: 'center', lineHeight: 1.7, maxWidth: 300 }}
    >
      <span style={{ display: 'block' }}>{mode === 'edit' ? t('shortcut.hintEdit') : t('shortcut.hintAnnotate')}</span>
      {mode === 'annotate' ? (
        <span style={rowStyle}>
          <ShortcutKeys binding={{ code: 'ArrowUp', modifiers: [] }} platform={platform} size={18} />
          <ShortcutKeys binding={{ code: 'ArrowDown', modifiers: [] }} platform={platform} size={18} />
          {t('shortcut.hintSwitchAnnotation')}
        </span>
      ) : null}
      {binding ? (
        <span style={rowStyle}>
          <ShortcutKeys binding={binding} platform={platform} size={18} />
          {t('shortcut.hintToggleOff')}
        </span>
      ) : null}
      <span style={rowStyle}>
        <ShortcutKeys binding={{ code: 'Escape', modifiers: [] }} platform={platform} size={18} />
        {t('shortcut.exitMode')}
      </span>
      <span style={rowStyle}>
        {t('shortcut.hintSpaceBefore')}
        <ShortcutKeys binding={{ code: 'Space', modifiers: [] }} platform={platform} size={18} />
        {t('shortcut.hintSpaceAfter')}
      </span>
    </span>
  )
}
