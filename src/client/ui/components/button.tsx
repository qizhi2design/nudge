import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../cn'

const buttonVariants = cva(
  'dshnudge-inline-flex dshnudge-items-center dshnudge-justify-center dshnudge-gap-1.5 dshnudge-whitespace-nowrap dshnudge-border dshnudge-border-solid dshnudge-text-[11.5px] dshnudge-font-semibold dshnudge-transition-colors disabled:dshnudge-pointer-events-none disabled:dshnudge-opacity-45',
  {
    variants: {
      variant: {
        ghost: 'dshnudge-border-transparent dshnudge-bg-transparent',
        outline: 'dshnudge-bg-transparent',
        active: '',
        primary: 'dshnudge-border-transparent dshnudge-text-white',
      },
      size: {
        icon: 'dshnudge-h-7 dshnudge-w-7 dshnudge-p-0',
        sm: 'dshnudge-h-7 dshnudge-px-2.5',
        md: 'dshnudge-h-7 dshnudge-px-2.5',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'icon' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size = 'icon', type = 'button', style, onMouseDown, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // Pointer clicks must not take keyboard focus from the embedded page:
      // otherwise the next Space (the "hold to use the page" gesture) would
      // activate this toolbar button instead of reaching the page runtime.
      onMouseDown={(event) => {
        if (event.button === 0 && event.defaultPrevented === false) event.preventDefault()
        if (typeof onMouseDown === 'function') onMouseDown(event)
      }}
      className={cn(buttonVariants({ variant, size }), className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        flex: 'none',
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
        fontFamily: 'inherit',
        fontSize: 11.5,
        fontWeight: 600,
        lineHeight: 1,
        height: 28,
        width: size === 'icon' ? 28 : undefined,
        padding: size === 'icon' ? 0 : '0 10px',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: 'transparent',
        borderRadius: 'var(--dsw-radius-sm, 8px)',
        background: 'transparent',
        cursor: props.disabled ? 'default' : 'pointer',
        opacity: props.disabled ? 0.45 : 1,
        transition: 'background-color 120ms ease, color 120ms ease, border-color 120ms ease',
        ...style,
      }}
      {...props}
    />
  )
})

export { buttonVariants }
