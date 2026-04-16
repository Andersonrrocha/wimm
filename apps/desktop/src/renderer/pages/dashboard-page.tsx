import { useAuth } from '../context/auth-context'

export function DashboardPage(): JSX.Element {
  const { state } = useAuth()
  const user = state.status === 'authenticated' ? state.user : null

  return (
    <div style={styles.wrap}>
      <h2 style={styles.welcome}>Welcome{user ? `, ${user.email}` : ''}.</h2>
      <p style={styles.hint}>
        Use the navigation above to manage transactions, categories, and sources.
      </p>
    </div>
  )
}

const styles = {
  wrap: {
    maxWidth: 560,
  },
  welcome: {
    fontSize: '1.4rem',
    fontWeight: 600,
    margin: '0 0 0.5rem',
  },
  hint: {
    fontSize: '0.875rem',
    color: '#888',
    margin: 0,
    lineHeight: 1.5,
  },
} as const
