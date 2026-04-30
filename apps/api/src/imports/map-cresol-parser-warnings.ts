/**
 * Maps Cresol parser warnings to the shared import preview shape.
 */

import type { ImportParserWarning } from '@wimm/shared'
import type { CresolExtractedTextWarning } from './parsers/cresol/parse-cresol-statement-extracted-text'

/** Non-fatal diagnostics shown as info in preview UI. */
const INFO_CODES = new Set<string>(['low_confidence_block'])

export function mapCresolWarningsForPreview(
  warnings: CresolExtractedTextWarning[],
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
