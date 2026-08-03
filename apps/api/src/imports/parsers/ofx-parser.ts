import { BadRequestException } from '@nestjs/common'
import type { ParsedLedgerRow } from './csv-parser'

/**
 * Diagnostics for an OFX `<STMTTRN>` block that could not become a
 * `ParsedLedgerRow`, or that was accepted but is worth flagging. Mirrors the
 * `code`/`message`/raw snippet shape the Banrisul and Cresol PDF parsers
 * already use -- see `map-ofx-parser-warnings.ts`, which turns these into
 * `ImportParserWarning`. A block spans multiple lines, so `rawBlock` (not
 * `rawLine`) carries the source snippet, matching Cresol's convention for
 * multi-line units.
 */
export type OfxParseWarning = {
  code: string
  message: string
  rawBlock?: string
}

export type OfxParseResult = {
  rows: ParsedLedgerRow[]
  warnings: OfxParseWarning[]
}

function matchTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i')
  const m = block.match(re)
  return m ? m[1].trim() : null
}

function parseOfxDate(raw: string): Date {
  const digits = raw.replace(/\D/g, '')
  const ymd = digits.slice(0, 8)
  if (ymd.length !== 8) {
    throw new BadRequestException(`Invalid OFX date: "${raw}"`)
  }
  const y = Number.parseInt(ymd.slice(0, 4), 10)
  const m = Number.parseInt(ymd.slice(4, 6), 10) - 1
  const d = Number.parseInt(ymd.slice(6, 8), 10)
  return new Date(Date.UTC(y, m, d, 12, 0, 0))
}

export function parseOfxBuffer(buffer: Buffer): OfxParseResult {
  const content = buffer.toString('utf8')
  if (!/<STMTTRN/i.test(content)) {
    throw new BadRequestException('No <STMTTRN> blocks found in OFX file')
  }

  const rows: ParsedLedgerRow[] = []
  const warnings: OfxParseWarning[] = []
  let pos = 0
  let blockNumber = 0
  const lower = content.toLowerCase()
  while (true) {
    const start = lower.indexOf('<stmttrn>', pos)
    if (start < 0) break
    const end = lower.indexOf('</stmttrn>', start)
    const block =
      end >= 0 ? content.slice(start, end) : content.slice(start, start + 8000)
    pos = start + 9
    blockNumber += 1
    const rawBlock = block.trim()

    const dt = matchTag(block, 'DTPOSTED') ?? matchTag(block, 'DTUSER')
    const amtStr = matchTag(block, 'TRNAMT')

    if (!dt) {
      warnings.push({
        code: 'missing_date',
        message: `Transaction block ${blockNumber}: missing <DTPOSTED>/<DTUSER> -- block skipped`,
        rawBlock,
      })
      continue
    }
    if (amtStr === null) {
      warnings.push({
        code: 'missing_amount',
        message: `Transaction block ${blockNumber}: missing <TRNAMT> -- block skipped`,
        rawBlock,
      })
      continue
    }

    const memo = matchTag(block, 'MEMO') ?? ''
    const name = matchTag(block, 'NAME') ?? ''
    const description =
      [memo, name].filter(Boolean).join(' — ') || '(no description)'

    const signedAmount = Number.parseFloat(amtStr.trim())
    if (Number.isNaN(signedAmount)) {
      warnings.push({
        code: 'invalid_amount',
        message: `Transaction block ${blockNumber}: could not parse amount "${amtStr}" -- block skipped`,
        rawBlock,
      })
      continue
    }

    let occurredAt: Date
    try {
      occurredAt = parseOfxDate(dt)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      warnings.push({
        code: 'invalid_date',
        message: `Transaction block ${blockNumber}: could not parse date "${dt}" (${msg}) -- block skipped`,
        rawBlock,
      })
      continue
    }

    // Zero-amount decision (matches csv-parser.ts): a genuine R$ 0,00
    // transaction exists (a reversal, a waived fee, a corrected entry).
    // Dropping it would be exactly the silent data loss this parser is
    // being fixed to avoid, so it is imported rather than skipped -- the
    // `zero_amount` warning alone makes the exceptional value visible.
    if (Math.abs(signedAmount) < 0.000_000_1) {
      warnings.push({
        code: 'zero_amount',
        message: `Transaction block ${blockNumber}: amount parsed as zero -- transaction imported as-is (e.g. a reversal, waived fee, or corrected entry)`,
        rawBlock,
      })
    }

    rows.push({
      occurredAt,
      signedAmount,
      description: description.slice(0, 512),
    })
  }

  if (rows.length === 0) {
    throw new BadRequestException('Could not parse any OFX transactions')
  }

  return { rows, warnings }
}
