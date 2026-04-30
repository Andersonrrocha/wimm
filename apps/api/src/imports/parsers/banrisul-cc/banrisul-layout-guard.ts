/**
 * Deterministic layout checks for Banrisul credit card statement text (post PDF text extraction).
 * Conservative: prefer rejecting unknown PDFs over false positives.
 */

import { BANRISUL_PDF_MIN_TEXT_CHARS } from './extract-pdf-text'

export type CanParseBanrisulCreditCardPdfResult =
  | { ok: true }
  | { ok: false; message: string }

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

const HISTORICO_NEEDLE = stripAccents('HISTÓRICO DE TRANSAÇÕES').toUpperCase()
const DOC_DATE = /Data\s+Documento\s*:?\s*\d{2}\/\d{2}\/\d{4}/i
const VENCIMENTO = /Vencimento\s*:?\s*\d{2}\/\d{2}\/\d{4}/i
/** At least one card section header: "- NR. 1234" */
const CARD_HEADER_PATTERN = /-\s*NR\.?\s*\d{4}\b/gi
const TOTAL_DE_GASTOS = /TOTAL\s+DE\s+GASTOS\b/i

function hasBanrisulSummaryFingerprint(foldedDoc: string): boolean {
  if (foldedDoc.includes('BANRISUL')) return true
  if (/\bFATURA\b/.test(foldedDoc)) return true
  if (foldedDoc.includes('CARTAO') && foldedDoc.includes('CREDITO')) return true
  return false
}

/**
 * Returns whether extracted PDF text is compatible with the Banrisul card statement parser.
 * Does not parse transactions; call after {@link extractTextFromPdfBuffer}.
 */
export function canParseBanrisulCreditCardPdf(
  text: string,
): CanParseBanrisulCreditCardPdfResult {
  const trimmed = text?.trim() ?? ''
  if (trimmed.length < BANRISUL_PDF_MIN_TEXT_CHARS) {
    return {
      ok: false,
      message:
        'This PDF has too little selectable text to be a Banrisul statement. ' +
        'It may be image-based, encrypted, or not a full statement. ' +
        'OCR is not supported—export a text PDF from Banrisul or use CSV/OFX.',
    }
  }

  const lines = trimmed.split(/\r?\n/)
  const hasHistorico = lines.some((line) => {
    const folded = stripAccents(line).toUpperCase().replace(/\s+/g, ' ')
    return folded.includes(HISTORICO_NEEDLE)
  })
  if (!hasHistorico) {
    return {
      ok: false,
      message:
        'This PDF does not contain the "HISTÓRICO DE TRANSAÇÕES" section expected on a Banrisul credit card statement.',
    }
  }

  if (!DOC_DATE.test(trimmed) && !VENCIMENTO.test(trimmed)) {
    return {
      ok: false,
      message:
        'This PDF is missing a Banrisul statement date line ("Data Documento" or "Vencimento" with DD/MM/YYYY).',
    }
  }

  const cardHits = trimmed.match(CARD_HEADER_PATTERN)
  if (!cardHits?.length) {
    return {
      ok: false,
      message:
        'This PDF does not contain card headers in the form "Name - NR. 1234" used by Banrisul statements.',
    }
  }

  if (!TOTAL_DE_GASTOS.test(trimmed)) {
    return {
      ok: false,
      message:
        'This PDF is missing "TOTAL DE GASTOS" totals from the transaction history, which Banrisul statements include.',
    }
  }

  const foldedDoc = stripAccents(trimmed).toUpperCase().replace(/\s+/g, ' ')
  if (!hasBanrisulSummaryFingerprint(foldedDoc)) {
    return {
      ok: false,
      message:
        'This PDF does not include Banrisul invoice wording (such as Banrisul, Fatura, or Cartão de crédito). ' +
        'Only compatible Banrisul credit card PDFs can be imported here.',
    }
  }

  return { ok: true }
}
