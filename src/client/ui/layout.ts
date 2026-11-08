/**
 * Responsive breakpoints for the inspector toolbar.
 *
 * The toolbar lives in a narrow right-sidebar tab (often ~500 CSS px) and, when
 * the workspace/DOM dock is open, must still leave usable room for the address
 * bar. The layout tiers are:
 *
 *   width < 720  compact  mode labels are hidden (icons only)
 *   width < 620  narrow   low-frequency actions move into the expandable
 *                         second toolbar row instead of squeezing the address
 *   width < 430  tiny     back/forward collapses to back only and the address
 *                         form loses its explicit "go" button (Enter submits)
 *
 * Kept as a pure function so the bundle smoke test can pin the thresholds.
 */
export const TOOLBAR_WIDTH = {
  labels: 720,
  toolRow: 620,
  tiny: 430,
} as const

export interface ToolbarLayout {
  compact: boolean
  narrow: boolean
  tiny: boolean
}

export function toolbarLayout(width: number): ToolbarLayout {
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) {
    return { compact: false, narrow: false, tiny: false }
  }
  return {
    compact: width < TOOLBAR_WIDTH.labels,
    narrow: width < TOOLBAR_WIDTH.toolRow,
    tiny: width < TOOLBAR_WIDTH.tiny,
  }
}
