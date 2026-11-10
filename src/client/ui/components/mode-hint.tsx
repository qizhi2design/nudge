import * as React from 'react'
import { ShortcutKeys, type ShortcutBinding, type ShortcutPlatform } from './kbd'

/** Page-local hotkeys (physical `KeyboardEvent.code`s) from plugin settings. */
export interface ModeHotkeyMap {
  annotate: string
  edit: string
  prevAnnotation: string
  nextAnnotation: string
}

/**
 * Rich hint rendered inside the tooltip of the annotate / edit toggle. The
 * reference interaction teaches the same facts in a hover tooltip: the action
 * the mode performs, the single page-local key that activates it (configured in
 * Settings → Nudge), the annotate-only ↑/↓ annotation navigation, Esc to leave,
 * and hold Space to hand the page back.
 */
export function ModeHintContent({
  t,
  mode,
  platform,
  hotkeys,
}: {
  t: (key: string, vars?: Record<string, string>) => string
  mode: 'annotate' | 'edit'
  platform: ShortcutPlatform
  hotkeys: ModeHotkeyMap
}) {
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 1,
  }
  const modeKey: ShortcutBinding = { code: mode === 'edit' ? hotkeys.edit : hotkeys.annotate, modifiers: [] }
  return (
    <span
      data-mode-hint-content=""
      style={{ display: 'block', textAlign: 'center', lineHeight: 1.7, maxWidth: 300 }}
    >
      <span style={{ display: 'block' }}>{mode === 'edit' ? t('shortcut.hintEdit') : t('shortcut.hintAnnotate')}</span>
      {mode === 'annotate' ? (
        <span style={rowStyle}>
          <ShortcutKeys binding={{ code: hotkeys.prevAnnotation, modifiers: [] }} platform={platform} size={18} />
          <ShortcutKeys binding={{ code: hotkeys.nextAnnotation, modifiers: [] }} platform={platform} size={18} />
          {t('shortcut.hintSwitchAnnotation')}
        </span>
      ) : null}
      <span style={rowStyle}>
        <ShortcutKeys binding={modeKey} platform={platform} size={18} />
        {mode === 'edit' ? t('shortcut.enterEdit') : t('shortcut.enterAnnotate')}
      </span>
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
