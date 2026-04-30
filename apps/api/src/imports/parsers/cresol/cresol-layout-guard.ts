/**
 * Conservative layout check for Cresol account statement text (after PDF extraction).
 */

import { BANRISUL_PDF_MIN_TEXT_CHARS } from '../banrisul-cc/extract-pdf-text'

export type CanParseCresolStatementPdfResult =
  | { ok: true }
  | { ok: false; message: string }

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

/** At least one signed BRL amount as printed on statements (ASCII or Unicode minus). */
const SIGNED_BRL =
  /[-+\u2212\u2013\u2014]\s*R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}/

export function canParseCresolStatementPdf(
  text: string,
): CanParseCresolStatementPdfResult {
  const trimmed = text?.trim() ?? ''
  if (trimmed.length < BANRISUL_PDF_MIN_TEXT_CHARS) {
    return {
      ok: false,
      message:
        'This PDF has too little selectable text to be a Cresol statement. ' +
        'Export a text-based PDF from Cresol or use CSV/OFX.',
    }
  }

  const folded = stripAccents(trimmed).toUpperCase()
  if (!folded.includes('CRESOL')) {
    return {
      ok: false,
      message:
        'This PDF does not appear to be a Cresol statement (missing Cresol branding).',
    }
  }

  const hasContext =
    /\bEXTRATO\b/.test(folded) ||
    folded.includes('CONTA CORRENTE') ||
    folded.includes('COOPERATIVA') ||
    folded.includes('AGENCIA') ||
    folded.includes('AGÊNCIA')

  if (!hasContext) {
    return {
      ok: false,
      message:
        'This PDF looks like Cresol branding but not a typical account statement layout (extrato / conta corrente).',
    }
  }

  if (!SIGNED_BRL.test(trimmed)) {
    return {
      ok: false,
      message:
        'This PDF has no lines with signed BRL amounts (+/- R$) as expected on Cresol transaction history.',
    }
  }

  return { ok: true }
}
