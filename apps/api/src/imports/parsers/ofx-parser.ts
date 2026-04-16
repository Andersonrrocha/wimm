import { BadRequestException } from '@nestjs/common'
import type { ParsedLedgerRow } from './csv-parser'

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

export function parseOfxBuffer(buffer: Buffer): ParsedLedgerRow[] {
  const content = buffer.toString('utf8')
  if (!/<STMTTRN/i.test(content)) {
    throw new BadRequestException('No <STMTTRN> blocks found in OFX file')
  }

  const rows: ParsedLedgerRow[] = []
  let pos = 0
  const lower = content.toLowerCase()
  while (true) {
    const start = lower.indexOf('<stmttrn>', pos)
    if (start < 0) break
    const end = lower.indexOf('</stmttrn>', start)
    const block =
      end >= 0 ? content.slice(start, end) : content.slice(start, start + 8000)
    pos = start + 9

    const dt = matchTag(block, 'DTPOSTED') ?? matchTag(block, 'DTUSER')
    const amtStr = matchTag(block, 'TRNAMT')
    if (!dt || amtStr === null) continue

    const memo = matchTag(block, 'MEMO') ?? ''
    const name = matchTag(block, 'NAME') ?? ''
    const description = [memo, name].filter(Boolean).join(' — ') || '(no description)'

    let signedAmount: number
    try {
      signedAmount = Number.parseFloat(amtStr.trim())
    } catch {
      continue
    }
    if (Number.isNaN(signedAmount) || Math.abs(signedAmount) < 0.000_000_1) {
      continue
    }

    let occurredAt: Date
    try {
      occurredAt = parseOfxDate(dt)
    } catch {
      continue
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

  return rows
}
