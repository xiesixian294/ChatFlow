import api from './api'

/** 与 backend CHUNK_THRESHOLD_BYTES 默认一致：2MB */
export const CHUNK_THRESHOLD_BYTES = 2 * 1024 * 1024
const CACHE_KEY = 'react-ai-upload-cache-v1'
const CHUNK_CONCURRENCY = 2
const CHUNK_PUT_TIMEOUT = 60000

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeCache(list) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(list))
}

function fileFingerprint(file, conversationId) {
  return `${file.name}|${file.size}|${file.lastModified}|${conversationId ?? ''}`
}

function findCachedEntry(file, conversationId) {
  const fp = fileFingerprint(file, conversationId)
  return readCache().find((e) => e.fingerprint === fp) || null
}

function upsertCache(entry) {
  const list = readCache().filter((e) => e.fingerprint !== entry.fingerprint)
  list.push({ ...entry, savedAt: Date.now() })
  writeCache(list.slice(-20))
}

function removeCache(file, conversationId) {
  const fp = fileFingerprint(file, conversationId)
  writeCache(readCache().filter((e) => e.fingerprint !== fp))
}

async function initUpload(file, conversationId) {
  const { data } = await api.post('/files/upload/init', {
    filename: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    conversationId: conversationId ?? null,
  })
  return data
}

async function getUploadStatus(uploadId) {
  const { data } = await api.get(`/files/upload/${uploadId}/status`)
  return data
}

async function putChunk(uploadId, index, blob, signal) {
  const { data } = await api.put(
    `/files/upload/${uploadId}/chunk/${index}`,
    blob,
    {
      headers: { 'Content-Type': 'application/octet-stream' },
      timeout: CHUNK_PUT_TIMEOUT,
      signal,
      skipErrorToast: true,
    }
  )
  return data
}

async function completeUpload(uploadId) {
  const { data } = await api.post(`/files/upload/${uploadId}/complete`)
  return data
}

async function resolveSession(file, conversationId) {
  const cached = findCachedEntry(file, conversationId)
  if (cached?.uploadId) {
    try {
      const status = await getUploadStatus(cached.uploadId)
      if (status.status === 'uploading' || status.status === 'merging') {
        return {
          uploadId: status.uploadId,
          chunkSize: status.chunkSize,
          totalChunks: status.totalChunks,
          missingChunks: [...status.missingChunks],
        }
      }
    } catch {
      removeCache(file, conversationId)
    }
  }

  const created = await initUpload(file, conversationId)
  upsertCache({
    uploadId: created.uploadId,
    fingerprint: fileFingerprint(file, conversationId),
    filename: file.name,
  })

  return {
    uploadId: created.uploadId,
    chunkSize: created.chunkSize,
    totalChunks: created.totalChunks,
    missingChunks: Array.from({ length: created.totalChunks }, (_, i) => i),
  }
}

/**
 * 分片上传（含断点续传）
 * @param {File} file
 * @param {number|null} conversationId
 * @param {{ onProgress?: (p: number) => void, signal?: AbortSignal }} [options]
 */
export async function chunkUpload(file, conversationId, options = {}) {
  const { onProgress, signal } = options
  const session = await resolveSession(file, conversationId)
  let missing = [...session.missingChunks]

  const uploadOne = async (index) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const start = index * session.chunkSize
    const end = Math.min(start + session.chunkSize, file.size)
    await putChunk(session.uploadId, index, file.slice(start, end), signal)
  }

  while (missing.length > 0) {
    const batch = missing.splice(0, CHUNK_CONCURRENCY)
    await Promise.all(batch.map((index) => uploadOne(index)))

    const status = await getUploadStatus(session.uploadId)
    missing = status.missingChunks
    onProgress?.(status.receivedChunks.length / status.totalChunks)
  }

  const result = await completeUpload(session.uploadId)
  removeCache(file, conversationId)
  onProgress?.(1)
  return result
}

/**
 * 智能上传：小文件走整包，大文件走分片
 */
export async function smartUpload(file, conversationId, options = {}) {
  if (file.size <= CHUNK_THRESHOLD_BYTES) {
    const form = new FormData()
    form.append('file', file)
    if (conversationId) form.append('conversationId', String(conversationId))
    const { data } = await api.post('/files/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      signal: options.signal,
      onUploadProgress: (e) => {
        if (e.total) options.onProgress?.(e.loaded / e.total)
      },
    })
    options.onProgress?.(1)
    return data
  }
  return chunkUpload(file, conversationId, options)
}
