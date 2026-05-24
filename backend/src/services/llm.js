/**
 * 调用 LLM 并解析 SSE 流。
 * 使用全局 fetch（Node 18+），ReadableStream 解析后通过回调把增量内容回传。
 *
 * 支持 OpenAI Tool Calling：
 *   - 入参 tools 透传给上游
 *   - 在流式增量中按 index 累积 tool_calls
 *   - 返回 { text, toolCalls, finishReason }
 *     text       —— 这一轮 assistant 的文字回复（可能为空，调用工具时通常没有内容）
 *     toolCalls  —— [{ id, name, args }]
 *     finishReason —— 'stop' | 'tool_calls' | ...
 *
 * 兼容旧用法：未传 tools 时 onDelta 行为完全不变。
 */
export async function streamLLM({ messages, tools, toolChoice, onDelta, signal }) {
  const url = `${process.env.LLM_BASE_URL}/chat/completions`
  const body = {
    model: process.env.LLM_MODEL,
    stream: true,
    messages,
  }
  if (tools?.length) {
    body.tools = tools
    body.tool_choice = toolChoice || 'auto'
  }

  const resp = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '')
    throw new Error(`LLM 请求失败: ${resp.status} ${text}`)
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let text = ''
  const toolBuf = []
  let finishReason = null

  outer: while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const raw of lines) {
      const line = raw.trim()
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') break outer

      let json
      try {
        json = JSON.parse(data)
      } catch {
        continue
      }
      const choice = json.choices?.[0]
      if (!choice) continue
      if (choice.finish_reason) finishReason = choice.finish_reason

      const delta = choice.delta || {}
      if (delta.content) {
        text += delta.content
        onDelta?.(delta.content)
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          if (!toolBuf[idx]) toolBuf[idx] = { id: '', name: '', args: '' }
          if (tc.id) toolBuf[idx].id = tc.id
          if (tc.function?.name) toolBuf[idx].name += tc.function.name
          if (tc.function?.arguments) toolBuf[idx].args += tc.function.arguments
        }
      }
    }
  }

  return { text, toolCalls: toolBuf.filter(Boolean), finishReason }
}

/** 非流式调用，用于摘要等一次性任务 */
export async function completeLLM({
  messages,
  signal,
  maxTokens = 1024,
  temperature = 0.3,
}) {
  const url = `${process.env.LLM_BASE_URL}/chat/completions`
  const resp = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      stream: false,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`LLM 请求失败: ${resp.status} ${text}`)
  }

  const json = await resp.json()
  return json.choices?.[0]?.message?.content || ''
}
