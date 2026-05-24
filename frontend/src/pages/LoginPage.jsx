import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'

import api from '@/lib/api'
import { setAuth } from '@/store/authSlice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function LoginPage() {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const dispatch = useDispatch()
  const navigate = useNavigate()

  async function submit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register'
      const { data } = await api.post(
        path,
        { username, password },
        { skipErrorToast: true }
      )
      dispatch(setAuth({ token: data.token, user: data.user }))
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.message || '请求失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">React AI</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === 'login' ? '登录你的账号' : '创建一个新账号'}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Input
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <Input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '请稍候...' : mode === 'login' ? '登录' : '注册'}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          {mode === 'login' ? '还没有账号？' : '已经有账号了？'}
          <button
            className="ml-1 text-foreground underline-offset-4 hover:underline"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? '去注册' : '去登录'}
          </button>
        </div>
      </div>
    </div>
  )
}
