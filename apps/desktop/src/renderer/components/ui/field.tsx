import type { LabelHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface FieldProps extends LabelHTMLAttributes<HTMLLabelElement> {
  label: ReactNode
  children: ReactNode
  hint?: ReactNode
  error?: ReactNode
}

/**
 * Form field: small uppercase label stacked above its control.
 *
 * Pairs with `<Input>` / native `<input>` / `<select>`. Use `hint` for
 * subtle helper text and `error` for validation messages (replaces any
 * hint when both are provided).
 */
export function Field({
  label,
  children,
  hint,
  error,
  className,
  ...rest
}: FieldProps): JSX.Element {
  return (
    <label
      className={cn(
        'flex flex-col gap-1.5 text-wm-xs uppercase tracking-label text-fg-muted',
        className,
      )}
      {...rest}
    >
      {label}
      {children}
      {error ? (
        <span className="mt-0.5 text-wm-xs normal-case tracking-normal text-negative">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-0.5 text-wm-xs normal-case tracking-normal text-fg-muted">
          {hint}
        </span>
      ) : null}
    </label>
  )
}
