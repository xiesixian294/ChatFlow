import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import mammoth from 'mammoth'
import { query } from '../db/index.js'
import {
  truncateText,
  estimateTokensFromChars,
  CODE_EXTENSIONS,
} from '../config/upload.js'
import { resolveStoragePath } from './fileStorage.js'

const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')

const MAX_CSV_LINES = 500

function getExt(name) {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

async function readBuffer(storagePath) {
  return fs.readFile(storagePath)
}

async function parseTextBuffer(buf, ext) {
  let text = buf.toString('utf-8')

  if (ext === 'json') {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      // 保留原文
    }
  }

  if (ext === 'csv') {
    const lines = text.split(/\r?\n/)
    if (lines.length > MAX_CSV_LINES) {
      text =
        lines.slice(0, MAX_CSV_LINES).join('\n') +
        `\n\n…（CSV 仅保留前 ${MAX_CSV_LINES} 行）`
    }
  }

  return text
}

async function parsePdfBuffer(buf) {
  const data = await pdfParse(buf)
  return data.text || ''
}

async function parseDocxBuffer(buf) {
  const result = await mammoth.extractRawText({ buffer: buf })
  return result.value || ''
}

export async function extractTextFromFile({ storagePath, ext, originalName }) {
  const fileExt = ext || getExt(originalName)
  const buf = await readBuffer(storagePath)

  if (fileExt === 'pdf') {
    return parsePdfBuffer(buf)
  }
  if (fileExt === 'docx') {
    return parseDocxBuffer(buf)
  }
  if (
    ['txt', 'md', 'json', 'csv'].includes(fileExt) ||
    CODE_EXTENSIONS.has(fileExt)
  ) {
    return parseTextBuffer(buf, fileExt)
  }

  throw new Error(`不支持的文件类型: .${fileExt}`)
}

export async function parseFileRecord(fileId) {
  const rows = await query('SELECT * FROM files WHERE id = ?', [fileId])
  if (!rows.length) return

  const file = rows[0]
  if (file.status === 'ready') return

  await query(
    `UPDATE files SET status = 'processing', error_message = NULL WHERE id = ?`,
    [fileId]
  )

  try {
    const rawText = await extractTextFromFile({
      storagePath: resolveStoragePath(file.user_id, file.stored_name),
      ext: file.ext,
      originalName: file.original_name,
    })

    const { text } = truncateText(rawText)
    const charCount = text.length
    const tokenEstimate = estimateTokensFromChars(charCount)

    await query(
      `UPDATE files SET extracted_text = ?, char_count = ?, token_estimate = ?,
       status = 'ready', error_message = NULL WHERE id = ?`,
      [text, charCount, tokenEstimate, fileId]
    )
  } catch (err) {
    console.error('parse file error:', fileId, err)
    await query(
      `UPDATE files SET status = 'failed', error_message = ? WHERE id = ?`,
      [String(err.message).slice(0, 500), fileId]
    )
  }
}

export function scheduleParseFile(fileId) {
  setImmediate(() => {
    parseFileRecord(fileId).catch(console.error)
  })
}
