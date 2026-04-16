import { QueryClientProvider } from '@tanstack/react-query'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { queryClient } from './query-client'
import { AuthProvider } from './context/auth-context'
import { AppLayout } from './components/app-layout'
import { ProtectedRoute } from './components/protected-route'
import { LoginPage } from './pages/login-page'
import { RegisterPage } from './pages/register-page'
import { DashboardPage } from './pages/dashboard-page'
import { TransactionsPage } from './pages/transactions-page'
import { CategoriesPage } from './pages/categories-page'
import { SourcesPage } from './pages/sources-page'
import { ImportsPage } from './pages/imports-page'

function App(): JSX.Element {
  return (
    <HashRouter>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
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
              <Route path="categories" element={<CategoriesPage />} />
              <Route path="sources" element={<SourcesPage />} />
              <Route path="imports" element={<ImportsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </QueryClientProvider>
      </AuthProvider>
    </HashRouter>
  )
}

export default App
