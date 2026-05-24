/**
 * 业务异常基类。
 * 抛出 HttpError 表示「业务可预期错误」，message 会原样返回给前端。
 * 普通 Error 仍由全局 handler 当成 500 处理，且 message 不外泄。
 */
export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.expose = true
  }
}

export const badRequest = (msg = '参数错误') => new HttpError(400, msg)
export const unauthorized = (msg = '未登录') => new HttpError(401, msg)
export const forbidden = (msg = '无权限') => new HttpError(403, msg)
export const notFound = (msg = '资源不存在') => new HttpError(404, msg)
export const conflict = (msg = '冲突') => new HttpError(409, msg)
