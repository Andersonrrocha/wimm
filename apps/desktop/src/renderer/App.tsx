import { QueryClientProvider } from '@tanstack/react-query'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { queryClient } from './query-client'
import { AuthProvider } from './context/auth-context'
import { AppLayout } from './components/app-layout'
import { ProtectedRoute } from './components/protected-route'
import { UpdateToast } from './components/update-toast'
import { LoginPage } from './pages/login-page'
import { RegisterPage } from './pages/register-page'
import { OnboardingPage } from './pages/onboarding-page'
import { DashboardPage } from './pages/dashboard-page'
import { TransactionsPage } from './pages/transactions-page'
import { ImportsPage } from './pages/imports-page'
import { RecurrencesPage } from './pages/recurrences-page'
import { SettingsPage } from './pages/settings-page'

function App(): JSX.Element {
  return (
    <HashRouter>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <UpdateToast />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route
              path="/onboarding"
              element={
                <ProtectedRoute>
                  <OnboardingPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="transactions" element={<TransactionsPage />} />
              <Route path="imports" element={<ImportsPage />} />
              <Route path="recurrences" element={<RecurrencesPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route
                path="categories"
                element={<Navigate to="/settings" replace />}
              />
              <Route
                path="sources"
                element={<Navigate to="/settings" replace />}
              />
              <Route
                path="rules"
                element={<Navigate to="/settings" replace />}
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </QueryClientProvider>
      </AuthProvider>
    </HashRouter>
  )
}

export default App
