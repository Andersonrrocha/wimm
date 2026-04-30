/**
 * Combine DD/MM from a transaction line with the statement year (no rollover).
 */

export function transactionDateFromDdMmAndYear(
  ddMm: string,
  year: number,
): Date {
  const parts = ddMm.trim().split('/')
  if (parts.length !== 2) {
    throw new Error(`Invalid DD/MM: "${ddMm}"`)
  }
  const day = Number.parseInt(parts[0], 10)
  const month = Number.parseInt(parts[1], 10)
  if (
    Number.isNaN(day) ||
    Number.isNaN(month) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    year < 2000 ||
    year > 2100
  ) {
    throw new Error(`Invalid DD/MM or year: "${ddMm}" / ${year}`)
  }
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date for year ${year}: "${ddMm}"`)
  }
  return d
}
