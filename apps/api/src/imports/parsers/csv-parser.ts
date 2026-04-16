import { BadRequestException } from '@nestjs/common'
import Papa from 'papaparse'
import { parseFlexibleAmount, parseFlexibleDate } from './amount-date'

export type ParsedLedgerRow = {
  occurredAt: Date
  signedAmount: number
  description: string
}

const DATE_KEYS = new Set([
  'date',
  'data',
  'dtposted',
  'dt',
  'datetrans',
])
const AMOUNT_KEYS = new Set(['amount', 'valor', 'value', 'trnamt'])
const DESC_KEYS = new Set([
  'description',
  'memo',
  'desc',
  'descricao',
  'historico',
  'name',
  'payee',
])

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

function findColumnKey(
  headers: string[],
  candidates: Set<string>,
): string | undefined {
  for (const h of headers) {
    if (candidates.has(normalizeHeader(h))) return h
  }
  return undefined
}

export function parseCsvBuffer(buffer: Buffer): ParsedLedgerRow[] {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '')
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })

  if (parsed.errors.length > 0) {
    const msg = parsed.errors.map((e) => e.message).join('; ')
    throw new BadRequestException(`CSV parse error: ${msg}`)
  }

  const data = parsed.data.filter((row) =>
    Object.values(row).some((v) => String(v ?? '').trim() !== ''),
  )
  if (data.length === 0) {
    throw new BadRequestException('CSV has no data rows')
  }

  const headers = Object.keys(data[0])
  const dk = findColumnKey(headers, DATE_KEYS)
  const ak = findColumnKey(headers, AMOUNT_KEYS)
  const descK = findColumnKey(headers, DESC_KEYS)

  const out: ParsedLedgerRow[] = []

  if (dk && ak && descK) {
    for (const row of data) {
      const dateStr = String(row[dk] ?? '').trim()
      const amountStr = String(row[ak] ?? '').trim()
      const desc = String(row[descK] ?? '').trim()
      if (!dateStr || !amountStr) continue
      try {
        const signedAmount = parseFlexibleAmount(amountStr)
        const occurredAt = parseFlexibleDate(dateStr)
        if (Math.abs(signedAmount) < 0.000_000_1) continue
        out.push({
          occurredAt,
          signedAmount,
          description: desc || '(no description)',
        })
      } catch {
        continue
      }
    }
  } else {
    const fields = parsed.meta.fields ?? headers
    for (const row of data) {
      const vals = fields.map((f) => String(row[f] ?? '').trim())
      if (vals.length < 2) continue
      const dateStr = vals[0]
      const amountStr = vals[1]
      const desc = vals.length > 2 ? vals.slice(2).join(' ') : ''
      if (!dateStr || !amountStr) continue
      try {
        const signedAmount = parseFlexibleAmount(amountStr)
        const occurredAt = parseFlexibleDate(dateStr)
        if (Math.abs(signedAmount) < 0.000_000_1) continue
        out.push({
          occurredAt,
          signedAmount,
          description: desc || '(no description)',
        })
      } catch {
        continue
      }
    }
  }

  if (out.length === 0) {
    throw new BadRequestException(
      'Could not parse any CSV rows (check date/amount columns)',
    )
  }

  return out
}
