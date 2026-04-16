import { BadRequestException } from '@nestjs/common'

/** Parses amounts like 1.234,56 (BR) or -1234.56 (US) */
export function parseFlexibleAmount(raw: string): number {
  const t = raw.trim().replace(/\s/g, '')
  if (t === '' || t === '-') {
    throw new BadRequestException(`Invalid amount: "${raw}"`)
  }
  const isNeg = t.startsWith('-')
  const body = isNeg ? t.slice(1) : t
  let normalized: string
  const lastComma = body.lastIndexOf(',')
  const lastDot = body.lastIndexOf('.')
  if (lastComma > lastDot) {
    normalized = body.replace(/\./g, '').replace(',', '.')
  } else {
    normalized = body.replace(/,/g, '')
  }
  const n = Number.parseFloat(normalized)
  if (Number.isNaN(n)) {
    throw new BadRequestException(`Invalid amount: "${raw}"`)
  }
  return isNeg ? -n : n
}

export function parseFlexibleDate(raw: string): Date {
  const s = raw.trim()
  if (!s) throw new BadRequestException('Empty date')

  const iso = Date.parse(s)
  if (!Number.isNaN(iso)) {
    return new Date(iso)
  }

  const digits = s.replace(/\D/g, '')
  if (digits.length === 8) {
    const y = Number.parseInt(digits.slice(0, 4), 10)
    const mo = Number.parseInt(digits.slice(4, 6), 10) - 1
    const d = Number.parseInt(digits.slice(6, 8), 10)
    return new Date(Date.UTC(y, mo, d, 12, 0, 0))
  }

  const br = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s)
  if (br) {
    let day = Number.parseInt(br[1], 10)
    let month = Number.parseInt(br[2], 10) - 1
    let year = Number.parseInt(br[3], 10)
    if (year < 100) year += 2000
    if (month >= 12 || day > 31) {
      month = Number.parseInt(br[1], 10) - 1
      day = Number.parseInt(br[2], 10)
      year = Number.parseInt(br[3], 10)
      if (year < 100) year += 2000
    }
    return new Date(Date.UTC(year, month, day, 12, 0, 0))
  }

  throw new BadRequestException(`Unrecognized date format: "${raw}"`)
}
