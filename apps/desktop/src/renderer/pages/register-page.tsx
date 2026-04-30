import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { useAuth } from '../context/auth-context'
import { AuthBrand } from '../components/auth-brand'
import { RegisterForm } from '../components/register-form'
import {
  authCardClassName,
  authScreenClassName,
} from '../lib/auth-screen-classes'

function registerErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'isAxiosError' in err) {
    const ax = err as AxiosError<{ message?: string | string[] }>
    const m = ax.response?.data?.message
    if (Array.isArray(m)) return m.join(' ')
    if (typeof m === 'string') return m
  }
  if (err instanceof Error) return err.message
  return fallback
}

export function RegisterPage(): JSX.Element {
  const { t } = useTranslation()
  const { register } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (input: {
    username: string
    email: string
    password: string
    rememberMe: boolean
  }): Promise<void> => {
    setError(null)
    setLoading(true)
    try {
      const { rememberMe, ...body } = input
      await register(body, rememberMe)
      navigate('/')
    } catch (e) {
      setError(registerErrorMessage(e, t('auth.registerFailed')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={authScreenClassName}>
      <div className={authCardClassName}>
        <AuthBrand />
        <h1 className="text-center text-wm-lg font-medium text-fg">
          {t('auth.createYourAccount')}
        </h1>
        <p className="mb-2 text-center text-wm-sm text-fg-muted">
          {t('auth.registerSubtitle')}
        </p>
        <RegisterForm
          onSubmit={handleSubmit}
          loading={loading}
          submitLabel={t('auth.createAccount')}
        />
        {error && (
          <p className="m-0 text-center text-wm-sm text-negative">{error}</p>
        )}
        <p className="mt-1.5 text-center text-wm-sm text-fg-muted">
          {t('auth.hasAccount')}{' '}
          <Link to="/login" className="wm-link">
            {t('auth.signIn')}
          </Link>
        </p>
      </div>
    </div>
  )
}
