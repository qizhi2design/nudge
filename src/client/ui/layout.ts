/**
 * Responsive measurement rules for the inspector toolbar.
 *
 * The toolbar is always two rows, matching the product's two jobs:
 *
 *   row 1  the native-browser bar: back / forward / reload / address / go
 *   row 2  the Nudge action bar: annotate / edit, DOM / workspace / auto-reload,
 *          undo / redo and open-in-system-browser
 *
 * The breakpoints only refine the two rows on very narrow sidebars:
 *
 *   width < 460  compact  mode labels in row 2 collapse to icons only
 *   width < 430  tiny     row 1 drops forward and the explicit "go" button
 *                         (Enter still submits the address)
 *
 * Kept as a pure function so the bundle smoke test can pin the thresholds.
 */
export const TOOLBAR_WIDTH = {
  labels: 460,
  tiny: 430,
} as const

export interface ToolbarLayout {
  compact: boolean
  tiny: boolean
}

export function toolbarLayout(width: number): ToolbarLayout {
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
    return { compact: false, tiny: false }
  }
  return {
    compact: width < TOOLBAR_WIDTH.labels,
    tiny: width < TOOLBAR_WIDTH.tiny,
  }
}
