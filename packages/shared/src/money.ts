/**
 * Money crosses the wire as a two-decimal string and is stored as integer cents.
 *
 * String input is parsed digit-by-digit rather than multiplied, because
 * `Math.round(1.005 * 100)` is 100 — binary floating point cannot represent
 * 1.005 exactly. Number input is normalized through `toFixed(2)` first, matching
 * what the services did when money was a Prisma Decimal.
 */

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d+))?$/

export function toCents(amount: string | number): number {
  const text =
    typeof amount === 'number'
      ? Number.isFinite(amount)
        ? amount.toFixed(2)
        : ''
      : amount.trim()

  const match = DECIMAL_PATTERN.exec(text)
  if (!match) {
    throw new RangeError(`Cannot convert ${JSON.stringify(amount)} to cents`)
  }

  const [, sign, whole, fraction = ''] = match
  const hundredths = Number(`${fraction}00`.slice(0, 2))
  // A third decimal digit rounds the hundredths place, half away from zero.
  const roundsUp = fraction.length > 2 && Number(fraction[2]) >= 5
  const cents = Number(whole) * 100 + hundredths + (roundsUp ? 1 : 0)

  return sign === '-' ? -cents : cents
}

export function fromCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`Expected integer cents, received ${cents}`)
  }

  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  const whole = Math.trunc(absolute / 100)
  const fraction = absolute % 100

  return `${sign}${whole}.${String(fraction).padStart(2, '0')}`
}
