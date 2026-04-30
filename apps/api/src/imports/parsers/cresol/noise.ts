/**
 * Lines to skip when scanning Cresol statement text (metadata, balances, headers).
 */

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

export function isCresolNoiseLine(line: string): boolean {
  const t = line.trim()
  if (!t) return true

  const f = stripAccents(t).toUpperCase()

  if (/^SALDO (DO DIA|ANTERIOR)\b/.test(f)) return true
  if (f.includes('CONSULTA POSICAO CONSOLIDADA')) return true
  if (f.includes('CONSULTA POSIÇÃO CONSOLIDADA')) return true
  if (/^PAG(INA)?\.?\s*\d+/i.test(f)) return true
  if (/^PAG(INA)?\s+\d+\s+DE\s+\d+\s*$/i.test(f)) return true
  if (/^\d+\s*\/\s*\d+\s*$/.test(t)) return true

  if (f === 'LANCAMENTOS' || f === 'LANÇAMENTOS') return true

  if (f === 'DATA' || f === 'HISTORICO' || f === 'HISTÓRICO') return true
  if (f === 'VALOR' || f === 'DOCUMENTO' || f === 'LANÇAMENTO' || f === 'LANCAMENTO')
    return true

  if (/^EXTRATO(\s+DE)?\s*$/i.test(t)) return true
  if (/^PERIODO\b/i.test(f) || /^PERÍODO\b/i.test(t)) return true

  return false
}
