import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '../cn'

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={420} skipDelayDuration={120}>
      {children}
    </TooltipPrimitive.Provider>
  )
}

export function Tooltip({
  label,
  children,
  side = 'bottom',
}: {
  label: string
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn('dshnudge-tooltip')}
          style={{
            background: 'var(--dsw-alias-tooltip-bg, var(--dsw-alias-bg-overlay, #1f2430))',
            color: 'var(--dsw-alias-tooltip-label, var(--dsw-alias-label-primary, #f4f4f5))',
            border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12))',
          }}
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
