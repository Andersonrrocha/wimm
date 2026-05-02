import * as Popover from '@radix-ui/react-popover'
import { format } from 'date-fns'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DayPicker, type DateRange } from 'react-day-picker'
import 'react-day-picker/style.css'
import { dateFnsLocaleForLang } from '../../lib/date-fns-locale'
import { fromIsoDate, toIsoDate } from '../../lib/dates'

interface DateRangePickerProps {
  /** ISO `YYYY-MM-DD` for the start of the range. */
  from: string
  /** ISO `YYYY-MM-DD` for the end of the range. */
  to: string
  /** Fired with both ends once the user picks a complete range. */
  onChange: (range: { from: string; to: string }) => void
  placeholder?: string
  disabled?: boolean
  /** Minimum width of the trigger; inline style. */
  minWidth?: number | string
  ariaLabel?: string
  id?: string
}

/**
 * Range date picker using `react-day-picker`'s built-in `mode="range"`.
 *  - Tap 1: sets start, clears end. Day highlights.
 *  - Tap 2: sets end (auto-swaps if before start). Range fills between.
 *  - Tap 3: starts a new range from that day.
 *
 * Renders 2 months side-by-side for desktop space (vs single month on mobile).
 * Fires `onChange` only once both ends are picked, then closes the popover.
 */
export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder,
  disabled,
  minWidth,
  ariaLabel,
  id,
}: DateRangePickerProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const resolvedPlaceholder = placeholder ?? t('common.dateRange')
  const resolvedAria = ariaLabel ?? t('common.pickRange')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>(undefined)

  const locale = useMemo(
    () => dateFnsLocaleForLang(i18n.language),
    [i18n.language],
  )

  const parsedFrom = useMemo(() => fromIsoDate(from), [from])
  const parsedTo = useMemo(() => fromIsoDate(to), [to])

  // Hydrate the draft when opening so in-progress edits don't fight prop changes.
  useEffect(() => {
    if (open) {
      setDraft({
        from: parsedFrom ?? undefined,
        to: parsedTo ?? undefined,
      })
    }
  }, [open, parsedFrom, parsedTo])

  const triggerLabel =
    parsedFrom && parsedTo
      ? `${format(parsedFrom, 'MMM d', { locale })} → ${format(parsedTo, 'MMM d, yyyy', { locale })}`
      : ''

  const handleSelect = (next: DateRange | undefined): void => {
    setDraft(next)
    if (next?.from && next?.to) {
      onChange({
        from: toIsoDate(next.from),
        to: toIsoDate(next.to),
      })
      setOpen(false)
    }
  }

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
              !triggerLabel ? ' wm-date-trigger__value--placeholder' : ''
            }`}
          >
            {triggerLabel || resolvedPlaceholder}
          </span>
          <span className="wm-select-trigger__icon" aria-hidden>
            <CalendarIcon />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="wm-popover" align="start" sideOffset={6}>
          <DayPicker
            mode="range"
            locale={locale}
            selected={draft}
            onSelect={handleSelect}
            numberOfMonths={2}
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
