import jwt from 'jsonwebtoken'

export function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || ''
  const token =
    header.startsWith('Bearer ') ? header.slice(7) : req.query.token

  if (!token) return res.status(401).json({ message: '未登录' })

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded
    next()
  } catch {
    return res.status(401).json({ message: 'token 无效或已过期' })
  }
}
