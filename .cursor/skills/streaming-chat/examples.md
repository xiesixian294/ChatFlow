# 完整流式组件示例

下面是一个可直接复制改名的最小 `<StreamChat />`，覆盖 SKILL.md 中的 5 个关注点。

## 组件

```jsx
// frontend/src/components/chat/StreamChat.jsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { useSelector } from 'react-redux'
import { toast } from 'sonner'

import api from '@/lib/api'
import { streamSSE } from '@/lib/sse'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * @typedef {Object} ChatMessage
 * @property {string|number} id
 * @property {'user'|'assistant'} role
 * @property {string} content
 */

/**
 * 最小流式聊天组件
 * @param {{ conversationId: number }} props
 */
export default function StreamChat({ conversationId }) {
  const token = useSelector((s) => s.auth.token)
  const [messages, setMessages] = useState(/** @type {ChatMessage[]} */ ([]))
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const abortRef = useRef(/** @type {AbortController|null} */ (null))
  const pollRef = useRef(/** @type {number|null} */ (null))

  // ---------- 数据加载 ----------
  const loadMessages = useCallback(async () => {
    const { data } = await api.get(`/conversations/${conversationId}/messages`)
    setMessages(data.list)
  }, [conversationId])

  // ---------- 刷新恢复：检测是否在生成 ----------
  useEffect(() => {
    let cancelled = false
    async function init() {
      await loadMessages()
      try {
        const { data } = await api.get('/chat/status', {
          params: { conversationId },
        })
        if (!cancelled && data.streaming) startPolling()
      } catch {
        // 拦截器已 toast
      }
    }
    init()
    return () => {
      cancelled = true
      stopPolling()
      abortRef.current?.abort() // 卸载时切断流
    }
  }, [conversationId, loadMessages])

  // ---------- 轮询（刷新恢复用） ----------
  function startPolling() {
    setSending(true)
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get('/chat/status', {
          params: { conversationId },
        })
        await loadMessages()
        if (!data.streaming) {
          setSending(false)
          stopPolling()
        }
      } catch (err) {
        console.error(err)
      }
    }, 800)
  }
  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  // ---------- 发送 ----------
  async function handleSend() {
    const content = input.trim()
    if (!content || sending) return

    setInput('')
    setSending(true)

    // 乐观插入两条临时消息
    setMessages((prev) => [
      ...prev,
      { id: `tmp-u-${Date.now()}`, role: 'user', content },
      { id: `tmp-a-${Date.now()}`, role: 'assistant', content: '' },
    ])

    const controller = new AbortController()
    abortRef.current = controller

    const url =
      `/api/chat/stream?conversationId=${conversationId}` +
      `&content=${encodeURIComponent(content)}` +
      `&token=${encodeURIComponent(token)}`

    try {
      await streamSSE({
        url,
        token,
        signal: controller.signal,
        onEvent: (event, data) => {
          if (event === 'delta') {
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              next[next.length - 1] = {
                ...last,
                content: last.content + (data.content || ''),
              }
              return next
            })
          } else if (event === 'error') {
            setMessages((prev) => {
              const next = [...prev]
              next[next.length - 1] = {
                ...next[next.length - 1],
                content: `出错了：${data.message}`,
              }
              return next
            })
          }
        },
      })
      // 流正常结束，用 DB 真实数据替换乐观 tmp- id
      await loadMessages()
    } catch (err) {
      if (err.name === 'AbortError') {
        // 用户主动停止，已生成的内容由后端最后一次 flushToDb 兜底
        await loadMessages()
      } else if (String(err.message).includes('409')) {
        // 服务端发现该会话已经在生成中（多端并发），切换到轮询模式
        startPolling()
      } else {
        toast.error(err.message || '消息发送失败')
        await loadMessages()
      }
    } finally {
      abortRef.current = null
      if (!pollRef.current) setSending(false)
    }
  }

  // ---------- 停止 ----------
  async function handleStop() {
    api
      .post('/chat/cancel', { conversationId })
      .catch(() => {}) // 用户已经在停了，不再叠 toast
    abortRef.current?.abort()
    stopPolling()
    setSending(false)
  }

  // ---------- 渲染 ----------
  return (
    <div className="flex flex-col gap-3">
      <ul className="space-y-2">
        {messages.map((m) => (
          <li key={m.id} className="text-sm">
            <strong>{m.role}: </strong>
            {m.role === 'assistant' && !m.content ? (
              <span className="text-muted-foreground animate-pulse">
                正在输入…
              </span>
            ) : (
              m.content
            )}
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <Button onClick={sending ? handleStop : handleSend}>
          {sending ? '停止' : '发送'}
        </Button>
      </div>
    </div>
  )
}
```

## 关键点对照

| 关注点 | 行为 |
| --- | --- |
| 解析 SSE | 调用 `streamSSE`，**不重写**，事件类型限定为 `delta` / `error` |
| 拼接流 | `setMessages(prev => { const next = [...prev]; next[i] = { ...next[i], content: ... } })` |
| 中断 | `abortRef = AbortController()`；`handleStop` 同时 `POST /chat/cancel` + `abort()` |
| 保存消息 | `tmp-u-` / `tmp-a-` 临时 id 乐观插入；流结束后 `loadMessages()` 拿真实数据 |
| Loading | `sending` state 控制按钮文本、输入禁用；空 assistant content 渲染「正在输入…」 |

## 进阶：节流渲染（仅在内容超长且 delta 极频繁时启用）

如果一条消息内容上万字，逐字 `setMessages` 会让 React 渲染压力陡增，可改为按帧节流：

```js
import { useRef } from 'react'

const pendingRef = useRef('')
const rafRef = useRef(0)

const flush = () => {
  rafRef.current = 0
  const chunk = pendingRef.current
  pendingRef.current = ''
  if (!chunk) return
  setMessages((prev) => {
    const next = [...prev]
    const last = next[next.length - 1]
    next[next.length - 1] = { ...last, content: last.content + chunk }
    return next
  })
}

onEvent: (event, data) => {
  if (event === 'delta') {
    pendingRef.current += data.content || ''
    if (!rafRef.current) rafRef.current = requestAnimationFrame(flush)
  }
}
```

效果：每帧最多一次 `setState`，markdown 重新解析次数大幅下降。

## smoke 测试要点

1. **正常流**：发一条短消息，观察「正在输入…」→ 内容追加 → 解锁输入框
2. **中断**：刚发完立即点「停止」，应保留半截内容，按钮回到「发送」
3. **刷新恢复**：发送后立即刷新浏览器，组件 mount 后应继续显示输入状态直到 LLM 完成
4. **错误**：临时改后端 `LLM_API_KEY` 为非法值，期望消息体出现「出错了：…」
5. **多端并发**：同会话同时从两个浏览器发送，第二个应进入轮询模式而不是报错
