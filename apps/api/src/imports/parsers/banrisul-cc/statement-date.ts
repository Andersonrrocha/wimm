/**
 * Banrisul credit card statement — extract statement date (DD/MM/YYYY) from PDF text.
 */

export type BanrisulStatementDateResult = {
  statementDate: Date
  /** The DD/MM/YYYY substring that was parsed. */
  rawMatch?: string
}

/** Present when "Vencimento" exists; optional "Data Documento" for cycle. */
export type BanrisulStatementBillingDates = {
  paymentDueDate: Date
  statementClosingDate?: Date
}

const DOC_DATE =
  /Data\s+Documento\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i
const VENCIMENTO = /Vencimento\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i

function parseDdMmYyyy(s: string): Date {
  const parts = s.trim().split('/')
  if (parts.length !== 3) {
    throw new Error(`Invalid Banrisul date format: "${s}"`)
  }
  const day = Number.parseInt(parts[0], 10)
  const month = Number.parseInt(parts[1], 10)
  const year = Number.parseInt(parts[2], 10)
  if (
    Number.isNaN(day) ||
    Number.isNaN(month) ||
    Number.isNaN(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    year < 2000 ||
    year > 2100
  ) {
    throw new Error(`Invalid Banrisul date values: "${s}"`)
  }
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: "${s}"`)
  }
  return d
}

/**
 * Prefer "Data Documento", then "Vencimento".
 * Throws if no valid DD/MM/YYYY is found or if the date is not a real calendar day.
 */
export function extractBanrisulStatementDate(
  text: string,
): BanrisulStatementDateResult {
  const normalized = text.replace(/\r\n/g, '\n')

  const doc = DOC_DATE.exec(normalized)
  if (doc) {
    const raw = doc[1]
    return { statementDate: parseDdMmYyyy(raw), rawMatch: raw }
  }

  const ven = VENCIMENTO.exec(normalized)
  if (ven) {
    const raw = ven[1]
    return { statementDate: parseDdMmYyyy(raw), rawMatch: raw }
  }

  throw new Error(
    'Banrisul statement date not found: no "Data Documento" or "Vencimento" with DD/MM/YYYY',
  )
}

/**
 * Extracts payment due (required) and optional document/closing date for import billing snapshot.
 * Returns null when "Vencimento" is missing (statement billing needs a due date).
 */
export function extractBanrisulStatementBillingSnapshot(
  text: string,
): BanrisulStatementBillingDates | null {
  const normalized = text.replace(/\r\n/g, '\n')

  const ven = VENCIMENTO.exec(normalized)
  if (!ven) {
    return null
  }

  let statementClosingDate: Date | undefined
  const doc = DOC_DATE.exec(normalized)
  if (doc) {
    statementClosingDate = parseDdMmYyyy(doc[1])
  }

  return {
    paymentDueDate: parseDdMmYyyy(ven[1]),
    ...(statementClosingDate !== undefined
      ? { statementClosingDate }
      : {}),
  }
}
