import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { AuthBrand } from '../components/auth-brand'
import { AuthForm } from '../components/auth-form'

const authScreen =
  'flex min-h-screen items-center justify-center p-6 ' +
  'bg-[radial-gradient(1200px_600px_at_85%_15%,rgba(255,106,61,0.08),transparent_55%),radial-gradient(900px_500px_at_15%_90%,rgba(138,180,248,0.05),transparent_60%)] ' +
  'bg-surface-app'

const authCard =
  'flex w-full max-w-[380px] flex-col gap-3 rounded-lg border border-line bg-surface-1 p-8 shadow-wm-raised'

export function LoginPage(): JSX.Element {
  const { t } = useTranslation()
  const { login } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (
    email: string,
    password: string,
    rememberMe: boolean,
  ): Promise<void> => {
    setError(null)
    setLoading(true)
    try {
      await login({ email, password }, rememberMe)
      navigate('/')
    } catch {
      setError(t('auth.invalidCredentials'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={authScreen}>
      <div className={authCard}>
        <AuthBrand />
        <AuthForm
          onSubmit={handleSubmit}
          loading={loading}
          submitLabel={t('auth.signIn')}
        />
        {error && (
          <p className="m-0 text-center text-wm-sm text-negative">{error}</p>
        )}
        <p className="mt-1.5 text-center text-wm-sm text-fg-muted">
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="wm-link">
            {t('auth.createOne')}
          </Link>
        </p>
      </div>
    </div>
  )
}
