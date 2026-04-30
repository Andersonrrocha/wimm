import * as RadixSelect from '@radix-ui/react-select'
import type { ReactNode } from 'react'
import { forwardRef } from 'react'

/**
 * Radix Select.Item must not use an empty string as `value`. Several forms
 * use `''` for "None" / "All" / "not chosen"; map that to an internal token so
 * opening the dropdown (e.g. Quick Add → Transaction) does not crash the tree.
 */
const WIMM_SELECT_EMPTY = '__wimm_select_empty__'

function toRadixItemValue(optionValue: string): string {
  return optionValue === '' ? WIMM_SELECT_EMPTY : optionValue
}

function fromRadixValue(radixValue: string): string {
  return radixValue === WIMM_SELECT_EMPTY ? '' : radixValue
}

export interface SelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
  description?: ReactNode
}

export interface SelectOptionGroup {
  label: string
  options: SelectOption[]
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  /**
   * Flat list. Used when `optionGroups` is not passed.
   */
  options?: SelectOption[]
  /**
   * Optional items rendered before grouped sections (e.g. placeholder).
   * Only used when `optionGroups` is passed.
   */
  leadingOptions?: SelectOption[]
  /**
   * When set, renders Radix Select groups with labels instead of a flat list.
   */
  optionGroups?: SelectOptionGroup[]
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
  options = [],
  leadingOptions = [],
  optionGroups,
  placeholder = 'Select…',
  disabled,
  required,
  ariaLabel,
  id,
  triggerClassName,
  minWidth,
}: SelectProps): JSX.Element {
  const radixValue = toRadixItemValue(value)

  const renderOption = (o: SelectOption) => {
    const itemValue = toRadixItemValue(o.value)
    return (
      <SelectItem
        key={itemValue}
        value={itemValue}
        disabled={o.disabled}
        description={o.description}
      >
        {o.label}
      </SelectItem>
    )
  }

  return (
    <RadixSelect.Root
      value={radixValue}
      onValueChange={(v) => onChange(fromRadixValue(v))}
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
            {optionGroups !== undefined ? (
              <>
                {leadingOptions.map((o) => renderOption(o))}
                {optionGroups.map((g, i) => (
                  <RadixSelect.Group key={g.label || `__ungrouped_${i}`}>
                    {g.label ? (
                      <RadixSelect.Label className="wm-select-group__label">
                        {g.label}
                      </RadixSelect.Label>
                    ) : null}
                    {g.options.map((o) => renderOption(o))}
                  </RadixSelect.Group>
                ))}
              </>
            ) : (
              options.map((o) => renderOption(o))
            )}
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
