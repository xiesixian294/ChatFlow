import { Router } from 'express'
import { query } from '../db/index.js'
import { authRequired } from '../middleware/auth.js'
import { decodeUploadFilename } from '../utils/filename.js'
import { ah } from '../utils/asyncHandler.js'
import { notFound } from '../utils/HttpError.js'

const router = Router()

router.use(authRequired)

router.get(
  '/',
  ah(async (req, res) => {
    const rows = await query(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c
       WHERE c.user_id = ?
       ORDER BY c.updated_at DESC`,
      [req.user.id]
    )
    res.json({ list: rows })
  })
)

// 复用已有空会话，保证列表中最多只有一个「新对话」
router.post(
  '/',
  ah(async (req, res) => {
    const title = (req.body?.title || '新对话').slice(0, 255)

    if (title === '新对话') {
      const empty = await query(
        `SELECT c.id, c.title
         FROM conversations c
         WHERE c.user_id = ?
           AND (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) = 0
         ORDER BY c.id DESC
         LIMIT 1`,
        [req.user.id]
      )
      if (empty.length) {
        return res.json({ id: empty[0].id, title: empty[0].title, reused: true })
      }
    }

    const result = await query(
      'INSERT INTO conversations (user_id, title) VALUES (?, ?)',
      [req.user.id, title]
    )
    res.json({ id: result.insertId, title })
  })
)

router.get(
  '/:id/messages',
  ah(async (req, res) => {
    const owned = await query(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    )
    if (!owned.length) throw notFound('会话不存在')

    const rows = await query(
      'SELECT id, role, content, tool_calls, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC',
      [req.params.id]
    )

    const links = await query(
      `SELECT mf.message_id, f.id, f.original_name AS originalName, f.char_count AS charCount, f.ext
       FROM message_files mf
       JOIN files f ON f.id = mf.file_id
       JOIN messages m ON m.id = mf.message_id
       WHERE m.conversation_id = ?`,
      [req.params.id]
    )

    const attachMap = new Map()
    for (const link of links) {
      if (!attachMap.has(link.message_id)) attachMap.set(link.message_id, [])
      attachMap.get(link.message_id).push({
        id: link.id,
        originalName: decodeUploadFilename(link.originalName),
        charCount: link.charCount,
        ext: link.ext,
      })
    }

    const list = rows.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
      attachments: attachMap.get(m.id) || [],
      toolCalls: m.tool_calls
        ? typeof m.tool_calls === 'string'
          ? JSON.parse(m.tool_calls)
          : m.tool_calls
        : null,
    }))

    res.json({ list })
  })
)

router.delete(
  '/:id',
  ah(async (req, res) => {
    await query('DELETE FROM conversations WHERE id = ? AND user_id = ?', [
      req.params.id,
      req.user.id,
    ])
    res.json({ ok: true })
  })
)

export default router
