import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { AuthForm } from '../components/auth-form'

export function RegisterPage(): JSX.Element {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (email: string, password: string): Promise<void> => {
    setError(null)
    setLoading(true)
    try {
      await register({ email, password })
      navigate('/')
    } catch {
      setError('Could not create account. Email may already be registered.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>Wimm</h1>
        <p style={styles.subtitle}>Create your account</p>
        <AuthForm onSubmit={handleSubmit} loading={loading} submitLabel="Create account" />
        {error && <p style={styles.error}>{error}</p>}
        <p style={styles.footer}>
          Already have an account?{' '}
          <Link to="/login" style={styles.link}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

const styles = {
  page: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: '#0f0f0f',
  },
  card: {
    background: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: 12,
    padding: '2.5rem 2rem',
    width: 360,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.75rem',
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: 700,
    color: '#ececec',
    margin: 0,
    textAlign: 'center' as const,
  },
  subtitle: {
    fontSize: '0.875rem',
    color: '#888',
    margin: '0 0 0.5rem',
    textAlign: 'center' as const,
  },
  error: {
    fontSize: '0.8rem',
    color: '#f87171',
    margin: 0,
    textAlign: 'center' as const,
  },
  footer: {
    fontSize: '0.8rem',
    color: '#666',
    textAlign: 'center' as const,
    marginTop: '0.5rem',
  },
  link: {
    color: '#6366f1',
    textDecoration: 'none',
  },
} as const
