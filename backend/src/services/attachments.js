import { query } from '../db/index.js'
import { UPLOAD_MAX_FILES_PER_MESSAGE } from '../config/upload.js'
import { decodeUploadFilename } from '../utils/filename.js'

export function parseAttachmentIds(raw) {
  if (!raw) return []
  const ids = String(raw)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0)
  return [...new Set(ids)]
}

export async function loadReadyFilesForUser(fileIds, userId) {
  if (!fileIds.length) return []

  if (fileIds.length > UPLOAD_MAX_FILES_PER_MESSAGE) {
    throw new Error(`每条消息最多 ${UPLOAD_MAX_FILES_PER_MESSAGE} 个附件`)
  }

  const placeholders = fileIds.map(() => '?').join(',')
  const rows = await query(
    `SELECT id, original_name, extracted_text, char_count, status
     FROM files
     WHERE id IN (${placeholders}) AND user_id = ?`,
    [...fileIds, userId]
  )

  if (rows.length !== fileIds.length) {
    throw new Error('部分附件不存在或无权访问')
  }

  const notReady = rows.filter((f) => f.status !== 'ready')
  if (notReady.length) {
    throw new Error('附件尚未解析完成，请稍候再发送')
  }

  const orderMap = new Map(fileIds.map((id, i) => [id, i]))
  return rows.sort((a, b) => orderMap.get(a.id) - orderMap.get(b.id))
}

export function buildUserMessageWithAttachments(userText, files) {
  const parts = []

  for (const file of files) {
    const name = decodeUploadFilename(file.original_name)
    parts.push(`【附件：${name}】\n${file.extracted_text}`)
  }

  const question = userText.trim() || '请根据以上附件内容回答。'
  parts.push(`【用户问题】\n${question}`)

  return parts.join('\n\n')
}

export async function linkFilesToMessage(messageId, fileIds) {
  for (const fileId of fileIds) {
    await query(
      'INSERT INTO message_files (message_id, file_id) VALUES (?, ?)',
      [messageId, fileId]
    )
  }
}
