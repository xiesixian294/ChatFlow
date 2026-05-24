import { Router } from 'express'
import { query } from '../db/index.js'
import { authRequired } from '../middleware/auth.js'
import { streamLLM } from '../services/llm.js'
import { buildChatContext } from '../services/context.js'
import {
  registerStream,
  cancelStream,
  isStreaming,
  endStream,
} from '../services/streamManager.js'
import {
  parseAttachmentIds,
  loadReadyFilesForUser,
  buildUserMessageWithAttachments,
  linkFilesToMessage,
} from '../services/attachments.js'
import { buildToolSchemas } from '../services/tools/registry.js'
import { dispatchToolCall } from '../services/toolDispatcher.js'
import { ah } from '../utils/asyncHandler.js'
import { badRequest, notFound, conflict } from '../utils/HttpError.js'

const MAX_TOOL_ROUNDS = 5

const router = Router()

const SYSTEM_PROMPT = `你是一个有帮助的中文 AI 助手，回答简洁、清晰。

工具使用约定（重要）：
- 涉及「今天」「现在」「最近 N 天」「本周/本月」「几号」「星期几」等时间词，且你不确定真实当前时间时，先调用 get_current_time 拿到准确时间，再决定下一步（如配合联网搜索查询具体日期的事件）。
- 用户主动透露个人信息（姓名、职业、爱好、长期目标、对话偏好）时，调用 memory__create_entities 或 memory__add_observations 把要点存下来；不要复述「已记住」，自然继续对话即可。
- 当用户问「你还记得我吗」「我之前说过什么」「我叫什么」等暗示历史上下文的问题时，先调用 memory__search_nodes 检索，再基于结果作答；找不到就如实说还不了解。
- 需要最新信息（新闻、行情、近期发布、未训练涵盖的内容）时，调用 tavily 系列工具联网检索，**不要凭训练数据猜测**。
- 工具调用失败时，用自然语言告知用户失败原因（如「搜索接口不可用」），不要暴露技术错误细节。

输出格式要求（重要）：
- 使用 Markdown 语法（GFM）。
- 涉及二维数据、对比、字段说明时，必须使用标准 Markdown 表格语法，例如：

| 列1 | 列2 | 列3 |
| --- | --- | --- |
| a   | b   | c   |

- 禁止用 Tab、纯空格或制表符对齐来模拟表格。
- 代码使用三个反引号围栏，并标注语言。
- 数学公式使用 $...$ 或 $$...$$。`

const TITLE_MAX = 30

function truncateTitle(text) {
  return text.trim().slice(0, TITLE_MAX) || '新对话'
}

// 查询会话是否仍在生成
router.get(
  '/status',
  authRequired,
  ah(async (req, res) => {
    const conversationId = Number(req.query.conversationId)
    if (!conversationId) throw badRequest('参数缺失')

    const owned = await query(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?',
      [conversationId, req.user.id]
    )
    if (!owned.length) throw notFound('会话不存在')

    res.json({ streaming: isStreaming(conversationId) })
  })
)

// 手动停止生成
router.post(
  '/cancel',
  authRequired,
  ah(async (req, res) => {
    const conversationId = Number(req.body?.conversationId)
    if (!conversationId) throw badRequest('参数缺失')

    const owned = await query(
      'SELECT id FROM conversations WHERE id = ? AND user_id = ?',
      [conversationId, req.user.id]
    )
    if (!owned.length) throw notFound('会话不存在')

    cancelStream(conversationId)
    res.json({ ok: true })
  })
)

// SSE 流式聊天
// GET /api/chat/stream?conversationId=xx&content=xx&token=xx
router.get('/stream', authRequired, ah(async (req, res) => {
  const conversationId = Number(req.query.conversationId)
  const content = (req.query.content || '').toString().trim()
  const attachmentIds = parseAttachmentIds(req.query.attachmentIds)

  if (!conversationId) throw badRequest('参数缺失')
  if (!content && !attachmentIds.length) throw badRequest('请输入消息或上传附件')
  if (isStreaming(conversationId)) throw conflict('该会话正在生成回复，请稍候')

  const owned = await query(
    'SELECT id, title FROM conversations WHERE id = ? AND user_id = ?',
    [conversationId, req.user.id]
  )
  if (!owned.length) throw notFound('会话不存在')

  let attachmentFiles = []
  try {
    attachmentFiles = await loadReadyFilesForUser(
      attachmentIds,
      req.user.id
    )
  } catch (err) {
    throw badRequest(err.message)
  }

  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()

  let clientConnected = true
  req.on('close', () => {
    clientConnected = false
  })

  const send = (event, data) => {
    if (!clientConnected) return
    try {
      res.write(`event: ${event}\n`)
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    } catch {
      clientConnected = false
    }
  }

  // headers 已 flush，从此处起的任何错误都不能再走全局 handler（会冲突），
  // 必须通过 SSE event: error 推给客户端。
  let assistantMessageId
  let messages
  const controller = new AbortController()
  try {
    const userMessageBody = buildUserMessageWithAttachments(
      content,
      attachmentFiles
    )

    const userMessageResult = await query(
      'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
      [conversationId, 'user', userMessageBody]
    )
    const userMessageId = userMessageResult.insertId

    if (attachmentIds.length) {
      await linkFilesToMessage(userMessageId, attachmentIds)
    }

    if (owned[0].title === '新对话') {
      const title = truncateTitle(
        content || attachmentFiles[0]?.original_name || '新对话'
      )
      await query('UPDATE conversations SET title = ? WHERE id = ?', [
        title,
        conversationId,
      ])
    }

    const assistantResult = await query(
      'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
      [conversationId, 'assistant', '']
    )
    assistantMessageId = assistantResult.insertId

    registerStream(conversationId, controller)

    messages = await buildChatContext({
      conversationId,
      assistantMessageId,
      systemPrompt: SYSTEM_PROMPT,
      signal: controller.signal,
    })
  } catch (err) {
    console.error('chat stream prepare error:', err)
    endStream(conversationId)
    send('error', { message: err.expose ? err.message : '服务器内部错误' })
    if (clientConnected) res.end()
    return
  }

  let assistantText = ''
  let saveTimer = null
  // 工具调用全程记录，落库到 messages.tool_calls，便于刷新后回显
  const toolCallTrace = []

  const flushToDb = async () => {
    await query(
      'UPDATE messages SET content = ?, tool_calls = ? WHERE id = ?',
      [
        assistantText,
        toolCallTrace.length ? JSON.stringify(toolCallTrace) : null,
        assistantMessageId,
      ]
    )
  }

  const scheduleSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      flushToDb().catch(console.error)
    }, 300)
  }

  try {
    if (!process.env.LLM_API_KEY) {
      const mock = `这是一个 mock 响应。你说的是：「${content}」。请在 backend/.env 中配置 LLM_API_KEY 以启用真实 AI 回答。`
      for (const ch of mock) {
        if (controller.signal.aborted) break
        await new Promise((r) => setTimeout(r, 20))
        assistantText += ch
        scheduleSave()
        send('delta', { content: ch })
      }
    } else {
      let currentMessages = messages
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const { text: roundText, toolCalls, finishReason } = await streamLLM({
          messages: currentMessages,
          tools: buildToolSchemas(),
          signal: controller.signal,
          onDelta: (delta) => {
            assistantText += delta
            scheduleSave()
            send('delta', { content: delta })
          },
        })

        // 没有触发工具调用：本轮就是最终回复，跳出循环
        if (finishReason !== 'tool_calls' || !toolCalls.length) break

        // 通知前端工具开始运行
        for (const c of toolCalls) {
          const entry = {
            id: c.id,
            name: c.name,
            arguments: c.args,
            status: 'running',
            result: null,
          }
          toolCallTrace.push(entry)
          send('tool_call', entry)
        }
        scheduleSave()

        // 把 assistant 这一轮（带 tool_calls）加入消息历史
        currentMessages = [
          ...currentMessages,
          {
            role: 'assistant',
            content: roundText || null,
            tool_calls: toolCalls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: c.args },
            })),
          },
        ]

        // 并发执行所有 tool calls
        const results = await Promise.all(
          toolCalls.map((c) =>
            dispatchToolCall(
              { name: c.name, arguments: c.args },
              { signal: controller.signal }
            ).then((r) => ({ call: c, ...r }))
          )
        )

        for (const r of results) {
          if (r.error) {
            console.error(`[tool:${r.call.name}] failed:`, r.error, 'args=', r.call.args)
          }
          const payload = r.error ? { error: r.error } : r.result
          const entry = toolCallTrace.find((t) => t.id === r.call.id)
          if (entry) {
            entry.status = r.error ? 'failed' : 'done'
            entry.result = payload
          }
          send('tool_result', {
            id: r.call.id,
            name: r.call.name,
            result: payload,
            status: r.error ? 'failed' : 'done',
          })

          // 把工具结果加回上下文，供下一轮 LLM 使用
          currentMessages.push({
            role: 'tool',
            tool_call_id: r.call.id,
            content: JSON.stringify(payload),
          })
        }
        scheduleSave()
      }
    }

    clearTimeout(saveTimer)
    await flushToDb()
    await query('UPDATE conversations SET updated_at = NOW() WHERE id = ?', [
      conversationId,
    ])

    send('done', { ok: true })
    if (clientConnected) res.end()
  } catch (err) {
    if (err.name === 'AbortError') {
      clearTimeout(saveTimer)
      await flushToDb()
    } else {
      console.error('chat stream error:', err)
      assistantText = assistantText || `出错了：${err.message}`
      clearTimeout(saveTimer)
      await flushToDb()
      send('error', { message: err.message })
    }
    if (clientConnected) res.end()
  } finally {
    endStream(conversationId)
  }
}))

export default router
