import multer from 'multer'
import path from 'node:path'
import { ALLOWED_EXTENSIONS, UPLOAD_MAX_SIZE_BYTES } from '../config/upload.js'
import { ensureUserUploadDir, buildStoredName } from '../services/fileStorage.js'

function getExt(filename) {
  return path.extname(filename).slice(1).toLowerCase()
}

const storage = multer.diskStorage({
  async destination(req, _file, cb) {
    try {
      const dir = await ensureUserUploadDir(req.user.id)
      cb(null, dir)
    } catch (err) {
      cb(err)
    }
  },
  filename(_req, file, cb) {
    const ext = getExt(file.originalname)
    cb(null, buildStoredName(ext))
  },
})

function fileFilter(_req, file, cb) {
  const ext = getExt(file.originalname)
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(`不支持的文件类型: .${ext}`))
  }
  cb(null, true)
}

export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: { fileSize: UPLOAD_MAX_SIZE_BYTES, files: 1 },
})
