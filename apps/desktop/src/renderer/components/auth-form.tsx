import { FormEvent, useState } from 'react'

type AuthFormProps = {
  onSubmit: (email: string, password: string) => Promise<void>
  loading: boolean
  submitLabel: string
}

export function AuthForm({ onSubmit, loading, submitLabel }: AuthFormProps): JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    void onSubmit(email, password)
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <div style={styles.field}>
        <label htmlFor="email" style={styles.label}>
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
          placeholder="you@example.com"
          autoComplete="email"
        />
      </div>
      <div style={styles.field}>
        <label htmlFor="password" style={styles.label}>
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
          placeholder="••••••••"
          autoComplete="current-password"
        />
      </div>
      <button type="submit" disabled={loading} style={styles.button}>
        {loading ? 'Please wait…' : submitLabel}
      </button>
    </form>
  )
}

const styles = {
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.75rem',
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.3rem',
  },
  label: {
    fontSize: '0.8rem',
    color: '#aaa',
  },
  input: {
    background: '#0f0f0f',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    padding: '0.55rem 0.75rem',
    color: '#ececec',
    fontSize: '0.9rem',
    outline: 'none',
  },
  button: {
    marginTop: '0.25rem',
    padding: '0.65rem',
    background: '#6366f1',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: '0.9rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
} as const
