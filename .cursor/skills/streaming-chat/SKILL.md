---
name: streaming-chat
description: Build a React component that consumes an SSE / streaming HTTP endpoint in the react-ai project. Covers parsing SSE events, appending streaming deltas to state, aborting mid-stream, persisting messages, and managing loading state. Use when the user asks to create a streaming component, render LLM output, add real-time chat UI, consume an SSE endpoint, or handle Server-Sent Events on the frontend.
---

# 创建流式 React 组件

本 skill 总结 **react-ai** 项目中流式（SSE）组件的统一模式。涉及 5 个关注点：**解析 SSE / 拼接流 / 处理中断 / 保存消息 / 处理 loading**。

适用对象：消费 `/api/chat/stream` 类 SSE 接口、需要实时追加内容（如 LLM 回复、日志、进度）的组件。

## 工具与契约

| 模块 | 作用 |
| --- | --- |
| `frontend/src/lib/sse.js` 的 `streamSSE` | 唯一的 SSE 解析入口，**禁止**自行 `new EventSource` 或重复实现解析器 |
| `backend/src/services/streamManager.js` | 后端记录在途 stream，支持取消 |
| `GET /api/chat/stream?...&token=` | 既定 SSE 端点，事件：`delta` / `done` / `error` |
| `POST /api/chat/cancel` | 服务端取消生成 |
| `GET /api/chat/status` | 查询会话是否还在生成（用于重连/刷新恢复） |

为什么不用 `EventSource`？因为 `EventSource` **不支持自定义 Authorization 头**，本项目用 fetch + ReadableStream + Bearer token。

## 工作流（5 个关注点）

```
- [ ] 1. 调用 streamSSE 解析事件
- [ ] 2. 在 onEvent('delta') 内不可变拼接到最后一条消息
- [ ] 3. AbortController + ref 实现中断；同时调用 /chat/cancel
- [ ] 4. 乐观插入两条临时消息；流结束后 reload 拿真实 id；后端节流入库
- [ ] 5. sending 状态控制按钮 / 输入禁用 / 跟随滚动
```

---

## 1. 如何解析 SSE

直接用 `streamSSE`，不要重写。

```js
import { streamSSE } from '@/lib/sse'

await streamSSE({
  url: `/api/chat/stream?conversationId=${convId}&content=${encodeURIComponent(content)}&token=${token}`,
  token,
  signal: controller.signal,
  onEvent: (event, data) => {
    // event: 'delta' | 'done' | 'error'
    // data : { content: '...' } | { ok: true } | { message: '...' }
  },
})
```

约定：

| 后端事件 | data 结构 | 前端处理 |
| --- | --- | --- |
| `event: delta` | `{ content: '增量文本' }` | 拼接到最后一条 assistant 消息 |
| `event: done` | `{ ok: true }` | 流正常结束 |
| `event: error` | `{ message: '...' }` | 把错误写入消息体或 toast |

非 200 响应：`streamSSE` 直接 `throw new Error('请求失败 <status>: <body>')`，由外层 `try/catch` 接住。

## 2. 如何拼接流

**不可变更新**最后一条消息，避免 React 漏掉重渲染。

```js
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
}
```

要点：

- 用 `setMessages(prev => ...)`，避免闭包引用旧 state
- `next = [...prev]` + `next[i] = { ...next[i], content: ... }`，**双层浅拷贝**
- 不要在 `onEvent` 里读 `messages` —— 拿到的总是初次渲染时的快照
- 性能：如果一条消息超长且回调极频繁，可在 onEvent 里 batch（积攒 N ms 再 set），但通常不需要

## 3. 如何处理中断

两件事必须同时做：**前端断开流** + **后端取消生成**。

```jsx
const abortRef = useRef(null)

async function handleSend() {
  const controller = new AbortController()
  abortRef.current = controller
  try {
    await streamSSE({ url, token, signal: controller.signal, onEvent })
  } catch (err) {
    if (err.name === 'AbortError') {
      // 用户主动停止：不报错，重新拉一次最终入库内容
      await loadMessages(convId)
    } else {
      // 真实错误
      toast.error(err.message || '消息发送失败')
    }
  } finally {
    abortRef.current = null
  }
}

async function handleStop() {
  // 1) 通知后端尽快停止 LLM 生成（不要等待结果）
  await api.post('/chat/cancel', { conversationId: activeId }).catch(() => {})
  // 2) 切断本地 fetch 流（reader.read() 立即抛 AbortError）
  abortRef.current?.abort()
  setSending(false)
}
```

要点：

- `AbortController` 存在 `ref` 里，而不是 `useState`，因为停止操作不需要触发 re-render
- 卸载组件时也要 abort：`useEffect(() => () => abortRef.current?.abort(), [])`
- 后端 `/chat/cancel` 失败不弹 toast（用户已经停了，再弹很烦）

## 4. 如何保存消息

**前端**：发送前**乐观**塞入两条临时消息（user + 空 assistant），流过程中拼接，结束后 reload 真实数据。

```js
// 临时 id 用 tmp- 前缀，便于和真实 id 区分
setMessages((prev) => [
  ...prev,
  { id: `tmp-u-${Date.now()}`, role: 'user', content, attachments },
  { id: `tmp-a-${Date.now()}`, role: 'assistant', content: '' },
])

// ... streamSSE ...

// 流结束后用真实数据替换
await loadMessages(convId)
await loadConversations()
```

为什么 reload？因为后端入库的 `id`、`created_at` 是权威值；reload 之后 `key={m.id}` 才稳定，附件、引用等关联也才完整。

**后端**：在 `routes/chat.js` 中已实现 **debounce 入库**：

```js
const scheduleSave = () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => flushToDb().catch(console.error), 300)
}
// 每次 delta 调用 scheduleSave，最后再保证一次 flushToDb()
```

300ms 节流 + 结束兜底保证 DB 不会写爆，又能在异常中断时保留已生成的内容（用户取消后看到的「半截回复」就是来自最后一次 flush）。

新增类似端点时**复制这套节流**即可。

## 5. 如何处理 loading

最少四个 UI 状态要管：

| 状态 | 含义 | UI 表现 |
| --- | --- | --- |
| `sending = true`，最后一条 content 为空 | 服务端还没返回第一个 delta | 显示「正在输入…」+ 灰色动画 |
| `sending = true`，content 有内容 | 流正在拼接 | 内容追加 + 底部「停止」按钮 |
| `sending = false`，正常结束 | 流完成 | 解锁输入框，显示「发送」按钮 |
| 取消 / 错误 | 流被中断 | 保留已生成内容，提示用户 |

```jsx
{!content ? (
  <span className="text-muted-foreground animate-pulse">正在输入…</span>
) : (
  <Markdown>{content}</Markdown>
)}

<Button onClick={sending ? onStop : onSend}>
  {sending ? '停止' : '发送'}
</Button>
<Input disabled={sending} />
```

**跟随滚动**：参考 `components/chat/MessageList.jsx`，在最后一条 content 变化且用户停留在底部附近时（`scrollHeight - scrollTop - clientHeight < 150`），自动滚到底部；否则不抢用户位置。

**刷新恢复**：组件 mount 时调用 `GET /api/chat/status?conversationId=`，若返回 `streaming: true` 则进入 polling 模式（参考 `ChatPage.startPolling`），等待生成结束再 reload。这样**关掉浏览器再回来**也能看到完整结果。

---

## 完整模板

跨域复用直接看 [examples.md](examples.md)，里面是一个最小但完整的 `<StreamChat />` 组件，包含：

- `useRef` 保存 abort controller
- `useEffect` mount 自动 status 探测
- mock data 不依赖后端也能跑

---

## 反模式

- 用 `new EventSource(url)` —— **不支持 Authorization header，禁用**
- 在 `onEvent` 内 `setMessages([...messages, ...])` —— 闭包陷阱
- 直接 `setMessages(messages.concat(...))` —— 没拷贝引用，React 不会更新
- 只 abort 前端不调 `/chat/cancel` —— 服务端 LLM 还在烧 token
- `sending` 用 ref —— 必须用 state，否则按钮不会重渲染
- 把消息 id 用 `prev.length`、`Math.random()` —— 临时用 `tmp-<role>-${Date.now()}`，真实用 DB id
- 流结束不 `reload` —— 后续刷新拿到的 id 与本地的 `tmp-` 对不上
