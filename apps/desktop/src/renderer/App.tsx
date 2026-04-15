import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/auth-context'
import { ProtectedRoute } from './components/protected-route'
import { LoginPage } from './pages/login-page'
import { RegisterPage } from './pages/register-page'
import { DashboardPage } from './pages/dashboard-page'

function App(): JSX.Element {
  return (
    <HashRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </HashRouter>
  )
}

export default App
