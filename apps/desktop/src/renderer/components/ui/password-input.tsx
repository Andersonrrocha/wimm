import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { Input } from './input'

export type PasswordInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
>

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, ...rest }, ref) {
    const { t } = useTranslation()
    const [show, setShow] = useState(false)

    return (
      <div className="relative w-full">
        <Input
          ref={ref}
          type={show ? 'text' : 'password'}
          className={cn('pr-10', className)}
          {...rest}
        />
        <button
          type="button"
          className={cn(
            'absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center',
            'rounded text-fg-muted transition-colors',
            'hover:bg-surface-3 hover:text-fg',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-2',
          )}
          aria-label={show ? t('auth.hidePassword') : t('auth.showPassword')}
          aria-pressed={show}
          tabIndex={0}
          onClick={() => setShow((v) => !v)}
        >
          {show ? (
            <EyeOff className="size-4 shrink-0" strokeWidth={2} aria-hidden />
          ) : (
            <Eye className="size-4 shrink-0" strokeWidth={2} aria-hidden />
          )}
        </button>
      </div>
    )
  },
)
