import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'

import {
  ALLOWED_EXTENSIONS,
  CHUNK_SIZE_BYTES,
  CHUNK_UPLOAD_MAX_SIZE_BYTES,
  CHUNK_UPLOAD_MAX_SIZE_MB,
  UPLOAD_SESSION_TTL_HOURS,
} from '../config/upload.js'
import { query } from '../db/index.js'
import { badRequest, conflict, notFound } from '../utils/HttpError.js'
import {
  buildStoredName,
  ensureUserUploadDir,
  resolveChunkDir,
  resolveChunkPath,
} from './fileStorage.js'
import { scheduleParseFile } from './fileParser.js'

function parseReceivedChunks(raw) {
  if (Array.isArray(raw)) return raw.map(Number)
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.map(Number) : []
    } catch {
      return []
    }
  }
  return []
}

function missingChunks(received, total) {
  const set = new Set(received)
  const out = []
  for (let i = 0; i < total; i++) {
    if (!set.has(i)) out.push(i)
  }
  return out
}

function sessionDto(row) {
  const received = parseReceivedChunks(row.received_chunks)
  return {
    ...row,
    received_chunks: received,
  }
}

async function markExpired(uploadId) {
  await query(
    "UPDATE upload_sessions SET status = 'expired' WHERE id = ?",
    [uploadId]
  )
}

async function getSessionOrThrow(uploadId, userId) {
  const rows = await query(
    'SELECT * FROM upload_sessions WHERE id = ? AND user_id = ?',
    [uploadId, userId]
  )
  if (!rows.length) throw notFound('上传会话不存在')

  const session = sessionDto(rows[0])
  if (session.status === 'completed') throw conflict('上传已完成')
  if (session.status === 'expired') throw badRequest('上传会话已过期')
  if (new Date(session.expires_at) < new Date()) {
    await markExpired(uploadId)
    throw badRequest('上传会话已过期')
  }
  return session
}

async function assertConversationOwned(conversationId, userId) {
  if (!conversationId) return
  const rows = await query(
    'SELECT id FROM conversations WHERE id = ? AND user_id = ?',
    [conversationId, userId]
  )
  if (!rows.length) throw notFound('会话不存在')
}

/**
 * @param {{ userId: number, filename: string, size: number, mimeType?: string, conversationId?: number|null }} input
 */
export async function initUploadSession({
  userId,
  filename,
  size,
  mimeType = 'application/octet-stream',
  conversationId = null,
}) {
  const originalName = path.basename(filename || 'file')
  const ext = path.extname(originalName).slice(1).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw badRequest(`不支持的文件类型: .${ext}`)
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw badRequest('文件大小无效')
  }
  if (size > CHUNK_UPLOAD_MAX_SIZE_BYTES) {
    throw badRequest(`文件不能超过 ${CHUNK_UPLOAD_MAX_SIZE_MB}MB`)
  }

  await assertConversationOwned(conversationId, userId)

  const totalChunks = Math.ceil(size / CHUNK_SIZE_BYTES)
  const uploadId = randomUUID()
  const expiresAt = new Date(
    Date.now() + UPLOAD_SESSION_TTL_HOURS * 3600 * 1000
  )

  await fs.mkdir(resolveChunkDir(userId, uploadId), { recursive: true })

  await query(
    `INSERT INTO upload_sessions (
      id, user_id, conversation_id, original_name, ext, mime_type,
      size_bytes, chunk_size, total_chunks, received_chunks, status, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'uploading', ?)`,
    [
      uploadId,
      userId,
      conversationId,
      originalName,
      ext,
      mimeType,
      size,
      CHUNK_SIZE_BYTES,
      totalChunks,
      expiresAt,
    ]
  )

  return {
    uploadId,
    chunkSize: CHUNK_SIZE_BYTES,
    totalChunks,
    expiresAt: expiresAt.toISOString(),
  }
}

export async function saveChunk(uploadId, userId, index, buffer) {
  const session = await getSessionOrThrow(uploadId, userId)
  if (session.status === 'merging') throw conflict('正在合并，请稍候')

  const idx = Number(index)
  if (!Number.isInteger(idx) || idx < 0 || idx >= session.total_chunks) {
    throw badRequest('分片索引无效')
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw badRequest('分片内容为空')
  }
  if (buffer.length > session.chunk_size + 65536) {
    throw badRequest('分片大小无效')
  }

  await fs.writeFile(resolveChunkPath(userId, uploadId, idx), buffer)

  let received = [...session.received_chunks]
  if (!received.includes(idx)) {
    received.push(idx)
    received.sort((a, b) => a - b)
    await query('UPDATE upload_sessions SET received_chunks = ? WHERE id = ?', [
      JSON.stringify(received),
      uploadId,
    ])
  }

  return {
    received,
    progress: received.length / session.total_chunks,
    missingChunks: missingChunks(received, session.total_chunks),
  }
}

export async function getUploadStatus(uploadId, userId) {
  const session = await getSessionOrThrow(uploadId, userId)
  const received = session.received_chunks
  return {
    uploadId: session.id,
    filename: session.original_name,
    size: session.size_bytes,
    chunkSize: session.chunk_size,
    totalChunks: session.total_chunks,
    receivedChunks: received,
    missingChunks: missingChunks(received, session.total_chunks),
    progress: received.length / session.total_chunks,
    status: session.status,
    fileId: session.file_id,
    expiresAt: session.expires_at,
  }
}

export async function completeUploadSession(uploadId, userId) {
  const session = await getSessionOrThrow(uploadId, userId)
  if (session.status === 'merging') throw conflict('正在合并，请稍候')
  if (session.file_id) {
    const rows = await query('SELECT * FROM files WHERE id = ?', [session.file_id])
    if (rows.length) return rows[0]
  }

  const received = session.received_chunks
  if (received.length !== session.total_chunks) {
    const missing = missingChunks(received, session.total_chunks)
    throw badRequest(`还有 ${missing.length} 个分片未上传`)
  }

  await query("UPDATE upload_sessions SET status = 'merging' WHERE id = ?", [
    uploadId,
  ])

  const storedName = buildStoredName(session.ext)
  const userDir = await ensureUserUploadDir(userId)
  const finalPath = path.join(userDir, storedName)

  try {
    const ws = createWriteStream(finalPath)
    for (let i = 0; i < session.total_chunks; i++) {
      const chunkFile = resolveChunkPath(userId, uploadId, i)
      await pipeline(createReadStream(chunkFile), ws, { end: false })
    }
    await new Promise((resolve, reject) => {
      ws.on('error', reject)
      ws.end(resolve)
    })

    await fs.rm(resolveChunkDir(userId, uploadId), { recursive: true, force: true })

    const result = await query(
      `INSERT INTO files (
        user_id, conversation_id, original_name, stored_name, ext, mime_type,
        size_bytes, storage_path, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        userId,
        session.conversation_id,
        session.original_name,
        storedName,
        session.ext,
        session.mime_type,
        session.size_bytes,
        `${userId}/${storedName}`,
      ]
    )
    const fileId = result.insertId

    await query(
      "UPDATE upload_sessions SET status = 'completed', file_id = ? WHERE id = ?",
      [fileId, uploadId]
    )

    scheduleParseFile(fileId)
    const rows = await query('SELECT * FROM files WHERE id = ?', [fileId])
    return rows[0]
  } catch (err) {
    await query(
      "UPDATE upload_sessions SET status = 'uploading' WHERE id = ?",
      [uploadId]
    )
    throw err
  }
}

/** 启动时清理过期会话及其分片目录 */
export async function cleanupExpiredUploadSessions() {
  const rows = await query(
    `SELECT id, user_id FROM upload_sessions
     WHERE status IN ('uploading', 'merging') AND expires_at < NOW()`
  )
  for (const row of rows) {
    await markExpired(row.id)
    try {
      await fs.rm(resolveChunkDir(row.user_id, row.id), {
        recursive: true,
        force: true,
      })
    } catch {
      // ignore
    }
  }
  if (rows.length) {
    console.log(`[upload] cleaned ${rows.length} expired session(s)`)
  }
}
