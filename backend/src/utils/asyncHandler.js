/**
 * 将 async 路由处理器包装成 Express 4 兼容的 (req, res, next)。
 * 任何 reject 都会自动转给全局 error handler，避免请求挂起 / unhandledRejection。
 *
 * 使用：
 *   router.get('/', ah(async (req, res) => { ... }))
 */
export const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next)
