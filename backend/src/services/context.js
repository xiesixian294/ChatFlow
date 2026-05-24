import { query } from '../db/index.js'
import { completeLLM } from './llm.js'

const SUMMARY_PROMPT = `你是一个对话摘要助手。请将对话历史压缩为简洁的中文摘要。
要求：
- 保留用户目标、关键事实、重要结论、未完成任务、用户偏好
- 若提供了「已有摘要」，在其基础上合并更新，不要重复啰嗦
- 只输出摘要正文，不要加标题或前缀说明`

/** 粗略估算 token：混合文本约 2 字符 ≈ 1 token */
export function estimateTokens(text) {
  if (!text) return 0
  return Math.ceil(text.length / 2)
}

export function estimateMessagesTokens(messages) {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0)
}

function formatMessagesForSummary(messages) {
  return messages
    .map((m) => {
      const label = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : '系统'
      return `${label}：${m.content}`
    })
    .join('\n\n')
}

function buildMockSummary(existingSummary, batch) {
  const preview = batch
    .slice(-2)
    .map((m) => m.content.slice(0, 40))
    .join('；')
  const base = existingSummary ? `${existingSummary}\n` : ''
  return `${base}（mock 摘要）本段新增 ${batch.length} 条消息，最近内容：${preview}`
}

async function summarizeBatch({ existingSummary, batch, signal }) {
  if (!batch.length) return existingSummary || ''

  if (!process.env.LLM_API_KEY) {
    return buildMockSummary(existingSummary, batch)
  }

  const userContent = [
    existingSummary ? `【已有摘要】\n${existingSummary}` : '【已有摘要】\n无',
    `【待合并的新对话】\n${formatMessagesForSummary(batch)}`,
  ].join('\n\n')

  const summary = await completeLLM({
    messages: [
      { role: 'system', content: SUMMARY_PROMPT },
      { role: 'user', content: userContent },
    ],
    signal,
    maxTokens: 1024,
  })

  return summary.trim() || existingSummary || ''
}

/**
 * 构建发给聊天模型的 messages，并在需要时增量压缩历史。
 * 结构：system (+ 摘要) + 最近若干轮完整对话
 */
export async function buildChatContext({
  conversationId,
  assistantMessageId,
  systemPrompt,
  signal,
}) {
  const recentKeep = Number(process.env.CONTEXT_RECENT_MESSAGES || 20)
  const compressThreshold = Number(
    process.env.CONTEXT_COMPRESS_TOKEN_THRESHOLD || 6000
  )
  const maxTokens = Number(process.env.CONTEXT_MAX_TOKENS || 8000)

  const [conv] = await query(
    'SELECT summary, summary_up_to_message_id FROM conversations WHERE id = ?',
    [conversationId]
  )

  const allMessages = await query(
    'SELECT id, role, content FROM messages WHERE conversation_id = ? AND id != ? ORDER BY id ASC',
    [conversationId, assistantMessageId]
  )

  let summary = conv?.summary || ''
  let summaryUpTo = Number(conv?.summary_up_to_message_id || 0)

  // 超出保留窗口的消息进入「旧消息」桶，其余为完整上下文
  let recentStart = Math.max(0, allMessages.length - recentKeep)
  let oldBucket = allMessages.slice(0, recentStart)
  let recentBucket = allMessages.slice(recentStart)

  const lastOldId = oldBucket.length ? oldBucket[oldBucket.length - 1].id : 0
  const pendingOld = oldBucket.filter((m) => m.id > summaryUpTo)

  const needsCompress =
    pendingOld.length > 0 ||
    estimateMessagesTokens([
      { role: 'system', content: systemPrompt },
      ...(summary ? [{ role: 'system', content: summary }] : []),
      ...recentBucket,
    ]) > compressThreshold

  if (needsCompress && pendingOld.length > 0) {
    summary = await summarizeBatch({
      existingSummary: summary,
      batch: pendingOld,
      signal,
    })
    summaryUpTo = lastOldId

    await query(
      'UPDATE conversations SET summary = ?, summary_up_to_message_id = ? WHERE id = ?',
      [summary, summaryUpTo, conversationId]
    )
  }

  // 若仍超 token 上限，逐步把较早的 recent 消息移入摘要
  while (recentBucket.length > 2) {
    const draft = [
      { role: 'system', content: systemPrompt },
      ...(summary
        ? [{ role: 'system', content: `【历史对话摘要】\n${summary}` }]
        : []),
      ...recentBucket,
    ]
    if (estimateMessagesTokens(draft) <= maxTokens) break

    const moveCount = Math.min(2, recentBucket.length - 2)
    const toMove = recentBucket.slice(0, moveCount)
    recentBucket = recentBucket.slice(moveCount)

    if (toMove.some((m) => m.id > summaryUpTo)) {
      const batch = toMove.filter((m) => m.id > summaryUpTo)
      if (batch.length) {
        summary = await summarizeBatch({
          existingSummary: summary,
          batch,
          signal,
        })
      }
      summaryUpTo = Math.max(summaryUpTo, toMove[toMove.length - 1].id)
      await query(
        'UPDATE conversations SET summary = ?, summary_up_to_message_id = ? WHERE id = ?',
        [summary, summaryUpTo, conversationId]
      )
    }
  }

  const systemContent = summary
    ? `${systemPrompt}\n\n【历史对话摘要】\n${summary}`
    : systemPrompt

  return [
    { role: 'system', content: systemContent },
    ...recentBucket.map((m) => ({ role: m.role, content: m.content })),
  ]
}
