import * as React from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  History,
  ListTree,
  LocateFixed,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  MousePointer2,
  PanelRight,
  Pencil,
  Plus,
  Redo2,
  RefreshCw,
  RotateCw,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'

/**
 * The product mark: a browser window with a magnifier, drawn in `currentColor`
 * so it can sit in a tab strip or a menu row and follow the host theme.
 *
 * This is the canonical 24-unit geometry shared with the shipped brand artwork
 * in `icon.svg` (which renders the same coordinates in the brand gradient).
 * `test/brand-icon.test.mjs` asserts the two stay identical, so edit them as a
 * pair — the 24 viewBox also matches the Lucide icon box and stroke weight.
 */
export function NudgeMark({
  size = 16,
  className,
  style,
}: {
  size?: number
  className?: string
  style?: React.CSSProperties
}) {
  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
      className,
      style,
    },
    React.createElement('rect', {
      x: 2.5,
      y: 3,
      width: 12,
      height: 9,
      rx: 2.3,
      strokeWidth: 1.8,
      opacity: 0.9,
    }),
    React.createElement('path', {
      d: 'M6 6.4h3.2M6 8.4h2',
      strokeWidth: 1.6,
      opacity: 0.5,
    }),
    React.createElement('circle', {
      cx: 16.2,
      cy: 16,
      r: 3.5,
      strokeWidth: 2,
    }),
    React.createElement('path', {
      d: 'M18.8 18.6 21 20.8',
      strokeWidth: 2.2,
    }),
  )
}

/**
 * Curated Lucide icon surface for the non-UI Client parts.
 *
 * Those parts are concatenated into one factory scope instead of being bundled
 * as ESM, so they cannot import `lucide-react` themselves. The UI bundle exports
 * this map once and the build hands it to `src/client/shared/primitives.ts`.
 */
export const NudgeIcons = {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  FileCode2,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  History,
  ListTree,
  LocateFixed,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  MousePointer2,
  NudgeMark,
  PanelRight,
  Pencil,
  Plus,
  Redo2,
  RefreshCw,
  RotateCw,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  X,
}
