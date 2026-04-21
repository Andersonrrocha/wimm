import * as RadixSelect from '@radix-ui/react-select'
import type { ReactNode } from 'react'
import { forwardRef } from 'react'

export interface SelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
  description?: ReactNode
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  required?: boolean
  ariaLabel?: string
  id?: string
  triggerClassName?: string
  /** Minimum width of the trigger; inline style */
  minWidth?: number | string
}

/**
 * Themed select built on Radix Primitives. Keeps our visual language while
 * providing proper keyboard nav, ARIA, and animations.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
  required,
  ariaLabel,
  id,
  triggerClassName,
  minWidth,
}: SelectProps): JSX.Element {
  return (
    <RadixSelect.Root
      value={value || undefined}
      onValueChange={onChange}
      disabled={disabled}
      required={required}
    >
      <RadixSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        className={['wm-select-trigger', triggerClassName]
          .filter(Boolean)
          .join(' ')}
        style={minWidth ? { minWidth } : undefined}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="wm-select-trigger__icon" aria-hidden>
          <ChevronDown />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          className="wm-select-content"
          position="popper"
          sideOffset={6}
        >
          <RadixSelect.ScrollUpButton className="wm-select-scroll">
            ▲
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="wm-select-viewport">
            {options.map((o) => (
              <SelectItem
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                description={o.description}
              >
                {o.label}
              </SelectItem>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="wm-select-scroll">
            ▼
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}

interface SelectItemProps {
  value: string
  children: ReactNode
  disabled?: boolean
  description?: ReactNode
}

const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(
  function SelectItem({ value, children, disabled, description }, ref) {
    return (
      <RadixSelect.Item
        ref={ref}
        value={value}
        disabled={disabled}
        className="wm-select-item"
      >
        <RadixSelect.ItemIndicator className="wm-select-item__check" aria-hidden>
          ✓
        </RadixSelect.ItemIndicator>
        <div className="wm-select-item__body">
          <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
          {description ? (
            <span className="wm-select-item__desc">{description}</span>
          ) : null}
        </div>
      </RadixSelect.Item>
    )
  },
)

function ChevronDown(): JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 4.5 6 7.5 9 4.5" />
    </svg>
  )
}
