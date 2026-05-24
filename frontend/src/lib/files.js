import api from './api'
import { smartUpload } from './chunkUpload'

export { smartUpload, chunkUpload, CHUNK_THRESHOLD_BYTES } from './chunkUpload'

const ACCEPT = [
  '.txt', '.md', '.json', '.csv', '.pdf', '.docx',
  '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.go', '.rs',
  '.html', '.css', '.scss', '.sql', '.sh', '.yaml', '.yml',
  '.xml', '.vue', '.php', '.rb', '.c', '.cpp', '.h', '.cs',
].join(',')

export const FILE_ACCEPT = ACCEPT
export const MAX_ATTACHMENTS = 3

export function isAllowedFile(file) {
  const name = file.name.toLowerCase()
  const ext = name.includes('.') ? name.split('.').pop() : ''
  const allowed = ACCEPT.split(',').map((s) => s.slice(1))
  return allowed.includes(ext)
}

export async function uploadFile(file, conversationId, options = {}) {
  return smartUpload(file, conversationId, options)
}

export async function getFile(fileId) {
  const { data } = await api.get(`/files/${fileId}`)
  return data
}

export async function deleteFile(fileId) {
  await api.delete(`/files/${fileId}`)
}

export async function pollFileUntilReady(fileId, options = {}) {
  const { interval = 500, maxAttempts = 120 } = options

  for (let i = 0; i < maxAttempts; i++) {
    const data = await getFile(fileId)
    if (data.status === 'ready') return data
    if (data.status === 'failed') {
      throw new Error(data.errorMessage || '文件解析失败')
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error('文件解析超时，请稍后重试')
}
