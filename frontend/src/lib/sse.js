/**
 * 通过 fetch 读取 SSE 流。
 * 浏览器 EventSource 不支持自定义 Authorization 头，因此我们手动解析 text/event-stream。
 */
export async function streamSSE({ url, token, onEvent, signal }) {
  const resp = await fetch(url, {
    method: 'GET',
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '')
    throw new Error(`请求失败 ${resp.status}: ${text}`)
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // 按 SSE 的空行分割事件
    let idx
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)

      let event = 'message'
      let dataLines = []
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (!dataLines.length) continue

      try {
        const data = JSON.parse(dataLines.join('\n'))
        onEvent(event, data)
      } catch {
        onEvent(event, dataLines.join('\n'))
      }
    }
  }
}
