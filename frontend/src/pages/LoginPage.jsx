import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'

import api from '@/lib/api'
import { setAuth } from '@/store/authSlice'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const USERNAME_MIN = 3
const USERNAME_MAX = 20
const PASSWORD_MIN = 6
const PASSWORD_MAX = 30

// 校验规则与后端保持兼容（后端仅要求非空，前端在此基础上加更友好的约束）
function validateUsername(value) {
  const v = value.trim()
  if (!v) return '请输入用户名'
  if (v.length < USERNAME_MIN || v.length > USERNAME_MAX)
    return `用户名长度需为 ${USERNAME_MIN}-${USERNAME_MAX} 个字符`
  if (!/^[a-zA-Z0-9_]+$/.test(v)) return '用户名只能包含字母、数字和下划线'
  return ''
}

function validatePassword(value) {
  if (!value) return '请输入密码'
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX)
    return `密码长度需为 ${PASSWORD_MIN}-${PASSWORD_MAX} 个字符`
  return ''
}

export default function LoginPage() {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const dispatch = useDispatch()
  const navigate = useNavigate()

  const isRegister = mode === 'register'

  // 计算整个表单的校验结果
  function validateAll() {
    const errors = {}
    const usernameErr = validateUsername(username)
    if (usernameErr) errors.username = usernameErr
    const passwordErr = validatePassword(password)
    if (passwordErr) errors.password = passwordErr
    if (isRegister) {
      if (!confirmPassword) errors.confirmPassword = '请再次输入密码'
      else if (confirmPassword !== password)
        errors.confirmPassword = '两次输入的密码不一致'
    }
    return errors
  }

  // 失焦时校验单个字段
  function handleBlur(field) {
    setTouched((t) => ({ ...t, [field]: true }))
    setFieldErrors(validateAll())
  }

  // 切换登录/注册：清空所有输入、错误与校验状态
  function switchMode() {
    setMode(isRegister ? 'login' : 'register')
    setUsername('')
    setPassword('')
    setConfirmPassword('')
    setFieldErrors({})
    setTouched({})
    setError('')
  }

  async function submit(e) {
    e.preventDefault()
    setError('')

    const errors = validateAll()
    setFieldErrors(errors)
    setTouched({ username: true, password: true, confirmPassword: true })
    if (Object.keys(errors).length) return

    setLoading(true)
    try {
      const path = isRegister ? '/auth/register' : '/auth/login'
      const { data } = await api.post(
        path,
        { username: username.trim(), password },
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

  // 仅在字段被触碰过后才显示其错误，避免一进页面就标红
  const showError = (field) => touched[field] && fieldErrors[field]

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">React AI</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isRegister ? '创建一个新账号' : '登录你的账号'}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Input
              placeholder="用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={() => handleBlur('username')}
              className={cn(
                showError('username') &&
                  'border-destructive focus-visible:ring-destructive'
              )}
              autoFocus
              autoComplete="username"
            />
            {showError('username') && (
              <p className="text-xs text-destructive">{fieldErrors.username}</p>
            )}
          </div>

          <div className="space-y-1">
            <Input
              type="password"
              placeholder="密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => handleBlur('password')}
              className={cn(
                showError('password') &&
                  'border-destructive focus-visible:ring-destructive'
              )}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
            {showError('password') && (
              <p className="text-xs text-destructive">{fieldErrors.password}</p>
            )}
          </div>

          {isRegister && (
            <div className="space-y-1">
              <Input
                type="password"
                placeholder="确认密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onBlur={() => handleBlur('confirmPassword')}
                className={cn(
                  showError('confirmPassword') &&
                    'border-destructive focus-visible:ring-destructive'
                )}
                autoComplete="new-password"
              />
              {showError('confirmPassword') && (
                <p className="text-xs text-destructive">
                  {fieldErrors.confirmPassword}
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '请稍候...' : isRegister ? '注册' : '登录'}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-muted-foreground">
          {isRegister ? '已经有账号了？' : '还没有账号？'}
          <button
            type="button"
            className="ml-1 text-foreground underline-offset-4 hover:underline"
            onClick={switchMode}
          >
            {isRegister ? '去登录' : '去注册'}
          </button>
        </div>
      </div>
    </div>
  )
}
