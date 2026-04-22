import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface FormGridProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

/**
 * Auto-fitting grid for forms. Columns snap to a minimum of 180px and
 * stretch to fill. Children are aligned to the bottom of each row so
 * buttons sit next to fields cleanly.
 */
export function FormGrid({
  children,
  className,
  ...rest
}: FormGridProps): JSX.Element {
  return (
    <div
      className={cn(
        'grid items-end gap-3',
        'grid-cols-[repeat(auto-fit,minmax(180px,1fr))]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

interface FormRowProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

/**
 * Flex row for controls that need to wrap. Children align to bottom
 * so that buttons line up with the baseline of fields.
 */
export function FormRow({
  children,
  className,
  ...rest
}: FormRowProps): JSX.Element {
  return (
    <div
      className={cn('flex flex-wrap items-end gap-3', className)}
      {...rest}
    >
      {children}
    </div>
  )
}
