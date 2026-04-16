import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { FormEvent, useState } from 'react'
import type { Category, CategoryType } from '@wimm/shared'
import { apiClient } from '../lib/api-client'

const CATEGORY_TYPES: { value: CategoryType; label: string }[] = [
  { value: 'INCOME', label: 'Income' },
  { value: 'EXPENSE', label: 'Expense' },
]

export function CategoriesPage(): JSX.Element {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [type, setType] = useState<CategoryType>('EXPENSE')

  const { data: categories = [], isLoading, error } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data } = await apiClient.get<Category[]>('/categories')
      return data
    },
  })

  const createMut = useMutation({
    mutationFn: async () => {
      await apiClient.post('/categories', { name: name.trim(), type })
    },
    onSuccess: () => {
      setName('')
      void qc.invalidateQueries({ queryKey: ['categories'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/categories/${id}`)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['categories'] }),
  })

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault()
    if (!name.trim()) return
    createMut.mutate()
  }

  return (
    <div>
      <h2 style={h2}>Categories</h2>
      <p style={muted}>Classify transactions as income or expense.</p>

      <form onSubmit={handleSubmit} style={form}>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={input}
          required
        />
        <select value={type} onChange={(e) => setType(e.target.value as CategoryType)} style={input}>
          {CATEGORY_TYPES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="submit" style={btnPrimary} disabled={createMut.isPending}>
          Add category
        </button>
      </form>

      {error && <p style={err}>Failed to load categories.</p>}
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
          {categories.map((c) => (
            <tr key={c.id}>
              <td style={td}>{c.name}</td>
              <td style={td}>{CATEGORY_TYPES.find((x) => x.value === c.type)?.label ?? c.type}</td>
              <td style={td}>
                <button
                  type="button"
                  style={btnDanger}
                  onClick={() => deleteMut.mutate(c.id)}
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
