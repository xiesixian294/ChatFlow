/**
 * Multer/busboy 在 Windows 等环境下常把 UTF-8 中文文件名按 latin1 解析，需还原。
 * 纯 ASCII 文件名经此转换不变。
 */
export function decodeUploadFilename(name) {
  if (!name) return name
  try {
    return Buffer.from(name, 'latin1').toString('utf8')
  } catch {
    return name
  }
}
