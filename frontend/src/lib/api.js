import axios from 'axios'
import { toast } from 'sonner'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// 通过 config.skipErrorToast = true 可以让单次请求不弹 toast，由调用方自己处理
api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    const cfg = err.config || {}
    const skip = cfg.skipErrorToast

    // 用户主动取消 / 组件卸载
    if (axios.isCancel(err) || err.code === 'ERR_CANCELED') {
      return Promise.reject(err)
    }

    if (err.code === 'ECONNABORTED') {
      if (!skip) toast.error('请求超时，请稍后重试')
      return Promise.reject(err)
    }

    if (!err.response) {
      if (!skip) toast.error('网络异常，请检查网络连接')
      return Promise.reject(err)
    }

    const { status, data } = err.response
    const message = data?.message

    if (status === 401) {
      localStorage.removeItem('token')
      if (location.pathname !== '/login') {
        toast.error('登录已过期，请重新登录')
        location.href = '/login'
      }
      return Promise.reject(err)
    }

    if (status >= 500) {
      if (!skip) toast.error(message || '服务器开小差了')
    } else if (!skip) {
      toast.error(message || '请求失败')
    }

    return Promise.reject(err)
  }
)

export default api
