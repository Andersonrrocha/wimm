import { forwardRef } from 'react'
import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { cn } from '../../lib/cn'

const base =
  'w-full rounded-sm border border-line bg-surface-2 px-2.5 py-2 text-wm-md text-fg ' +
  'normal-case tracking-normal transition duration-wm-fast ease-wm ' +
  'placeholder:text-fg-soft ' +
  'hover:border-line-strong ' +
  'focus:border-accent focus:bg-surface-3 focus:outline-none ' +
  'disabled:opacity-60 disabled:cursor-not-allowed'

type InputProps = InputHTMLAttributes<HTMLInputElement>

/**
 * Text/number/email/etc native input styled with WIMM tokens. Use inside
 * `<Field>` for label stacking; standalone is also fine.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', ...rest },
  ref,
) {
  return (
    <input ref={ref} type={type} className={cn(base, className)} {...rest} />
  )
})

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(base, 'min-h-[80px] resize-y', className)}
        {...rest}
      />
    )
  },
)

type NativeSelectProps = SelectHTMLAttributes<HTMLSelectElement>

/**
 * Thin wrapper around the native `<select>` that matches `<Input>`
 * styling. Prefer the Radix-powered `<Select>` for rich pickers.
 */
export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  function NativeSelect({ className, ...rest }, ref) {
    return <select ref={ref} className={cn(base, className)} {...rest} />
  },
)
