/**
 * Maps Banrisul orchestration warnings to the shared import preview warning shape.
 * Other bank PDF parsers can follow the same ImportParserWarning contract.
 */

import type { ImportParserWarning } from '@wimm/shared'
import type { BanrisulOrchestratedWarning } from './parsers/banrisul-cc/parse-statement-text'

/** Codes treated as informational (parse continued; validation incomplete or empty section). */
const INFO_CODES = new Set<string>(['empty_section', 'missing_declared_total'])

export function mapBanrisulWarningsForPreview(
  warnings: BanrisulOrchestratedWarning[],
): ImportParserWarning[] {
  return warnings.map((w) => {
    const severity = INFO_CODES.has(w.code) ? 'info' : 'warning'
    const out: ImportParserWarning = {
      code: w.code,
      message: w.message,
      severity,
    }
    if (w.rawLine !== undefined) out.rawLine = w.rawLine
    if (w.cardLast4 !== undefined) out.cardLast4 = w.cardLast4
    if (w.expectedTotal !== undefined) out.expectedTotal = w.expectedTotal
    if (w.actualTotal !== undefined) out.actualTotal = w.actualTotal
    if (w.delta !== undefined) out.delta = w.delta
    return out
  })
}
