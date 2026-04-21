import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { AuthBrand } from '../components/auth-brand'
import { AuthForm } from '../components/auth-form'

export function LoginPage(): JSX.Element {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (
    email: string,
    password: string,
  ): Promise<void> => {
    setError(null)
    setLoading(true)
    try {
      await login({ email, password })
      navigate('/')
    } catch {
      setError('Invalid email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="wm-auth-screen">
      <div className="wm-auth-card">
        <AuthBrand />
        <h1 className="wm-auth-title">Welcome back</h1>
        <p className="wm-auth-sub">Sign in to your register.</p>
        <AuthForm
          onSubmit={handleSubmit}
          loading={loading}
          submitLabel="Sign in"
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
          No account?{' '}
          <Link to="/register" className="wm-link">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}
