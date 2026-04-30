/**
 * Split Cresol statement extracted text into candidate transaction blocks (before amount parsing).
 * Each block starts at a line beginning with DD/MM/YYYY; following non-date, non-noise lines continue the block.
 */

import { isCresolNoiseLine } from './noise'

export type CresolTransactionBlockCandidate = {
  /** DD/MM/YYYY from the opening line of the block. */
  transactionDateRaw: string
  /** Full block text, lines joined with LF. */
  rawBlock: string
  /** Physical lines belonging to this block (NBSP normalized, trimEnd per line). */
  rawLines: string[]
}

const LEADING_DD_MM_YYYY = /^\s*(\d{2}\/\d{2}\/\d{4})\b/

function normalizePhysicalLine(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/\r/g, '').trimEnd()
}

function parseLeadingDate(line: string): string | null {
  const m = LEADING_DD_MM_YYYY.exec(line)
  return m ? m[1] : null
}

/**
 * From full PDF-extracted statement text, produce ordered transaction block candidates.
 * Does not parse amounts or descriptions beyond line grouping.
 */
export function extractCresolTransactionBlocks(
  text: string,
): CresolTransactionBlockCandidate[] {
  const lines = text.split(/\r?\n/)
  const out: CresolTransactionBlockCandidate[] = []

  let current: {
    transactionDateRaw: string
    rawLines: string[]
  } | null = null

  const flush = (): void => {
    if (!current || current.rawLines.length === 0) {
      current = null
      return
    }
    const rawLines = current.rawLines
    out.push({
      transactionDateRaw: current.transactionDateRaw,
      rawLines,
      rawBlock: rawLines.join('\n'),
    })
    current = null
  }

  for (const rawLine of lines) {
    const line = normalizePhysicalLine(rawLine)
    if (!line.trim()) {
      continue
    }

    if (isCresolNoiseLine(line)) {
      continue
    }

    const dateRaw = parseLeadingDate(line)
    if (dateRaw) {
      flush()
      current = {
        transactionDateRaw: dateRaw,
        rawLines: [line],
      }
      continue
    }

    if (current) {
      current.rawLines.push(line)
    }
  }

  flush()

  return out
}
