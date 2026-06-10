import { Navigate, Route, Routes } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { Toaster } from 'sonner'

import LoginPage from '@/pages/LoginPage'
import ChatPage from '@/pages/ChatPage'
import ErrorBoundary from '@/components/ErrorBoundary'

function RequireAuth({ children }) {
  const token = useSelector((s) => s.auth.token)
  if (!token) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <ErrorBoundary>
                <ChatPage />
              </ErrorBoundary>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster position="top-center" richColors closeButton />
    </>
  )
}
