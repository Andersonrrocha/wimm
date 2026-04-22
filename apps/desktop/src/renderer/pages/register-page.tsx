import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import type { AxiosError } from 'axios'
import { useAuth } from '../context/auth-context'
import { AuthBrand } from '../components/auth-brand'
import { RegisterForm } from '../components/register-form'

const authScreen =
  'flex min-h-screen items-center justify-center p-6 ' +
  'bg-[radial-gradient(1200px_600px_at_85%_15%,rgba(255,106,61,0.08),transparent_55%),radial-gradient(900px_500px_at_15%_90%,rgba(138,180,248,0.05),transparent_60%)] ' +
  'bg-surface-app'

const authCard =
  'flex w-full max-w-[440px] flex-col gap-3 rounded-lg border border-line bg-surface-1 p-8 shadow-wm-raised'

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
    <div className={authScreen}>
      <div className={authCard}>
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
