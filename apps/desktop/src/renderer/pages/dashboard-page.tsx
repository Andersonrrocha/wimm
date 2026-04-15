import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth-context'

export function DashboardPage(): JSX.Element {
  const { state, logout } = useAuth()
  const navigate = useNavigate()
  const user = state.status === 'authenticated' ? state.user : null

  const handleLogout = async (): Promise<void> => {
    await logout()
    navigate('/login')
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <span style={styles.logo}>Wimm</span>
        <button onClick={handleLogout} style={styles.logoutBtn}>
          Sign out
        </button>
      </div>
      <main style={styles.main}>
        <h2 style={styles.welcome}>Welcome{user ? `, ${user.email}` : ''}.</h2>
        <p style={styles.hint}>Dashboard — Phase 4 will populate this screen.</p>
      </main>
    </div>
  )
}

const styles = {
  page: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100vh',
    background: '#0f0f0f',
    color: '#ececec',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 1.5rem',
    height: 56,
    borderBottom: '1px solid #1e1e1e',
    background: '#141414',
  },
  logo: {
    fontWeight: 700,
    fontSize: '1.1rem',
    color: '#ececec',
  },
  logoutBtn: {
    background: 'none',
    border: '1px solid #333',
    color: '#aaa',
    borderRadius: 6,
    padding: '0.3rem 0.8rem',
    fontSize: '0.8rem',
    cursor: 'pointer',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
  },
  welcome: {
    fontSize: '1.4rem',
    fontWeight: 600,
    margin: 0,
  },
  hint: {
    fontSize: '0.875rem',
    color: '#555',
    margin: 0,
  },
} as const
