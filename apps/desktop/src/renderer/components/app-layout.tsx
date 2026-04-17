import type { CSSProperties } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth-context'

const navLinkStyle = (active: boolean): CSSProperties => ({
  color: active ? '#ececec' : '#888',
  textDecoration: 'none',
  fontSize: '0.875rem',
  padding: '0.35rem 0.65rem',
  borderRadius: 6,
  background: active ? '#2a2a2a' : 'transparent',
})

export function AppLayout(): JSX.Element {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async (): Promise<void> => {
    await logout()
    navigate('/login')
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <span style={styles.logo}>Wimm</span>
        <nav style={styles.nav}>
          <NavLink end to="/" style={({ isActive }) => navLinkStyle(isActive)}>
            Home
          </NavLink>
          <NavLink to="/transactions" style={({ isActive }) => navLinkStyle(isActive)}>
            Transactions
          </NavLink>
          <NavLink to="/categories" style={({ isActive }) => navLinkStyle(isActive)}>
            Categories
          </NavLink>
          <NavLink to="/sources" style={({ isActive }) => navLinkStyle(isActive)}>
            Sources
          </NavLink>
          <NavLink to="/imports" style={({ isActive }) => navLinkStyle(isActive)}>
            Import
          </NavLink>
          <NavLink
            to="/recurrences"
            style={({ isActive }) => navLinkStyle(isActive)}
          >
            Recurrences
          </NavLink>
          <NavLink to="/rules" style={({ isActive }) => navLinkStyle(isActive)}>
            Rules
          </NavLink>
        </nav>
        <button type="button" onClick={handleLogout} style={styles.logoutBtn}>
          Sign out
        </button>
      </header>
      <main style={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}

const styles = {
  page: {
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: '100vh',
    background: '#0f0f0f',
    color: '#ececec',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '0 1.5rem',
    height: 56,
    borderBottom: '1px solid #1e1e1e',
    background: '#141414',
    flexShrink: 0,
  },
  logo: {
    fontWeight: 700,
    fontSize: '1.1rem',
    color: '#ececec',
    marginRight: '0.5rem',
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
    flex: 1,
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
    padding: '1.5rem',
    overflow: 'auto',
  },
} as const
