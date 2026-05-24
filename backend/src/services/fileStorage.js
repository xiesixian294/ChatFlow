import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { UPLOAD_DIR } from '../config/upload.js'

export async function ensureUserUploadDir(userId) {
  const dir = path.join(UPLOAD_DIR, String(userId))
  await fs.mkdir(dir, { recursive: true })
  return dir
}

export function buildStoredName(ext) {
  return `${randomUUID()}.${ext}`
}

export function resolveStoragePath(userId, storedName) {
  return path.join(UPLOAD_DIR, String(userId), storedName)
}

export function resolveChunkDir(userId, uploadId) {
  return path.join(UPLOAD_DIR, String(userId), 'chunks', uploadId)
}

export function resolveChunkPath(userId, uploadId, index) {
  return path.join(resolveChunkDir(userId, uploadId), `chunk-${index}`)
}

export async function deleteStoredFile(userId, storedName) {
  try {
    await fs.unlink(resolveStoragePath(userId, storedName))
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
}
