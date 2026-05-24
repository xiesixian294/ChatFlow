import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads')

export const UPLOAD_MAX_SIZE_MB = Number(process.env.UPLOAD_MAX_SIZE_MB || 5)
export const UPLOAD_MAX_SIZE_BYTES = UPLOAD_MAX_SIZE_MB * 1024 * 1024

/** 分片上传：单片大小、大文件上限、会话 TTL */
export const CHUNK_SIZE_MB = Number(process.env.CHUNK_SIZE_MB || 2)
export const CHUNK_SIZE_BYTES = CHUNK_SIZE_MB * 1024 * 1024
/** 超过此大小走分片上传（默认与单片大小一致） */
export const CHUNK_THRESHOLD_BYTES = Number(
  process.env.CHUNK_THRESHOLD_BYTES || CHUNK_SIZE_BYTES
)
export const CHUNK_UPLOAD_MAX_SIZE_MB = Number(
  process.env.CHUNK_UPLOAD_MAX_SIZE_MB || 50
)
export const CHUNK_UPLOAD_MAX_SIZE_BYTES =
  CHUNK_UPLOAD_MAX_SIZE_MB * 1024 * 1024
export const UPLOAD_SESSION_TTL_HOURS = Number(
  process.env.UPLOAD_SESSION_TTL_HOURS || 24
)
export const UPLOAD_MAX_TEXT_CHARS = Number(
  process.env.UPLOAD_MAX_TEXT_CHARS || 80000
)
export const UPLOAD_MAX_FILES_PER_MESSAGE = Number(
  process.env.UPLOAD_MAX_FILES_PER_MESSAGE || 3
)

export const CODE_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'go', 'rs', 'html', 'css', 'scss',
  'sql', 'sh', 'yaml', 'yml', 'xml', 'vue', 'php', 'rb', 'c', 'cpp', 'h', 'cs',
])

export const ALLOWED_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'csv', 'pdf', 'docx',
  ...CODE_EXTENSIONS,
])

export function estimateTokensFromChars(charCount) {
  return Math.ceil(charCount / 2)
}

export function truncateText(text, max = UPLOAD_MAX_TEXT_CHARS) {
  if (!text || text.length <= max) return { text: text || '', truncated: false }
  return {
    text: text.slice(0, max) + '\n\n…（内容已截断）',
    truncated: true,
  }
}
