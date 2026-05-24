# 阶段 2：会话 CRUD 与前端状态

## 目标

掌握非流式 API，以及 `ChatPage` 如何按 `conversationId` 隔离 UI 状态（输入框、附件、消息列表）。

本阶段**先不深挖** `handleSend` 里的 SSE 循环（留给阶段 3）。

---

## 1. 后端 `routes/conversations.js`

整模块 `router.use(authRequired)`。

| 方法 | 路径 | 行为 |
|------|------|------|
| GET | `/` | 当前用户会话列表，含 `message_count`，按 `updated_at DESC` |
| POST | `/` | 新建；若 title 为「新对话」且已有空会话则 **复用**（`reused: true`） |
| GET | `/:id/messages` | 校验归属 → 消息列表 + 每条消息的 attachments + `toolCalls` |
| DELETE | `/:id` | `DELETE ... WHERE id=? AND user_id=?` |

### 空会话复用（前后端配合）

- 后端：无消息的「新对话」只保留一个（POST 时查找）。
- 前端 `visibleConversations`：列表里最多显示一个 `message_count === 0` 的会话。
- `handleCreate`：优先选中已有空会话，避免刷出一堆空白 tab。

---

## 2. 前端登录与路由

### `LoginPage.jsx`

```js
api.post('/auth/login' | '/auth/register', { username, password })
dispatch(setAuth({ token, user }))
navigate('/')
```

### `App.jsx` — `RequireAuth`

```js
const token = useSelector((s) => s.auth.token)
if (!token) return <Navigate to="/login" replace />
```

注意：刷新页面时 token 从 `localStorage`  hydrate 到 Redux（`authSlice` 初始 state）。

---

## 3. `ChatPage` 状态模型

### 3.1 两层状态

| 状态 | 类型 | 含义 |
|------|------|------|
| `conversations` | `useState([])` | 侧边栏列表（服务端） |
| `activeId` | `number \| null` | 当前选中会话 |
| `convState` | `Record<convId, ConvState>` | **按会话隔离**的 UI 状态 |

`ConvState` 结构：

```js
{
  messages: [],      // 当前会话消息（含流式临时消息）
  sending: boolean,  // 是否正在生成
  input: string,     // 输入框草稿
  attachments: [],   // 待发送附件
}
```

### 3.2 为何 `convState` + `convStateRef` 双写？

```js
const updateConvState = useCallback((convId, updater) => {
  setConvState((prev) => {
    const next = { ...prev, [convId]: ... }
    convStateRef.current = next  // 同步最新快照
    return next
  })
}, [])
```

**原因**：

1. **SSE `onEvent` 回调**可能在闭包里读到过期的 `convState`；发送前用 `convStateRef.current` 取最新消息（见 `handleSend` 里 `getConvState(convStateRef.current, convId)`）。
2. **切换会话**时，各会话的 `input`、`attachments` 保留在 `convState[id]`，不会互相覆盖。
3. **`streamingIds`**：从 `convState` 筛 `sending: true`，侧边栏可对多会话同时显示「生成中」。

### 3.3 切换会话时加载消息

`useEffect([activeId])`：

1. 若无本地 `streamRefs`（本 tab 未发起流）→ `loadMessages(activeId)`
2. `GET /chat/status?conversationId=` → 若服务端仍在生成 → `sending: true` + **轮询** `loadMessages`（800ms），用于刷新页面后追上流式结果

---

## 4. 关键函数导读（行号供跳转）

| 函数 | 文件位置 | 作用 |
|------|----------|------|
| `loadConversations` | ~100 | GET `/conversations` |
| `loadMessages` | ~106 | GET `/conversations/:id/messages` |
| `handleCreate` | ~242 | 新建或选中空会话 |
| `handleDelete` | ~257 | 删会话 + `cleanupConversation` |
| `handleSend` | ~425 | **阶段 3 重点** |

`Sidebar.jsx`：展示 `conversations`、`streamingIds`，触发 `onSelect` / `onCreate` / `onDelete`。

---

## 5. `router.use(authRequired)` vs 单路由挂载

| 方式 | 示例 | 适用 |
|------|------|------|
| `router.use(authRequired)` | `conversations.js`、`files.js` | 模块下全部接口需登录 |
| 单路由 | `auth.js` 的 `GET /me` | 同文件内有公开接口（register/login） |

`chat.js`：每条路由单独 `authRequired`（与 conversations 等价，风格不同）。

---

## 6. 动手实验

1. 登录后连续「新建对话」3 次（若后端复用空会话，可能少于 3 个空 tab）。
2. 在会话 A 输入文字**不发送**，切到会话 B 再切回 A → 草稿仍在。
3. Network：切换会话时观察 `GET /api/conversations/:id/messages`。

---

## 7. 阶段验收

- [ ] 能说出 POST `/conversations` 复用空会话的目的
- [ ] 能解释 `convState` 的 key 设计与 ref 的作用
- [ ] 能区分 `conversations`（列表）与 `convState[ id ].messages`（详情）

---

## 8. 面试话术

1. **状态按会话分片**：避免全局单例 input/messages 导致切换丢草稿。
2. **轮询 status**：SSE 连接在刷新后会断开，靠 `/chat/status` + 轮询拉齐 DB 里已落库的部分内容。
3. **乐观 UI**：发送前先 push 临时 user/assistant 消息（`tmp-u-` / `tmp-a-` id），流结束后再 `loadMessages` 对齐真实 id。

下一阶段 → [03-sse-streaming.md](./03-sse-streaming.md)
