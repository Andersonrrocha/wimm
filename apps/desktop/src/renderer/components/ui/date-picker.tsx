import * as Popover from '@radix-ui/react-popover'
import { format } from 'date-fns'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { dateFnsLocaleForLang } from '../../lib/date-fns-locale'
import { fromIsoDate, toIsoDate } from '../../lib/dates'

interface DatePickerProps {
  /** ISO date (YYYY-MM-DD) */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  /** Minimum width of the trigger; inline style */
  minWidth?: number | string
  ariaLabel?: string
  id?: string
}

/** Date picker built on Radix Popover + react-day-picker. */
export function DatePicker({
  value,
  onChange,
  placeholder,
  disabled,
  minWidth,
  ariaLabel,
  id,
}: DatePickerProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const resolvedPlaceholder = placeholder ?? t('datePicker.selectDate')
  const resolvedAria = ariaLabel ?? t('datePicker.pickDate')
  const [open, setOpen] = useState(false)
  const parsed = useMemo(() => fromIsoDate(value), [value])
  const locale = useMemo(
    () => dateFnsLocaleForLang(i18n.language),
    [i18n.language],
  )

  const label = parsed ? format(parsed, 'MMM d, yyyy', { locale }) : ''

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          aria-label={resolvedAria}
          disabled={disabled}
          className="wm-select-trigger wm-date-trigger"
          style={minWidth ? { minWidth } : undefined}
        >
          <span
            className={`wm-date-trigger__value${
              !parsed ? ' wm-date-trigger__value--placeholder' : ''
            }`}
          >
            {label || resolvedPlaceholder}
          </span>
          <span className="wm-select-trigger__icon" aria-hidden>
            <CalendarIcon />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="wm-popover"
          align="start"
          sideOffset={6}
        >
          <DayPicker
            mode="single"
            locale={locale}
            selected={parsed ?? undefined}
            onSelect={(d) => {
              if (d) {
                onChange(toIsoDate(d))
                setOpen(false)
              }
            }}
            showOutsideDays
            weekStartsOn={0}
            className="wm-daypicker"
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function CalendarIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <line x1="2.5" y1="6.5" x2="13.5" y2="6.5" />
      <line x1="5.5" y1="2" x2="5.5" y2="5" />
      <line x1="10.5" y1="2" x2="10.5" y2="5" />
    </svg>
  )
}
