/**
 * Parse a line that ends with a signed Brazilian amount: "+ R$ 63,48" / "- R$ 1.548,66".
 * Amount may be on its own line: "+ R$ 63,48" (description on previous lines).
 */

export type CresolAmountTail = {
  /** Text before the amount (may be empty if description lives on previous lines). */
  descriptionPart: string
  sign: 1 | -1
  amount: number
}

const SIGN = '([-+\\u2212\\u2013\\u2014])'
const WITH_DESC = new RegExp(
  `^(.*?)\\s+${SIGN}\\s*R\\$\\s*(\\d{1,3}(?:\\.\\d{3})*,\\d{2})\\s*$`,
  'i',
)
const AMOUNT_ONLY = new RegExp(
  `^${SIGN}\\s*R\\$\\s*(\\d{1,3}(?:\\.\\d{3})*,\\d{2})\\s*$`,
  'i',
)

function parseBrAmount(raw: string): number | null {
  const normalized = raw.replace(/\./g, '').replace(',', '.')
  const amount = Number.parseFloat(normalized)
  if (Number.isNaN(amount) || amount < 0.01) return null
  return amount
}

function signFromChar(c: string): 1 | -1 {
  return c === '+' ? 1 : -1
}

export function parseCresolAmountTail(line: string): CresolAmountTail | null {
  const t = line
    .trim()
    .replace(/[\u2013\u2014\u2212]/g, '-')

  const only = AMOUNT_ONLY.exec(t)
  if (only) {
    const amount = parseBrAmount(only[2])
    if (amount === null) return null
    const sign = signFromChar(only[1])
    return { descriptionPart: '', sign, amount }
  }

  const m = WITH_DESC.exec(t)
  if (!m) return null
  const amount = parseBrAmount(m[3])
  if (amount === null) return null
  const sign = signFromChar(m[2])
  return {
    descriptionPart: m[1].trim(),
    sign,
    amount,
  }
}
