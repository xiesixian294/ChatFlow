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

//app.use和app.get的区别是，app.use可以匹配任何请求，而app.get只能匹配GET请求
//当请求路径以/api/auth开头时，会交给authRouter处理
app.use('/api/auth', authRouter)
app.use('/api/conversations', conversationsRouter)
app.use('/api/chat', chatRouter)
app.use('/api/files', filesRouter)

//兜底接口，如果前端请求的接口不存在，则返回 404 错误
app.use('/api', (req, res) => {
  res.status(404).json({ message: '接口不存在' })
})

// 全局错误兜底：
// - HttpError（expose=true）：原样返回 message
// - 其他异常：500 + 通用文案，避免泄露内部信息；详细堆栈写日志
//有四个参数的app.use只处理错误请求
app.use((err, req, res, _next) => {
  //如果响应头已经发送（例如SSE已经开始推流），则直接返回
  if (res.headersSent) return
  //如果错误对象有status属性，则使用status属性，否则使用500
  const status = err?.status || 500
  //如果错误状态码大于等于500，则记录错误日志
  if (status >= 500) {
    console.error(`[${req.method} ${req.originalUrl}]`, err)
  }
  //expose属性-错误消息是否暴露给前端，true则暴露
  const message = err?.expose ? err.message : '服务器内部错误'
  //根据上面算的结果返回status和message
  res.status(status).json({ message })
})

//监听整个node进程未处理的Promise拒绝和未捕获的异常
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
})

//从磁盘当中读取mcp配置
async function loadMcpConfig() {
  //process.cwd()返回当前工作目录
  //path.resolve()将当前工作目录和mcp.config.json拼接成完整路径
  const configPath = path.resolve(process.cwd(), 'mcp.config.json')
  //尝试读取mcp.config.json文件
  try {
    //读取文件内容
    const raw = await fs.readFile(configPath, 'utf8')
    //解析JSON
    return JSON.parse(raw)
    //如果文件不存在，则返回空对象
  } catch (err) {
    //如果文件不存在，则返回空对象
    if (err.code !== 'ENOENT') {
      console.warn('[MCP] config load failed:', err.message)
    }
    //如果文件不存在，则返回空对象
    return { mcpServers: {} }
  }
}

//关闭MCP服务器
let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\n[shutdown] received ${signal}, closing MCP servers...`)
  //关闭MCP服务器
  await stopMcpServers()
  process.exit(0)
}
//终端里面按下Ctrl+C或者kill命令会触发SIGINT信号
process.on('SIGINT', () => shutdown('SIGINT'))
//docker stop命令会触发SIGTERM信号
process.on('SIGTERM', () => shutdown('SIGTERM'))

//启动后端
const port = Number(process.env.PORT || 3001)
  ; (async () => {
    await cleanupExpiredUploadSessions().catch(console.error)
    //从磁盘当中读取mcp配置
    const mcpConfig = await loadMcpConfig()
    //启动MCP服务器
    await startMcpServers(mcpConfig)
    //启动后端
    app.listen(port, () => {
      console.log(`Backend listening on http://localhost:${port}`)
    })
  })()
