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
 * so it can sit in a tab strip or a menu row and follow the host theme. This
 * mirrors the gradient artwork in `icon.svg` without hard-coding colors.
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
      viewBox: '0 0 16 16',
      fill: 'none',
      'aria-hidden': 'true',
      focusable: 'false',
      className,
      style,
    },
    React.createElement('rect', {
      x: 1.2,
      y: 2,
      width: 11.2,
      height: 9.2,
      rx: 2.3,
      stroke: 'currentColor',
      strokeWidth: 1.2,
      opacity: 0.9,
    }),
    React.createElement('path', {
      d: 'M4 5.1h3.6M4 7.2h2.4',
      stroke: 'currentColor',
      strokeWidth: 1.1,
      strokeLinecap: 'round',
      opacity: 0.55,
    }),
    React.createElement('circle', {
      cx: 11.4,
      cy: 10.6,
      r: 2.7,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.35,
    }),
    React.createElement('path', {
      d: 'M13.35 12.55 14.75 13.95',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinecap: 'round',
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
