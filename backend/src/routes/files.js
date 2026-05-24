import { Router } from 'express'
import express from 'express'
import path from 'node:path'
import { query } from '../db/index.js'
import { authRequired } from '../middleware/auth.js'
import { uploadMiddleware } from '../middleware/upload.js'
import { scheduleParseFile } from '../services/fileParser.js'
import { deleteStoredFile } from '../services/fileStorage.js'
import {
  UPLOAD_MAX_SIZE_MB,
  CHUNK_SIZE_BYTES,
} from '../config/upload.js'
import {
  initUploadSession,
  saveChunk,
  getUploadStatus,
  completeUploadSession,
} from '../services/chunkUpload.js'
import { decodeUploadFilename } from '../utils/filename.js'
import { ah } from '../utils/asyncHandler.js'
import { badRequest, notFound } from '../utils/HttpError.js'

const router = Router()
const chunkBodyParser = express.raw({
  type: ['application/octet-stream', 'application/json'],
  limit: CHUNK_SIZE_BYTES + 65536,
})

router.use(authRequired)

function toFileDto(row, includePreview = true) {
  const dto = {
    id: row.id,
    originalName: decodeUploadFilename(row.original_name),
    ext: row.ext,
    sizeBytes: row.size_bytes,
    charCount: row.char_count,
    tokenEstimate: row.token_estimate,
    status: row.status,
    errorMessage: row.error_message,
    conversationId: row.conversation_id,
    createdAt: row.created_at,
  }
  if (includePreview && row.extracted_text) {
    dto.preview = row.extracted_text.slice(0, 500)
  }
  return dto
}

async function assertConversationOwned(conversationId, userId) {
  if (!conversationId) return
  const rows = await query(
    'SELECT id FROM conversations WHERE id = ? AND user_id = ?',
    [conversationId, userId]
  )
  if (!rows.length) throw notFound('会话不存在')
}

// --- 分片上传（大文件） ---

router.post(
  '/upload/init',
  ah(async (req, res) => {
    const { filename, size, mimeType, conversationId } = req.body || {}
    if (!filename || size == null) throw badRequest('缺少 filename 或 size')

    const convId = conversationId ? Number(conversationId) : null
    const session = await initUploadSession({
      userId: req.user.id,
      filename: String(filename),
      size: Number(size),
      mimeType: mimeType ? String(mimeType) : 'application/octet-stream',
      conversationId: convId,
    })
    res.status(201).json(session)
  })
)

router.get(
  '/upload/:uploadId/status',
  ah(async (req, res) => {
    const status = await getUploadStatus(req.params.uploadId, req.user.id)
    res.json(status)
  })
)

router.put(
  '/upload/:uploadId/chunk/:index',
  chunkBodyParser,
  ah(async (req, res) => {
    const buffer = req.body
    if (!Buffer.isBuffer(buffer) || !buffer.length) {
      throw badRequest('分片内容为空')
    }
    const result = await saveChunk(
      req.params.uploadId,
      req.user.id,
      req.params.index,
      buffer
    )
    res.json(result)
  })
)

router.post(
  '/upload/:uploadId/complete',
  ah(async (req, res) => {
    const row = await completeUploadSession(req.params.uploadId, req.user.id)
    res.status(201).json(toFileDto(row, false))
  })
)

// --- 整文件上传（小文件快速通道） ---

router.post('/upload', (req, res, next) => {
  uploadMiddleware.single('file')(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `文件不能超过 ${UPLOAD_MAX_SIZE_MB}MB，请使用分片上传`
          : err.message || '上传失败'
      return next(badRequest(message))
    }

    ah(async (req, res) => {
      if (!req.file) throw badRequest('请选择文件')

      const conversationId = req.body.conversationId
        ? Number(req.body.conversationId)
        : null
      await assertConversationOwned(conversationId, req.user.id)

      const originalName = decodeUploadFilename(req.file.originalname)
      const ext = path.extname(originalName).slice(1).toLowerCase()

      const result = await query(
        `INSERT INTO files (
          user_id, conversation_id, original_name, stored_name, ext, mime_type,
          size_bytes, storage_path, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          req.user.id,
          conversationId,
          originalName,
          req.file.filename,
          ext,
          req.file.mimetype,
          req.file.size,
          `${req.user.id}/${req.file.filename}`,
        ]
      )

      const fileId = result.insertId
      scheduleParseFile(fileId)

      const rows = await query('SELECT * FROM files WHERE id = ?', [fileId])
      res.status(201).json(toFileDto(rows[0], false))
    })(req, res, next)
  })
})

router.get(
  '/:id',
  ah(async (req, res) => {
    const rows = await query(
      'SELECT * FROM files WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    )
    if (!rows.length) throw notFound('文件不存在')
    res.json(toFileDto(rows[0]))
  })
)

router.delete(
  '/:id',
  ah(async (req, res) => {
    const rows = await query(
      'SELECT * FROM files WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    )
    if (!rows.length) throw notFound('文件不存在')

    const used = await query(
      'SELECT 1 FROM message_files WHERE file_id = ? LIMIT 1',
      [req.params.id]
    )
    if (used.length) throw badRequest('附件已用于消息，无法删除')

    const file = rows[0]
    await deleteStoredFile(file.user_id, file.stored_name)
    await query('DELETE FROM files WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  })
)

export default router
