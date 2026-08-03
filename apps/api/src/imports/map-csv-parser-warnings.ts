/**
 * Maps CSV parser warnings to the shared import preview warning shape.
 * Mirrors `map-banrisul-parser-warnings.ts` / `map-cresol-parser-warnings.ts`.
 */

import type { ImportParserWarning } from '@wimm/shared'
import type { CsvParseWarning } from './parsers/csv-parser'

/**
 * `zero_amount` is informational: the row is still imported (see the
 * decision note in `csv-parser.ts`). Every other code means the row was
 * dropped.
 */
const INFO_CODES = new Set<string>(['zero_amount'])

export function mapCsvWarningsForPreview(
  warnings: CsvParseWarning[],
): ImportParserWarning[] {
  return warnings.map((w) => {
    const severity = INFO_CODES.has(w.code) ? 'info' : 'warning'
    const out: ImportParserWarning = {
      code: w.code,
      message: w.message,
      severity,
    }
    if (w.rawLine !== undefined) out.rawLine = w.rawLine
    return out
  })
}
