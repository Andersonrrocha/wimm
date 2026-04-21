import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { useAuth } from '../context/auth-context'
import { AuthBrand } from '../components/auth-brand'
import { RegisterForm } from '../components/register-form'

function registerErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'isAxiosError' in err) {
    const ax = err as AxiosError<{ message?: string | string[] }>
    const m = ax.response?.data?.message
    if (Array.isArray(m)) return m.join(' ')
    if (typeof m === 'string') return m
  }
  if (err instanceof Error) return err.message
  return 'Could not create account. Try again.'
}

export function RegisterPage(): JSX.Element {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (input: {
    username: string
    email: string
    password: string
  }): Promise<void> => {
    setError(null)
    setLoading(true)
    try {
      await register(input)
      navigate('/')
    } catch (e) {
      setError(registerErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="wm-auth-screen">
      <div className="wm-auth-card wm-auth-card--wide">
        <AuthBrand />
        <h1 className="wm-auth-title">Create your account</h1>
        <p className="wm-auth-sub">Start tracking income and expenses.</p>
        <RegisterForm
          onSubmit={handleSubmit}
          loading={loading}
          submitLabel="Create account"
        />
        {error && (
          <p
            className="wm-error-text"
            style={{ textAlign: 'center', margin: 0 }}
          >
            {error}
          </p>
        )}
        <p className="wm-auth-footer">
          Already have an account?{' '}
          <Link to="/login" className="wm-link">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
