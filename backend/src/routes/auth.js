import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { query } from '../db/index.js'
import { signToken, authRequired } from '../middleware/auth.js'
import { ah } from '../utils/asyncHandler.js'
import { badRequest, conflict, unauthorized } from '../utils/HttpError.js'

const router = Router()

router.post(
  '/register',
  ah(async (req, res) => {
    const { username, password } = req.body || {}
    if (!username || !password) throw badRequest('用户名和密码必填')

    const existed = await query('SELECT id FROM users WHERE username = ?', [
      username,
    ])
    if (existed.length) throw conflict('用户名已被占用')

    const hash = await bcrypt.hash(password, 10)
    const result = await query(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [username, hash]
    )

    const token = signToken({ id: result.insertId, username })
    res.json({ token, user: { id: result.insertId, username } })
  })
)

router.post(
  '/login',
  ah(async (req, res) => {
    const { username, password } = req.body || {}
    if (!username || !password) throw badRequest('用户名和密码必填')

    const rows = await query(
      'SELECT id, username, password FROM users WHERE username = ?',
      [username]
    )
    if (!rows.length) throw unauthorized('用户不存在')

    const ok = await bcrypt.compare(password, rows[0].password)
    if (!ok) throw unauthorized('密码错误')

    const token = signToken({ id: rows[0].id, username: rows[0].username })
    res.json({ token, user: { id: rows[0].id, username: rows[0].username } })
  })
)

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user })
})

export default router
