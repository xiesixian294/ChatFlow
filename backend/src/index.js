import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import cors from 'cors'

import authRouter from './routes/auth.js'
import conversationsRouter from './routes/conversations.js'
import chatRouter from './routes/chat.js'
import filesRouter from './routes/files.js'
import { cleanupExpiredUploadSessions } from './services/chunkUpload.js'
import { startMcpServers, stopMcpServers } from './services/mcp/client.js'

const app = express()

app.use(cors())
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', (req, res) => res.json({ ok: true }))

app.use('/api/auth', authRouter)
app.use('/api/conversations', conversationsRouter)
app.use('/api/chat', chatRouter)
app.use('/api/files', filesRouter)

app.use('/api', (req, res) => {
  res.status(404).json({ message: '接口不存在' })
})

// 全局错误兜底：
// - HttpError（expose=true）：原样返回 message
// - 其他异常：500 + 通用文案，避免泄露内部信息；详细堆栈写日志
app.use((err, req, res, _next) => {
  if (res.headersSent) return
  const status = err?.status || 500
  if (status >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, err)
  }
  const message = err?.expose ? err.message : '服务器内部错误'
  res.status(status).json({ message })
})

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
})

async function loadMcpConfig() {
  const configPath = path.resolve(process.cwd(), 'mcp.config.json')
  try {
    const raw = await fs.readFile(configPath, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('[MCP] config load failed:', err.message)
    }
    return { mcpServers: {} }
  }
}

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n[shutdown] received ${signal}, closing MCP servers...`)
  await stopMcpServers()
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

const port = Number(process.env.PORT || 3001)
;(async () => {
  await cleanupExpiredUploadSessions().catch(console.error)
  const mcpConfig = await loadMcpConfig()
  await startMcpServers(mcpConfig)
  app.listen(port, () => {
    console.log(`Backend listening on http://localhost:${port}`)
  })
})()
