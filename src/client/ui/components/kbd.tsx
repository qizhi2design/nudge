import * as React from 'react'
import {
  ArrowBigUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Command,
  CornerDownLeft,
  Option,
  Space,
} from 'lucide-react'

/**
 * Keycap rendering for shortcut hints.
 *
 * The DSH shell draws shortcut keycaps as bare text; Nudge's own hints use
 * Lucide glyphs for the modifier keys that have a real symbol (⌘ ⌥ ⇧) so the
 * hints read like the system keyboard rather than like a font fallback. Key
 * caps stay plain text for letters, digits and punctuation.
 */

export type ShortcutPlatform = 'macos' | 'windows' | 'linux'

export interface ShortcutBinding {
  code: string
  secondCode?: string
  modifiers: string[]
}

export type KeycapPart =
  | { kind: 'icon'; icon: KeycapIcon; label?: string; title: string }
  | { kind: 'label'; label: string; title: string }

export type KeycapIcon = 'command' | 'option' | 'shift' | 'space' | 'enter' | 'arrowup' | 'arrowdown' | 'arrowleft' | 'arrowright'

const ICONS = {
  command: Command,
  option: Option,
  shift: ArrowBigUp,
  space: Space,
  enter: CornerDownLeft,
  arrowup: ArrowUp,
  arrowdown: ArrowDown,
  arrowleft: ArrowLeft,
  arrowright: ArrowRight,
} as const

const KEY_LABELS: Record<string, string> = {
  Slash: '/',
  Comma: ',',
  Period: '.',
  Backslash: '\\',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
}

const KEY_ICONS: Record<string, { icon: KeycapIcon; label?: string; title: string }> = {
  Space: { icon: 'space', label: 'Space', title: 'Space' },
  Enter: { icon: 'enter', title: 'Enter' },
  ArrowUp: { icon: 'arrowup', title: 'Up arrow' },
  ArrowDown: { icon: 'arrowdown', title: 'Down arrow' },
  ArrowLeft: { icon: 'arrowleft', title: 'Left arrow' },
  ArrowRight: { icon: 'arrowright', title: 'Right arrow' },
}

const MODIFIER_ORDER = ['control', 'alt', 'shift', 'meta'] as const

/** Human-readable glyphs for non-icon key codes (letters, digits, F-keys). */
export function keycapKeyLabel(code: string): string {
  if (typeof code !== 'string' || code === '') return ''
  if (KEY_LABELS[code] !== undefined) return KEY_LABELS[code]
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  return code
}

/**
 * Pure keycap model shared by tooltips, the shortcut sheet and the mode hint.
 * Modifier order matches the DSH shortcut catalog so an override recorded in
 * Settings renders in the same reading order as the system reference.
 */
export function keycapModel(binding: ShortcutBinding | null | undefined, platform: ShortcutPlatform): KeycapPart[] {
  if (!binding || typeof binding.code !== 'string' || binding.code === '') return []
  const mac = platform === 'macos'
  const modifiers = Array.isArray(binding.modifiers) ? binding.modifiers : []
  const parts: KeycapPart[] = []
  MODIFIER_ORDER.forEach((modifier) => {
    if (modifiers.indexOf(modifier) === -1) return
    if (modifier === 'meta') {
      parts.push(mac ? { kind: 'icon', icon: 'command', title: 'Command' } : { kind: 'label', label: 'Win', title: 'Windows' })
    } else if (modifier === 'alt') {
      parts.push(mac ? { kind: 'icon', icon: 'option', title: 'Option' } : { kind: 'label', label: 'Alt', title: 'Alt' })
    } else if (modifier === 'shift') {
      parts.push({ kind: 'icon', icon: 'shift', title: 'Shift' })
    } else {
      parts.push({ kind: 'label', label: 'Ctrl', title: 'Control' })
    }
  })
  const pushKey = (code: string) => {
    const icon = KEY_ICONS[code]
    if (icon) {
      parts.push({ kind: 'icon', icon: icon.icon, label: icon.label, title: icon.title })
      return
    }
    const label = keycapKeyLabel(code)
    if (label !== '') parts.push({ kind: 'label', label, title: label })
  }
  pushKey(binding.code)
  if (binding.secondCode) pushKey(binding.secondCode)
  return parts
}

/** One rounded keycap; icons keep the glyph, text pages stay typographic. */
export function Keycap({ part, size = 20 }: { part: KeycapPart; size?: number }) {
  const Icon = part.kind === 'icon' ? ICONS[part.icon] : null
  return (
    <span
      className="dshnudge-keycap"
      title={part.title}
      aria-label={part.title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        height: size,
        minWidth: size,
        boxSizing: 'border-box',
        padding: part.kind === 'icon' && part.label ? '0 5px' : '0 4px',
        borderRadius: 6,
        border: '.5px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.22))',
        background: 'var(--dsw-alias-bg-module-platform, rgba(127,127,127,0.14))',
        color: 'var(--dsw-alias-label-secondary, inherit)',
        font: 'inherit',
        fontSize: 11,
        fontWeight: 550,
        lineHeight: 1,
        whiteSpace: 'nowrap',
        flex: 'none',
      }}
    >
      {Icon ? <Icon size={size === 20 ? 12 : 11} strokeWidth={2} aria-hidden="true" style={{ display: 'block' }} /> : null}
      {part.kind === 'icon' && part.label ? <span aria-hidden="true">{part.label}</span> : null}
      {part.kind === 'label' ? <span aria-hidden="true">{part.label}</span> : null}
    </span>
  )
}

/** A full combination rendered as adjacent keycaps; nothing when unbound. */
export function ShortcutKeys({
  binding,
  platform,
  size = 20,
}: {
  binding: ShortcutBinding | null | undefined
  platform: ShortcutPlatform
  size?: number
}) {
  const parts = keycapModel(binding, platform)
  if (parts.length === 0) return null
  return (
    <span
      data-shortcut-keys=""
      aria-label={parts.map((part) => part.title).join(' + ')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flex: 'none' }}
    >
      {parts.map((part, index) => (
        <Keycap key={part.title + ':' + index} part={part} size={size} />
      ))}
    </span>
  )
}
