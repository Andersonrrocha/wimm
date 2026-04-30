/**
 * Banrisul credit card statement — split extracted PDF text into per-card history sections.
 * Does not parse individual transaction lines or validate totals.
 */

export type BanrisulCardSection = {
  cardLast4: string
  rawLines: string[]
  declaredTotal?: number
  rawSectionText: string
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

/** Match "HISTÓRICO DE TRANSAÇÕES" with tolerant spacing / case. */
function findHistoricoLineIndex(lines: string[]): number {
  const needle = stripAccents('HISTÓRICO DE TRANSAÇÕES').toUpperCase()
  for (let i = 0; i < lines.length; i++) {
    const folded = stripAccents(lines[i]).toUpperCase().replace(/\s+/g, ' ')
    if (folded.includes(needle)) return i
  }
  return -1
}

/**
 * e.g. "ANDERSON - NR. 1570" or "ANDERSON - NR. 1570 US$ R$" (newer layouts append
 * currency hints after the last 4 digits — line must not end right after the number).
 */
const CARD_HEADER = /^(.+?)\s*-\s*NR\.?\s*(\d{4})\b/i

const TOTAL_DE_GASTOS = /^TOTAL\s+DE\s+GASTOS\b/i

const TRAILING_AMOUNT = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/i

function parseDeclaredTotal(line: string): number | undefined {
  const m = TRAILING_AMOUNT.exec(line.trim())
  if (!m) return undefined
  const t = m[1].replace(/\./g, '').replace(',', '.')
  const n = Number.parseFloat(t)
  if (Number.isNaN(n)) return undefined
  return n
}

function isNoiseLine(line: string): boolean {
  const t = line.trim()
  if (t.length === 0) return true
  if (/^P[aá]g\.?\s*\d+/i.test(t)) return true
  if (/^[\s\-_=·.]+$/.test(t)) return true
  return false
}

function flushSection(
  cardLast4: string,
  rawLines: string[],
  headerLine: string,
  totalLine: string | undefined,
): BanrisulCardSection {
  const body = [...rawLines]
  const rawSectionParts = [headerLine, ...body]
  if (totalLine !== undefined) rawSectionParts.push(totalLine)
  return {
    cardLast4,
    rawLines: body,
    declaredTotal:
      totalLine !== undefined ? parseDeclaredTotal(totalLine) : undefined,
    rawSectionText: rawSectionParts.join('\n'),
  }
}

/**
 * From full statement text, return card sections under "HISTÓRICO DE TRANSAÇÕES".
 * Lines are split on CRLF/LF; original line strings are preserved in rawLines.
 */
export function extractBanrisulCardSections(text: string): BanrisulCardSection[] {
  const lines = text.split(/\r?\n/)
  const startIdx = findHistoricoLineIndex(lines)
  if (startIdx < 0) return []

  let i = startIdx + 1
  const out: BanrisulCardSection[] = []

  let currentLast4: string | null = null
  let currentHeaderLine: string | null = null
  let currentRaw: string[] = []

  const pushCurrent = (totalLine: string | undefined) => {
    if (currentLast4 === null || currentHeaderLine === null) return
    out.push(
      flushSection(currentLast4, currentRaw, currentHeaderLine, totalLine),
    )
    currentLast4 = null
    currentHeaderLine = null
    currentRaw = []
  }

  for (; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    const cardMatch = CARD_HEADER.exec(trimmed)
    if (cardMatch) {
      if (currentLast4 !== null) {
        pushCurrent(undefined)
      }
      currentLast4 = cardMatch[2]
      currentHeaderLine = line
      currentRaw = []
      continue
    }

    if (currentLast4 === null) {
      continue
    }

    if (TOTAL_DE_GASTOS.test(trimmed)) {
      pushCurrent(line)
      continue
    }

    if (isNoiseLine(line)) continue
    currentRaw.push(line)
  }

  if (currentLast4 !== null && currentHeaderLine !== null) {
    out.push(flushSection(currentLast4, currentRaw, currentHeaderLine, undefined))
  }

  return out
}
