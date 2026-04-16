import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { FormEvent, useState } from 'react'
import type { Source, SourceType } from '@wimm/shared'
import { apiClient } from '../lib/api-client'

const SOURCE_TYPES: { value: SourceType; label: string }[] = [
  { value: 'BANK_ACCOUNT', label: 'Bank account' },
  { value: 'CREDIT_CARD', label: 'Credit card' },
  { value: 'CASH', label: 'Cash' },
  { value: 'MANUAL', label: 'Manual' },
]

export function SourcesPage(): JSX.Element {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [type, setType] = useState<SourceType>('MANUAL')

  const { data: sources = [], isLoading, error } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data } = await apiClient.get<Source[]>('/sources')
      return data
    },
  })

  const createMut = useMutation({
    mutationFn: async () => {
      await apiClient.post('/sources', { name: name.trim(), type })
    },
    onSuccess: () => {
      setName('')
      void qc.invalidateQueries({ queryKey: ['sources'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/sources/${id}`)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sources'] }),
  })

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault()
    if (!name.trim()) return
    createMut.mutate()
  }

  return (
    <div>
      <h2 style={h2}>Sources</h2>
      <p style={muted}>Where transactions come from (accounts, cards, cash).</p>

      <form onSubmit={handleSubmit} style={form}>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={input}
          required
        />
        <select value={type} onChange={(e) => setType(e.target.value as SourceType)} style={input}>
          {SOURCE_TYPES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="submit" style={btnPrimary} disabled={createMut.isPending}>
          Add source
        </button>
      </form>

      {error && <p style={err}>Failed to load sources.</p>}
      {isLoading && <p style={muted}>Loading…</p>}

      <table style={table}>
        <thead>
          <tr>
            <th style={th}>Name</th>
            <th style={th}>Type</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id}>
              <td style={td}>{s.name}</td>
              <td style={td}>{SOURCE_TYPES.find((x) => x.value === s.type)?.label ?? s.type}</td>
              <td style={td}>
                <button
                  type="button"
                  style={btnDanger}
                  onClick={() => deleteMut.mutate(s.id)}
                  disabled={deleteMut.isPending}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const h2: CSSProperties = { fontSize: '1.25rem', margin: '0 0 0.5rem' }
const muted: CSSProperties = { color: '#888', fontSize: '0.875rem', margin: '0 0 1rem' }
const err: CSSProperties = { color: '#f87171', fontSize: '0.875rem' }
const form: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  marginBottom: '1.25rem',
  alignItems: 'center',
}
const input: CSSProperties = {
  background: '#141414',
  border: '1px solid #2a2a2a',
  borderRadius: 6,
  padding: '0.45rem 0.65rem',
  color: '#ececec',
  fontSize: '0.875rem',
}
const btnPrimary: CSSProperties = {
  background: '#6366f1',
  border: 'none',
  color: '#fff',
  borderRadius: 6,
  padding: '0.45rem 0.85rem',
  cursor: 'pointer',
  fontSize: '0.875rem',
}
const btnDanger: CSSProperties = {
  background: 'transparent',
  border: '1px solid #5c2b2b',
  color: '#f87171',
  borderRadius: 6,
  padding: '0.25rem 0.5rem',
  cursor: 'pointer',
  fontSize: '0.75rem',
}
const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.875rem',
}
const th: CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem',
  borderBottom: '1px solid #2a2a2a',
  color: '#aaa',
}
const td: CSSProperties = {
  padding: '0.5rem',
  borderBottom: '1px solid #1e1e1e',
}
