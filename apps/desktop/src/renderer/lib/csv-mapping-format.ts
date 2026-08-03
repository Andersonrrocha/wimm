import type { CsvMappingConfidence } from '../../shared/csv-mapping-protocol'

/**
 * Pure formatting/classification helpers for the CSV column-mapping screen
 * (`components/csv-mapping-modal.tsx`), kept separate from that component so
 * they can be covered by this app's existing Jest setup -- `jest.config.js`'s
 * `roots` includes `src/renderer/lib` specifically because those files have
 * no dependency on `window`/the DOM (see that config's own doc comment);
 * full component-level renderer testing remains out of scope here, same as
 * every other renderer component in this app.
 */

/**
 * Maps a detector confidence to one of `<Badge>`'s existing variants
 * (`components/ui/badge.tsx`) -- reusing the design system rather than
 * inventing new colors. `'high'` reads as a settled fact (positive),
 * `'medium'` as informational but worth a glance (info), `'low'` as
 * something the user must actively confirm (warning) -- never neutral,
 * since a low-confidence guess is never presented as if it were merely
 * unremarkable.
 */
export function confidenceBadgeVariant(
  confidence: CsvMappingConfidence,
): 'positive' | 'info' | 'warning' {
  if (confidence === 'high') return 'positive'
  if (confidence === 'medium') return 'info'
  return 'warning'
}

/**
 * Formats a signed amount as money, with an explicit sign and thousands
 * grouping -- deliberately more verbose than the existing per-page
 * `formatMoney` helpers (`imports-page.tsx` and siblings), which format an
 * always-positive magnitude next to a separate "kind" badge. This mapping
 * screen has no separate kind column (the mapping *is* what decides the
 * sign), and the whole point of Stage 2's preview is that a decimal-
 * separator mistake must be visible as a wrong NUMBER -- explicit grouping
 * is what makes "1.234,56" misread as "1,23" obviously wrong at a glance,
 * per the plan's own evidence.
 */
export function formatSignedMoney(amount: number): string {
  const sign = amount < 0 ? '−' : amount > 0 ? '+' : ''
  const magnitude = Math.abs(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return sign ? `${sign} ${magnitude}` : magnitude
}

/**
 * The two ways a `CsvMappingWarning` code is presented: `'dropped'` (the row
 * did not make it into `rows` at all -- `missing_date`, `missing_amount`,
 * `invalid_date`, `invalid_amount`) or `'imported'` (`zero_amount` -- the row
 * IS in `rows`, flagged only so the exceptional value is visible). Getting
 * this distinction right is the one thing `CLAUDE.md`'s "warnings are
 * surfaced, not swallowed" rule most needs here: a `zero_amount` warning
 * must never read as if the row were dropped, since it was not.
 */
export function classifyCsvMappingWarning(code: string): 'dropped' | 'imported' {
  return code === 'zero_amount' ? 'imported' : 'dropped'
}

/** `<Select>` options for a column-index field (`dateColumn`, `amountColumn`, ...) -- `"Column 0"`, `"Column 1"`, ... */
export function buildColumnIndexOptions(
  columnCount: number,
): Array<{ value: string; label: string }> {
  const count = Math.max(0, Math.floor(columnCount))
  return Array.from({ length: count }, (_, i) => ({
    value: String(i),
    label: `Column ${i}`,
  }))
}

/**
 * Splits a decoded text sample into rows of columns for the raw-file preview
 * panel -- a plain `split`, not a CSV-quote-aware parse. This is
 * deliberately cosmetic: it exists only to help the user visually count
 * columns and pick the right index, never to decide what gets imported (that
 * is `applyCsvMapping`'s job, via the real backend parser, through IPC). A
 * quoted field containing the delimiter would render as extra columns here
 * without affecting the actual import in any way.
 */
export function splitRawPreviewLines(
  text: string,
  delimiter: string,
  maxLines = 8,
): string[][] {
  return text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, maxLines)
    .map((line) => line.split(delimiter))
}
