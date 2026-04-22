import { BadRequestException } from '@nestjs/common'

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

function utcNoon(y: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(y, monthIndex, day, 12, 0, 0))
}

export function parseFlexibleDate(raw: string): Date {
  const s = raw.trim()
  if (!s) throw new BadRequestException('Empty date')

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) {
    const y = Number.parseInt(iso[1], 10)
    const mo = Number.parseInt(iso[2], 10) - 1
    const d = Number.parseInt(iso[3], 10)
    if (mo < 0 || mo > 11 || d < 1 || d > 31) {
      throw new BadRequestException(`Invalid date: "${raw}"`)
    }
    return utcNoon(y, mo, d)
  }

  const br = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s)
  if (br) {
    const day = Number.parseInt(br[1], 10)
    const month = Number.parseInt(br[2], 10) - 1
    let year = Number.parseInt(br[3], 10)
    if (year < 100) year += 2000
    if (month < 0 || month > 11 || day < 1 || day > 31) {
      throw new BadRequestException(`Invalid date: "${raw}"`)
    }
    return utcNoon(year, month, day)
  }

  const digits = s.replace(/\D/g, '')
  if (digits.length === 8) {
    const yFirst = Number.parseInt(digits.slice(0, 4), 10)
    if (yFirst >= 1900 && yFirst <= 2100) {
      const mo = Number.parseInt(digits.slice(4, 6), 10) - 1
      const d = Number.parseInt(digits.slice(6, 8), 10)
      if (mo < 0 || mo > 11 || d < 1 || d > 31) {
        throw new BadRequestException(`Invalid date: "${raw}"`)
      }
      return utcNoon(yFirst, mo, d)
    }
    const d = Number.parseInt(digits.slice(0, 2), 10)
    const mo = Number.parseInt(digits.slice(2, 4), 10) - 1
    const y = Number.parseInt(digits.slice(4, 8), 10)
    if (mo < 0 || mo > 11 || d < 1 || d > 31 || y < 1900 || y > 2100) {
      throw new BadRequestException(`Unrecognized date format: "${raw}"`)
    }
    return utcNoon(y, mo, d)
  }

  const ms = Date.parse(s)
  if (!Number.isNaN(ms)) {
    return new Date(ms)
  }

  throw new BadRequestException(`Unrecognized date format: "${raw}"`)
}
