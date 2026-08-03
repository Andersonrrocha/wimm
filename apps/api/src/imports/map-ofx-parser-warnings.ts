/**
 * Maps OFX parser warnings to the shared import preview warning shape.
 * Mirrors `map-banrisul-parser-warnings.ts` / `map-cresol-parser-warnings.ts`.
 */

import type { ImportParserWarning } from '@wimm/shared'
import type { OfxParseWarning } from './parsers/ofx-parser'

/**
 * `zero_amount` is informational: the transaction is still imported (see
 * the decision note in `ofx-parser.ts`). Every other code means the block
 * was dropped.
 */
const INFO_CODES = new Set<string>(['zero_amount'])

export function mapOfxWarningsForPreview(
  warnings: OfxParseWarning[],
): ImportParserWarning[] {
  return warnings.map((w) => {
    const severity = INFO_CODES.has(w.code) ? 'info' : 'warning'
    const out: ImportParserWarning = {
      code: w.code,
      message: w.message,
      severity,
    }
    if (w.rawBlock !== undefined) {
      out.rawBlock = w.rawBlock
      out.rawLine = w.rawBlock
    }
    return out
  })
}
